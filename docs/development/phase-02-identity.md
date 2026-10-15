# AUREA Phase 02 — Identity

This phase establishes who can use AUREA and the tenant boundary that isolates their data.

It maps to the authentication and organization portion of product roadmap Phase 0 (Foundation).

Every later phase depends on the workspace scoping introduced here.

---

# 1. Objective

Implement the authentication foundation and the multi-tenant model.

Deliver `User`, `Organization`, `Workspace`, and `Membership` with roles, session and API authentication, enforced tenant isolation, and workspace switching.

After this phase, every domain entity built later can be safely scoped to a workspace and every request can be attributed to an actor.

---

# 2. Scope (what gets built)

Tenant entities (see `docs/architecture/persistance-model.md` sections 6–9).

```text
- Organization   (top-level tenant; unique slug; soft deletion)
- Workspace      (belongs to Organization; unique slug within org)
- User           (platform identity; externalAuthId; email)
- Membership     (user access to org/workspace with a role)
```

Roles.

```text
OWNER    full control of the organization
ADMIN    manage workspace resources and members
MEMBER   create and edit growth entities
VIEWER   read-only access
```

Authentication.

```text
- Auth foundation using an external identity provider (User.externalAuthId).
  AUREA stores only the identity it needs, per persistance-model section 8.
- Session-based auth for the web app.
- API authentication for programmatic access (token/bearer).
- Sign-in, sign-out, and current-user resolution.
```

Tenant isolation.

```text
- Every request resolves: authenticated User → active Workspace → Membership role.
- A tenant context is attached to each request.
- All future data access is scoped by workspaceId (and organizationId).
- Cross-tenant access is denied by default at the data-access layer.
```

Workspace switching.

```text
- List the workspaces a user can access (via memberships).
- Select an active workspace; the active workspace is part of request context.
- Switching workspaces changes the tenant scope of subsequent requests.
```

Authorization.

```text
- Role checks enforced in the API for mutating operations.
- VIEWER cannot mutate; MEMBER cannot manage members; ADMIN/OWNER can.
```

---

# 3. Dependencies (which earlier phases / must-haves)

```text
- Phase 00 — Foundation   (env, secrets, logging, CI, PostgreSQL)
- Phase 01 — Monorepo     (Prisma package, Fastify API, web shell, EventBus)
```

References:

```text
- docs/architecture/persistance-model.md (Organization, Workspace, User, Membership)
- docs/architecture/event-architecture.md (System events: WorkspaceCreated, UserInvited)
```

---

# 4. Deliverables (concrete artifacts)

```text
Schema (packages/db)
  Prisma models: Organization, Workspace, User, Membership
  Role enum: OWNER | ADMIN | MEMBER | VIEWER
  Unique constraints: Organization.slug, (Workspace.organizationId, slug)
  Soft-deletion fields on Organization and Workspace
  Migration + seed (a demo org, workspace, owner user)

API (apps/api)
  Auth plugin: verify identity, resolve User, attach request context
  Tenant context plugin: resolve active Workspace + Membership role
  Endpoints:
    GET  /me                       current user + memberships
    GET  /organizations            organizations for current user
    POST /organizations            create organization (creator = OWNER)
    GET  /workspaces               workspaces in active organization
    POST /workspaces               create workspace
    POST /session/workspace        set active workspace (switch)
    GET  /workspaces/:id/members   list members
    POST /workspaces/:id/members   invite/add member with role
  Authorization guards by role on all mutations

Web (apps/web)
  Sign-in / sign-out flow
  Workspace switcher in the app layout
  Guarded routes requiring an authenticated user + active workspace

Shared (packages/shared)
  Role type and role-check helpers
  TenantContext type (organizationId, workspaceId, userId, role)

Events
  WorkspaceCreated, UserInvited emitted through the EventBus
```

---

# 5. Out of Scope (explicitly deferred)

```text
- Business, BusinessContext, ICP, Goal, Strategy, etc.   → phase 03
- Fine-grained per-entity permissions                     → later
- Billing, plans, quotas                                  → later
- SSO/SAML enterprise identity                            → later
- Multiple businesses per workspace                       → future (schema allows)
- Audit log persistence (AuditLog entity)                 → later phase
```

---

# 6. Exit Criteria (verifiable conditions)

```text
[ ] A user can authenticate; /me returns the user and their memberships.
[ ] Creating an organization makes the creator an OWNER.
[ ] A workspace cannot be created without an organization.
[ ] Organization.slug is unique; Workspace.slug is unique within its org.
[ ] A user can list and switch active workspace; requests reflect the switch.
[ ] Data access is scoped by workspace: a user of workspace A cannot read
    or write workspace B's data (proven by an integration test).
[ ] Role enforcement: VIEWER is denied mutations; MEMBER cannot manage
    members; ADMIN/OWNER can (proven by tests).
[ ] WorkspaceCreated is emitted on workspace creation.
[ ] Soft deletion hides an organization/workspace without hard delete.
```

---

# 7. Tenant Resolution Flow

```text
Request
   │
   ▼
Auth plugin
   Verify identity → resolve User (by externalAuthId)
   │
   ▼
Tenant context plugin
   Read active workspace from session/token
   Load Membership (userId, workspaceId) → role
   │
   ▼
TenantContext attached
   { organizationId, workspaceId, userId, role }
   │
   ▼
Authorization guard (role check)
   │
   ▼
Handler
   All data access scoped by workspaceId
```

The tenant boundary defined here is the foundation of AUREA multi-tenancy.

No later phase may bypass it.

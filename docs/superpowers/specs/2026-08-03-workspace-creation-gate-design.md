# Workspace Creation Gate

## Problem

Registration silently creates a workspace named `Default` (slug `default`) for
every new account (`back/src/http/api/auth/auth.repository.ts:28`). The user
never names it, never sees it created, and never learns that a workspace is the
unit that holds a business, its credits and its growth loop. Accounts on plans
that sell "up to N companies or brands" start with one nobody chose.

The account must instead be asked to create its first workspace. No workspace
should exist until the user creates one.

## Scope

- Registration stops creating a workspace.
- Trial credits move from registration to the creation of the organization's
  first workspace.
- `POST /workspaces` works for a user who has no workspace yet.
- The web app blocks `/app/*` behind a full-page "create your first workspace"
  screen while the account has none.
- A migration deletes untouched legacy `default` workspaces so existing accounts
  land in the same flow.

Out of scope: renaming a workspace, deleting a workspace, inviting members into
a workspace, multi-workspace onboarding.

## Design

### 1. Registration creates an organization-level membership

`createAuthRepository().createAccount` keeps its single transaction and creates:

- `Organization`
- `User`
- `Membership { userId, organizationId, workspaceId: null, role: OWNER }`

It no longer creates a `Workspace` nor the `CreditLedger` trial entry.

`Membership.workspaceId` is already nullable (`back/prisma/schema.prisma:115`),
and the web app already derives the acting role from an organization-level
membership when no workspace membership exists
(`web/src/lib/auth.tsx:42` — `memberships.find(m => m.workspaceId !== null) ?? memberships[0]`),
so `/auth/me` keeps reporting `OWNER`.

### 2. Trial credits are granted with the first workspace

`createWorkspaceForOrg` (`back/src/billing/create-workspace.ts`) grants
`TRIAL_CREDITS` inside its existing transaction when the organization has no
workspace yet:

- `assertCanCreateWorkspace` already runs in that transaction with the
  organization row locked, so "does this organization have zero workspaces?" is
  a safe read there. Two concurrent first-workspace creations cannot both see
  zero.
- The ledger insert is `{ workspaceId: created.id, kind: 'GRANT', credits: TRIAL_CREDITS, reason: 'trial credits' }`
  — byte-for-byte what registration used to write.
- The comment in `auth.repository.ts` explaining why this is the one sanctioned
  ledger write outside `credit.service` moves here, with its reasoning updated:
  the trial entry *is* the record that the trial happened (there is no
  `trialUsed` column), so it must commit with the workspace that owns it.
- `POST /workspaces` keeps its current comment about the second and later
  workspaces receiving no welcome credits; the "trial belongs to the
  organization and happens once, at registration" wording becomes "…once, with
  the organization's first workspace".

Known risk, recorded deliberately: "first workspace" is a count, not a
once-ever marker, so an organization that dropped its **active** workspace count
back to zero and created another would receive the trial again. `existing === 0`
is computed from `countActiveWorkspaces`
(`back/src/billing/billing.repository.ts`), which filters `deletedAt: null,
status: 'ACTIVE'` — so this is not only a delete route's risk. Any path that
deactivates an organization's only workspace (a delete, an archive, a
soft-delete) re-arms the grant the same way. There is no such route today
(`back/src/http/api/workspaces/` exposes create and list only). Whoever adds one
— delete, archive, or any other transition that can leave an organization with
zero active workspaces — must gate the grant behind `credit.service.grantOnce`
with an organization-scoped idempotency key — note this in that route's spec.

### 3. `POST /workspaces` resolves an organization-level tenant

`resolveTenant` (`back/src/plugins/tenant.ts`) keeps refusing a request with no
workspace membership: every domain route needs a workspace, and a 403 there is
correct.

A second decorator in the same plugin, `resolveOrgTenant`, resolves an
organization-level tenant for the create-workspace route only:

- finds the oldest membership for `request.user.sub` without requiring
  `workspaceId != null` (same `orderBy: { createdAt: 'asc' }` as `resolveTenant`
  and `userById`, so the role the frontend shows and the role the backend
  enforces stay the same one);
- 403 when the user has no membership at all;
- sets a separate request property, `request.orgTenant`, of type
  `OrgTenantContext = { userId: string; organizationId: string; role: Role }`.

`request.tenant` is deliberately left alone. Its `workspaceId: string` is what
every domain repository is scoped by; widening it to `string | null` would push
a null nobody can handle into forty routes and invite non-null assertions to
paper over it. The nullable case is one route's exception, so it gets its own
property — a route that reads `req.tenant` still cannot be reached without a
workspace.

The role guards in `back/src/lib/tenant.ts` (`assertWriter`, `assertAdmin`,
`assertOwner`) narrow their parameter from `TenantContext` to `{ role: Role }`,
which is all they read. That lets `assertAdmin(req.orgTenant)` typecheck without
duplicating the guard.

`workspacesRoutes` stops applying `resolveTenant` at module scope, since its two
routes now need different tenants: it keeps `authenticate` there, and each
controller declares its own preHandler — `resolveOrgTenant` for create,
`resolveTenant` for list. `createWorkspaceRoute` keeps `assertAdmin` — an OWNER
on an organization-level membership passes, a VIEWER does not.

### 4. The web app gates `/app/*` on having a workspace

A `WorkspaceGate` wraps the authenticated app (inside `ProtectedRoute`, around
`AppLayout`). When `/auth/me` reports no membership with a non-null
`workspaceId`, every `/app/*` path redirects to `/app/workspaces/new`.

`/app/workspaces/new` is a full page, not a modal or a popover — it is the only
thing the account can do, and a dismissable surface would strand the user on an
empty shell. It renders outside `AppLayout`'s nav (same shape as the auth
screens):

- explains what a workspace is, in the app, per the frontend rule that the app
  is the documentation — one company or brand, its own business context, goals
  and credits;
- one required field, the workspace name, with the char-cap validation the
  backend enforces (`createWorkspaceBody`);
- submits through `useCreateWorkspace`; on success invalidates
  `listWorkspacesQueryKey()`, calls `setWorkspaceId(created.id)`, awaits a
  refetch of `/auth/me` — the new membership is what lifts the gate, so
  navigating before it lands would bounce straight back here — and then
  navigates to `/app`;
- surfaces the backend's own refusal message via `apiErrorMessage`, as
  `WorkspaceSwitcher` does — the plan-cap message names the count and the
  ceiling.

Billing is gated too: credit balance and franchise are workspace-scoped, so
`/app/settings/billing` has nothing to show before a workspace exists.

`WorkspaceSwitcher` needs no change — its `workspaces.length === 0` early return
already renders nothing, and the gate means that state is never reachable inside
the app shell.

The register form gains no workspace field; it already collects the
organization name.

### 5. Migration deletes untouched legacy `default` workspaces

Order matters. `Membership.workspaceId` has `onDelete: Cascade`
(`back/prisma/schema.prisma:122`), so deleting the workspace first would delete
the only membership the user has, leaving `/auth/me` with no role — the gate
would render a form that 403s on submit. The migration therefore:

1. `UPDATE "Membership" SET "workspaceId" = NULL` for the memberships pointing
   at the workspaces about to go (the `@@unique([userId, organizationId, workspaceId])`
   constraint permits this: the user has no other membership in that
   organization);
2. `DELETE` the workspaces.

A workspace is deleted only when all of the following hold:

- `slug = 'default'`;
- it is the only workspace of its organization;
- it has zero rows in `Business`, `Icp`, `Goal`, `Strategy`, `Hypothesis`,
  `Experiment`, `Outcome`, `Learning`, `AgentRun`, `WorkspaceProviderKey` and
  `CreditPeriod` — the tables that carry a `workspaceId`. `BusinessContext`,
  `BusinessContextVersion`, `GoalIcp`, `StrategyGoal`, `StrategyIcp` and
  `AgentToolCall` hang off those and need no check of their own;
- its `CreditLedger` holds exactly one row, and that row is
  `kind = 'GRANT'` with `reason = 'trial credits'`.

The trial row dies with the workspace in the cascade. The account gets the same
grant back when it creates its first workspace (§2), so the balance is
preserved — the criteria above only ever match an account that never spent a
credit.

`Organization.plan` and the Stripe subscription state are organization-level
(`back/prisma/schema.prisma:58`) and are not touched. An organization on a paid
plan whose only workspace is an untouched `default` still loses that workspace
and creates a named one; its plan, cap and franchise follow the organization.

## Data flow

```text
register
  → Organization + User + Membership{workspaceId: null, OWNER}
  → login
  → /auth/me: no membership with a workspaceId
  → WorkspaceGate redirects to /app/workspaces/new
  → POST /workspaces (resolveOrgTenant, assertAdmin)
      → createWorkspaceForOrg
          → assertCanCreateWorkspace (organization row locked)
          → Workspace
          → Membership{workspaceId, OWNER}
          → CreditLedger GRANT (first workspace only)
  → setWorkspaceId + /auth/me refetch
  → /app onboarding
```

## Error handling

| Case | Behavior |
| --- | --- |
| No membership at all (data corruption) | `resolveOrgTenant` 403; gate shows the error, offers logout |
| VIEWER with no workspace | `assertAdmin` 403; gate explains an admin must create the workspace |
| Plan cap reached on first workspace | Impossible (cap > 0), but the backend message is rendered verbatim if it happens |
| Duplicate submit | `createWorkspaceForOrg`'s transaction serializes on the locked organization row; the second call creates a second workspace and grants no second trial |
| Workspace created, `/auth/me` refetch fails | The workspace exists, so re-submitting would create a duplicate. The page therefore leaves the form replaced by a "workspace created, finishing setup" state whose retry button refetches `/auth/me` again and never re-posts |

## Testing

Backend:

- `createAccount` creates no workspace and no ledger entry; the membership is
  organization-level with role OWNER.
- `createWorkspaceForOrg` grants `TRIAL_CREDITS` for the organization's first
  workspace and nothing for the second.
- Two concurrent first-workspace creations produce exactly one trial entry.
- `resolveOrgTenant` resolves an organization-level membership, refuses a user
  with no membership, and `POST /workspaces` succeeds for a freshly registered
  account.
- Domain routes still 403 for an account with no workspace.
- Migration: an untouched `default` workspace is removed and its membership
  becomes organization-level; a `default` workspace with a Business, with a
  second ledger row, or in an organization with two workspaces survives.

Frontend:

- `WorkspaceGate` redirects `/app/*` to `/app/workspaces/new` when no
  membership has a `workspaceId`, and lets `/app` render once one does.
- The create page validates the name, submits, sets the active workspace and
  navigates to `/app`.
- The backend's refusal message is rendered on error.
- An account that already has a workspace never sees the gate.

# AUREA Production

This phase makes AUREA production-ready.

The system moves from a proven growth loop to a reliable, secure, and operable product.

It addresses scaling, reliability, security, compliance, cost control, observability, backups, rate limiting, billing, and onboarding.

This phase does not add new growth capabilities.

It hardens everything built in prior phases.

The goal is launch readiness.

---

# 1. Objective

Prepare AUREA for real customers at scale.

The system must be reliable, secure, compliant, observable, cost-controlled, and commercially operable.

Multi-tenant data isolation must be enforced and verified.

The objective is to reach launch readiness with defined service levels and operational confidence.

```text
Proven Growth Loop (Phases 07–11)
            ↓
Scaling + Reliability
            ↓
Security + Compliance
            ↓
Observability + Cost Control
            ↓
Backups + DR
            ↓
Billing + Onboarding
            ↓
Launch Readiness
```

---

# 2. Scope

## 2.1 Scaling

Ensure the platform scales with tenants, workspaces, and workload.

```text
Stateless API services (horizontal scaling)
Worker scaling for BullMQ queues
Database connection pooling
Read replicas where justified
Queue partitioning by workload type
Caching for hot read paths
```

Load testing must validate target capacity.

## 2.2 Reliability and SLOs

Define and measure service level objectives.

```text
API availability SLO
API latency SLO
Job processing latency SLO
Integration execution success rate SLO
Webhook processing SLO
```

Support reliability mechanisms.

```text
Health and readiness checks
Graceful shutdown and draining
Dead letter queue operations
Retry with controlled backoff
Circuit breaking for failing providers
Idempotent consumers
```

Error budgets guide release decisions.

## 2.3 Security and Compliance

Enforce security across the platform.

```text
Multi-tenant data isolation (Organization → Workspace)
Row-level scoping on every query
Secrets management (no plain secrets in the database)
Token and credential encryption at rest
Least-privilege integration scopes
Authentication and authorization on every endpoint
Role-based access (OWNER / ADMIN / MEMBER / VIEWER)
Input validation and output encoding
Audit logging for sensitive operations
```

Data isolation must be verified by automated tests.

A cross-tenant access attempt must fail.

## 2.4 Data Protection (LGPD / GDPR)

Support privacy and data protection requirements.

```text
PII classification and minimization
Data subject access requests
Right to erasure (with audit and soft-deletion rules)
Data retention policies
Data processing records
Region and residency considerations
Consent tracking where applicable
```

PII in AgentToolCall inputs and outputs must be handled per privacy rules.

Erasure must respect historical records that cannot be deleted, using anonymization where required.

## 2.5 Cost Controls

Control AI and infrastructure cost.

```text
AI cost tracking per AgentRun (tokens, model, provider)
Cost-aware model routing (simple tasks → cheaper models)
Per-workspace AI spend limits
Infrastructure cost monitoring
Alerting on cost anomalies
```

Cost data feeds billing and product decisions.

## 2.6 Observability and Alerting

Provide full operational visibility.

```text
Structured logging with correlation IDs
Distributed tracing across services and jobs
Metrics (system, business, integration, AI)
Dashboards for SLOs and key flows
Alerting on SLO breaches, failures, and cost anomalies
On-call escalation paths
```

Correlation IDs from the event architecture must flow through logs and traces.

## 2.7 Backups and Disaster Recovery

Protect data and define recovery targets.

```text
Automated PostgreSQL backups
Point-in-time recovery
Object storage durability and versioning
Backup restoration testing
Defined RPO and RTO
Disaster recovery runbook
```

Restores must be tested, not assumed.

## 2.8 Rate Limiting

Protect the platform and external providers.

```text
API rate limiting per tenant and per user
Integration call throttling per provider
Webhook ingestion rate limiting
Fair-use enforcement across workspaces
```

Rate limits align with guardrails from Phase 11.

## 2.9 Billing and Subscription

Introduce commercial operation.

```text
Subscription plans
Usage metering (AI cost, actions, integrations)
Plan limits and enforcement
Invoicing and payment provider integration
Upgrade / downgrade / cancellation flows
Billing audit records
```

Usage metering reuses AgentRun and action data.

## 2.10 Onboarding

Provide a reliable path from signup to value.

```text
Organization and workspace creation
Member invitation and roles
Guided business setup and context capture
Integration connection guidance
First goal, strategy, and experiment setup
```

Onboarding should lead a new tenant to a first useful growth recommendation.

## 2.11 Launch Readiness

Confirm the product is ready to serve customers.

```text
Security review completed
Compliance requirements met
SLOs defined and monitored
Runbooks and on-call in place
Backups and DR tested
Load and failure testing passed
Billing verified end to end
```

---

# 3. Dependencies

```text
Phases 07–11 — all growth and autonomy capabilities
Phase 00 — Foundation (infrastructure baseline)
Phase 02 — Identity (authentication and membership)
```

Shared platform capabilities.

```text
Event Bus (Redis + BullMQ)
PostgreSQL and object storage
AgentRun cost data
AuditLog
Integration credential storage
```

All prior phases must be functionally complete before hardening.

---

# 4. Deliverables

```text
Horizontal scaling for API and workers
Defined and monitored SLOs with error budgets
Verified multi-tenant data isolation with tests
Secrets management and credential encryption
Role-based access enforcement on all endpoints
LGPD / GDPR data protection controls (access, erasure, retention)
PII handling for AI tool calls
AI and infrastructure cost tracking and limits
Cost-aware model routing enforcement
Observability stack (logs, traces, metrics, dashboards)
Alerting and on-call escalation
Automated backups, PITR, and tested restores
Disaster recovery runbook with RPO / RTO
Rate limiting per tenant, user, and provider
Billing and subscription with usage metering
Onboarding flow to first recommendation
Launch readiness checklist completed
```

---

# 5. Out of Scope

```text
New growth capabilities or channels
New agents or autonomy levels beyond Phase 11
Speculative infrastructure not required for launch
Provider integrations not validated by the growth loop
```

This phase hardens existing capabilities.

It does not expand product scope.

---

# 6. Exit Criteria

```text
The platform scales to target capacity under load testing.
SLOs are defined, measured, and met, with error budgets tracked.
Multi-tenant isolation is enforced and cross-tenant access fails in tests.
Secrets and credentials are encrypted and never stored in plain fields.
Role-based access is enforced on every endpoint.
Data subject access and erasure requests can be fulfilled per LGPD / GDPR.
PII in AI tool calls is handled according to privacy rules.
AI and infrastructure costs are tracked, limited, and alerted.
Logs, traces, and metrics provide full observability with correlation IDs.
Backups are automated and restoration is tested against defined RPO / RTO.
Rate limiting protects the platform and external providers.
Billing, metering, and subscription flows work end to end.
A new tenant can onboard and reach a first useful recommendation.
The launch readiness checklist is complete.
```

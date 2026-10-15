# AUREA Integration Architecture

## 1. Purpose

AUREA integrates with external platforms to execute actions and collect data.

The integration architecture ensures that AUREA's core business logic remains independent from external providers.

The system should be able to replace or add providers without changing the Growth Brain.

---

# 2. Integration Principle

AUREA owns:

* Business context
* Goals
* Strategies
* Experiments
* Actions
* Outcomes
* Learning

External platforms own:

* Execution
* Platform-specific state
* Platform-specific APIs
* Platform-specific delivery

```text
AUREA
  │
  ▼
Integration Layer
  │
  ▼
External Platform
```

---

# 3. Integration Categories

AUREA integrations are grouped into:

```text
Social
Advertising
Analytics
CRM
Email
Automation
AI
Storage
Research
```

---

# 4. Integration Abstraction

Each integration should implement a consistent conceptual interface.

```text
connect()
disconnect()
health()
capabilities()
execute()
sync()
handleWebhook()
```

The actual implementation may vary by provider.

---

# 5. Connector

A Connector represents the provider-specific implementation.

Example:

```text
SocialIntegration
    │
    ├── PostizConnector
    ├── MetaConnector
    ├── LinkedInConnector
    └── TikTokConnector
```

The domain should depend on the integration capability.

It should not depend directly on the provider.

---

# 6. Integration Adapter

Adapters translate AUREA concepts into provider-specific APIs.

Example:

```text
AUREA Action
    ↓
Social Publishing Adapter
    ↓
Postiz API
```

AUREA should not expose provider-specific objects throughout the domain.

---

# 7. Postiz

Postiz may be used as the initial social publishing infrastructure.

Its responsibility may include:

* Social account connections
* Content scheduling
* Publishing
* Social channel execution

AUREA owns:

* Why content should be published
* Which goal it supports
* Which experiment it belongs to
* Which audience it targets
* What metric should be evaluated

Postiz is execution infrastructure.

It is not the AUREA Growth Brain.

---

# 8. OpenClaw

OpenClaw may serve as an agent runtime.

Its responsibilities may include:

* Agent execution
* Tool usage
* Long-running agent workflows
* AI task execution

AUREA remains responsible for:

* Agent definitions
* Business context
* Domain state
* Decisions
* Audit

OpenClaw is replaceable infrastructure.

---

# 9. n8n

n8n may be used as a workflow automation platform.

Possible use cases:

* Webhooks
* Scheduled jobs
* Integration workflows
* Data synchronization
* External automation

Critical business state must remain in AUREA.

n8n should not become the canonical business database.

---

# 10. Social Integrations

Potential integrations include:

* Instagram
* Facebook
* LinkedIn
* TikTok
* X
* YouTube

The social integration layer should support:

```text
Connect Account
Disconnect Account
Get Profile
Create Draft
Publish
Schedule
Get Post
Get Metrics
Handle Webhook
```

The exact capabilities depend on provider APIs.

---

# 11. Advertising Integrations

Potential integrations include:

* Meta Ads
* Google Ads
* TikTok Ads

The integration layer may support:

```text
Get Accounts
Get Campaigns
Get Ad Sets
Get Ads
Get Metrics

Create Campaign
Update Campaign
Pause Campaign
Update Budget
```

High-risk operations require authorization.

---

# 12. Analytics Integrations

Potential integrations include:

* GA4
* PostHog
* Platform analytics

Analytics integrations should support:

```text
Fetch Metrics
Fetch Events
Fetch Conversions
Fetch Attribution Data
Sync Historical Data
```

AUREA should normalize external metrics into a common internal representation where practical.

---

# 13. CRM Integrations

Potential integrations include:

* HubSpot
* Salesforce
* Pipedrive

Possible capabilities:

```text
Get Contacts
Create Contact
Update Contact
Get Deals
Get Pipeline
Sync Events
```

CRM data should remain external unless explicitly imported into AUREA knowledge.

---

# 14. Email Integrations

Potential providers include:

* Resend
* SendGrid
* Mailchimp

AUREA may use email integrations for:

* Campaign execution
* Transactional messaging
* Experimentation

Bulk messaging should respect approval and compliance requirements.

---

# 15. Research Integrations

Research capabilities may include:

* Web search
* Web page retrieval
* Document ingestion
* External research APIs

Research results should be stored with provenance.

---

# 16. Integration Authentication

Credentials should be stored securely.

The database should store references to credentials, not raw secrets where possible.

Tokens should be encrypted.

Access should be scoped to the minimum required permissions.

---

# 17. Integration Health

Every integration should expose health information.

Example:

```text
CONNECTED
DEGRADED
EXPIRED
DISCONNECTED
ERROR
```

Health checks should not expose sensitive credentials.

---

# 18. Webhooks

External providers may send events to AUREA.

The webhook flow is:

```text
External Provider
      ↓
Webhook Endpoint
      ↓
Signature Validation
      ↓
Event Normalization
      ↓
Internal Event
      ↓
Event Bus
      ↓
Consumer
```

Webhook handlers should be idempotent.

---

# 19. Synchronization

Integrations may use:

### Pull

AUREA periodically retrieves external data.

### Push

External provider sends webhooks.

### Hybrid

AUREA uses both.

The preferred approach depends on provider capabilities.

---

# 20. External Data Normalization

External systems use different schemas.

AUREA should normalize important cross-provider concepts.

Example:

```text
External Campaign
        ↓
Normalized Campaign
```

The normalized model should preserve:

* Provider
* External ID
* Original metadata

Normalization should be limited to concepts that provide real cross-provider value.

AUREA should not attempt to completely abstract every provider-specific capability.

---

# 21. Integration Failure

External failures should be classified.

```text
Authentication Error
Rate Limit
Validation Error
Provider Error
Network Error
Unknown Error
```

The integration layer should expose normalized errors to the rest of the platform.

---

# 22. Retry

Transient failures should be retried.

Examples:

* Network timeout
* Temporary provider outage
* Rate limit

Non-retryable errors should fail immediately.

---

# 23. Idempotency

Write operations should support idempotency whenever the provider allows it.

The system should prevent duplicate execution.

Example:

```text
AUREA Action ID: action-123

External Request:
idempotency-key = action-123
```

---

# 24. External References

AUREA should maintain mappings between internal and external entities.

Example:

```text
Action
    │
    └── ExternalReference
          │
          ├── Provider
          ├── EntityType
          ├── ExternalID
          └── Metadata
```

This allows providers to change without breaking AUREA's domain model.

---

# 25. Integration Events

Integrations should emit normalized events.

Examples:

```text
ExternalActionSucceeded
ExternalActionFailed
ExternalDataSynced
ExternalCampaignUpdated
SocialPostPublished
```

These events may trigger:

* Analytics
* Outcome processing
* Notifications
* Learning

---

# 26. Integration Architecture Principle

AUREA should own the intelligence.

External platforms should provide specialized capabilities.

```text
AUREA
│
├── Think
├── Decide
├── Coordinate
├── Measure
└── Learn
      │
      ▼
External Systems
│
├── Execute
├── Deliver
├── Store platform state
└── Provide data
```

The integration layer is the boundary between AUREA's intelligence and the external growth ecosystem.

---

# 27. Initial Integration Strategy

The first integrations should be selected based on the MVP growth loop.

Priority should be:

1. Research / Web
2. Analytics
3. Social publishing
4. Content execution
5. Advertising
6. CRM
7. Email

The exact order may change according to product validation.

AUREA should not build an integration simply because it is technically interesting.

Each integration must contribute to validating the growth loop.

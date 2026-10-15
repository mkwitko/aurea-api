# AUREA System Overview

## Purpose

AUREA is an AI Growth Operating System.

Its responsibility is not to replace specialized marketing tools.

Its responsibility is to coordinate intelligence across them.

The platform should understand a business, define goals, generate strategies,
run experiments, measure results and continuously improve future decisions.

---

# High Level Architecture

                        User
                          │
                          ▼
                   AUREA Web App
                          │
                          ▼
                    API Gateway
                          │
        ┌─────────────────┼──────────────────┐
        │                 │                  │
        ▼                 ▼                  ▼
 Growth Brain        Agent Runtime     Integrations
        │                 │                  │
        │                 │                  │
        ▼                 ▼                  ▼
 PostgreSQL         OpenClaw Agents      External APIs
        │
        ▼
 Knowledge Base

---

# Core Layers

The system is divided into six layers.

1. Presentation

Responsible for:

- Dashboard
- Settings
- Reports
- Approvals
- Workspaces

---

2. API

Responsible for:

- Authentication
- Authorization
- REST API
- Webhooks
- Event publishing

---

3. Growth Brain

The Growth Brain is the heart of the platform.

It owns:

- Business Context
- Goals
- Strategies
- Hypotheses
- Experiments
- Actions
- Outcomes
- Learned Knowledge

No other subsystem owns business truth.

---

4. AI Layer

Responsible for:

- Reasoning
- Planning
- Recommendations
- Agent execution
- LLM Routing

This layer never owns data.

It consumes Growth Brain context.

---

5. Integration Layer

Responsible for:

- Social Media
- Ads
- Analytics
- CRM
- Email
- Automation

Integrations execute actions.

They never make business decisions.

---

6. Observability

Responsible for:

- Logs
- Metrics
- Agent history
- Decision history
- Audit
- Cost monitoring

---

# Guiding Principles

The platform always follows:

Business Context

↓

Goals

↓

Strategy

↓

Experiments

↓

Execution

↓

Measurement

↓

Learning

↓

Updated Context

Every subsystem contributes to this loop.

---

# What AUREA Is NOT

AUREA is not:

- Another ChatGPT wrapper
- Another social scheduler
- Another CRM
- Another BI platform
- Another Ads Manager

Those remain integrations.

AUREA owns intelligence.
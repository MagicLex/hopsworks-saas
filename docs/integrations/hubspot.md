# HubSpot Integration

## Overview

The HubSpot integration validates corporate (prepaid) registrations by checking the deal referenced in the `corporate_ref` URL parameter. Only contacts attached to an approved deal can complete signup; others are blocked before Auth0 login completes.

## Environment Variables

| Name             | Purpose                                   |
|------------------|-------------------------------------------|
| `HUBSPOT_API_KEY`| HubSpot private app token with CRM scopes |

## Required Scopes

The private app must have these read scopes:
- `crm.objects.deals.read` – confirm the deal exists and fetch stage data
- `crm.objects.contacts.read` – retrieve associated contact emails
- `crm.objects.companies.read` – optional, supplies company metadata for UI

## Data Flow

1. User hits the marketing site with `?corporate_ref=<dealId>`.
2. `POST /api/auth/validate-corporate` queries HubSpot for the deal and company summary.
3. Frontend stores the reference in session storage for use after Auth0 login.
4. During signup, backend revalidates the deal and ensures the user’s email matches a contact on the deal.
5. On success the system sets `billing_mode = 'prepaid'`, stores `metadata.corporate_ref`, and assigns a cluster immediately.

## Key Endpoints

| Endpoint                             | Notes                                              |
|--------------------------------------|----------------------------------------------------|
| `POST /api/auth/validate-corporate`  | Called from the landing page to validate deal IDs  |
| `GET /api/user/corporate-info`       | Returns company name/logo for dashboards           |

## Failure Handling

- Invalid or expired deal ID → UI strips the parameter and shows an error banner.
- Email not listed on the HubSpot deal → registration blocked with an audit log entry.
- HubSpot outages/timeouts → treat as failure, defaulting the user back to standard SaaS signup.

## Operations

- Rotate `HUBSPOT_API_KEY` via HubSpot’s private app settings and update Vercel secrets.
- Monitor HubSpot API usage in the private app dashboard; heavy traffic should stay well below quota.
- Corporate usage queries and manual admin overrides are documented in [corporate registration](../features/corporate-registration.md).

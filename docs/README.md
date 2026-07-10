# Hopsworks Managed Documentation

## Architecture

- [Overview](architecture/overview.md) - System design, SaaS/Hopsworks boundary, integrations
- [Database](architecture/database.md) - Supabase schema and connection
- [Security](architecture/security.md) - Auth, permissions, API keys

## Features

- [Billing](features/billing.md) - OpenCost ingestion, Stripe metered billing
- [Team Management](features/team-management.md) - Account owners, team members, project access
- [User Lifecycle](features/user-lifecycle.md) - Status transitions, suspension/reactivation, cascade effects
- [Account Deletion](features/account-deletion.md) - Soft delete, recovery, compliance
- [Corporate Registration](features/corporate-registration.md) - HubSpot deal validation, prepaid onboarding

## Integrations

- [Stripe](integrations/stripe.md) - Payment setup, webhooks, test mode
- [HubSpot](integrations/hubspot.md) - Corporate deal validation
- [Resend](integrations/resend.md) - Team invite delivery

## Operations

- [Deployment](operations/deployment.md) - Vercel deployment, environment config
- [SAAS Cluster](operations/saas-cluster.md) - Infrastructure TLDR (OVH, K8s, access levels)
- [Cluster Setup](operations/cluster-setup.md) - New Hopsworks cluster onboarding
- [OpenCost Collection](operations/opencost-collection.md) - Hourly metrics collection job
- [Health Checks](operations/health-checks.md) - Monitoring and diagnostics

## Reference

- [API](reference/api.md) - Endpoints and admin tools
- [Hopsworks API](reference/hopsworks-api.md) - Hopsworks cluster API endpoints
- [Database Schema](reference/database/) - Detailed table documentation
- [Metering Queries](reference/metering-queries.md) - Quick reference for compute and storage queries

## Troubleshooting

- [Known Issues](troubleshooting/known-issues.md) - Common problems and fixes
- [Investigations](troubleshooting/investigations.md) - Research notes
- [Hopsworks DB Access](troubleshooting/hopsworks-db-access.md) - Query Hopsworks MySQL
- [User Creation Workaround](troubleshooting/user-creation-workaround.md) - POST /admin/users bug and solutions

## Testing

- [Tests](../tests/README.md) - Test structure, commands, Stripe webhook testing

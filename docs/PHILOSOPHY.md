# Philosophy

A SaaS bridge that handles user signup, billing, and cluster assignment on top of shared Hopsworks Feature Store clusters.

## What it does

Sits between the customer and Hopsworks. Owns the lifecycle Hopsworks does not: Auth0 login, Stripe metered billing from OpenCost usage, team management, cluster assignment, prepaid/postpaid onboarding via HubSpot or promo codes.

## Who it is for

- Self-service postpaid users (signup with card, billed monthly on OpenCost-derived usage).
- Prepaid users (promo code or HubSpot-validated corporate deal, invoiced off-platform).
- Team members invited by an account owner (usage aggregated to the owner).

## What it is not

- Not Hopsworks. Hopsworks owns projects, feature groups, models, jobs. We do not duplicate that state.
- Not a feature-store UI. The dashboard surfaces account, billing, and cluster status. Project-level work happens in the Hopsworks UI.
- Not a billing engine. Stripe is the source of truth for invoices and subscriptions. We feed it metered usage.
- Not multi-tenant inside one cluster boundary that we manage. Cluster tenancy and project isolation are Hopsworks concerns.

## Source of truth, by domain

- Auth0: identity.
- Supabase (`users`, `user_projects`, `usage_daily`, `hopsworks_clusters`): SaaS state.
- Hopsworks: projects, feature store, jobs.
- Stripe: invoices, subscriptions, payment status.
- OpenCost (in-cluster): raw compute and storage usage.
- HubSpot: corporate deal validation only.

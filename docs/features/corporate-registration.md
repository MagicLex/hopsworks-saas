# corporate-registration

## overview

corporate accounts use a prepaid billing model with external invoicing. these accounts bypass stripe payment requirements and receive immediate cluster access upon registration. operational details for the HubSpot deal validation live in [HubSpot integration](../integrations/hubspot.md).

## registration-process

### link generation
corporate registration links follow this format:
```
https://run.hopsworks.ai/?corporate_ref=deal_id
```

the `deal_id` corresponds to:
- hubspot deal id (e.g., `16586605456`)
- must be a valid deal id in hubspot

### user registration flow
when a user accesses the corporate registration link:
1. the system validates the deal exists immediately upon page load
2. if invalid, shows error message and removes the parameter
3. if valid, displays corporate registration messaging
4. the system captures the `corporate_ref` parameter (deal id)
5. user proceeds through standard auth0 authentication
6. backend validates the registration:
   - fetches deal from hubspot api using the ref id
   - retrieves all contacts associated with the deal
   - verifies auth0 email matches one of the contact emails
   - optionally checks deal stage (e.g., closed won)
7. if validation passes:
   - sets `billing_mode = 'prepaid'`
   - stores the deal id in `metadata.corporate_ref`
   - assigns a hopsworks cluster immediately
   - creates user credit records
8. if validation fails (email mismatch or invalid deal):
   - rejects registration
   - logs attempt for security monitoring
   - redirects to standard registration flow

### database fields
corporate users are identified by:
- `billing_mode`: set to `'prepaid'`
- `metadata.corporate_ref`: contains the reference id from registration
- `registration_source`: set to `'corporate'`

## team-management

corporate account owners can invite team members through the standard team invitation system. team members:
- inherit the prepaid billing mode from the account owner
- are assigned to the same cluster as the account owner
- have their usage aggregated under the account owner

## usage-tracking

### monthly usage query
```sql
select 
  u.email,
  u.name,
  u.metadata->>'corporate_ref' as reference_id,
  date_trunc('month', ud.date) as month,
  sum(ud.total_cost) as total_usage,
  sum(ud.opencost_cpu_hours) as cpu_hours,
  sum(ud.opencost_gpu_hours) as gpu_hours,
  sum(ud.online_storage_gb) as storage_gb
from users u
join usage_daily ud on u.id = ud.user_id
where u.billing_mode = 'prepaid'
  and u.metadata->>'corporate_ref' is not null
  and ud.date >= date_trunc('month', current_date)
group by u.id, u.email, u.name, u.metadata->>'corporate_ref', date_trunc('month', ud.date);
```

### team usage aggregation
```sql
select 
  owner.email as account_owner,
  owner.metadata->>'corporate_ref' as reference_id,
  date_trunc('month', ud.date) as month,
  count(distinct coalesce(u.id, owner.id)) as team_size,
  sum(ud.total_cost) as total_team_usage
from users owner
left join users u on u.account_owner_id = owner.id
left join usage_daily ud on ud.user_id in (owner.id, u.id)
where owner.billing_mode = 'prepaid'
  and owner.account_owner_id is null
  and owner.metadata->>'corporate_ref' is not null
group by owner.id, owner.email, owner.metadata->>'corporate_ref', date_trunc('month', ud.date);
```

## admin-operations

### setting corporate status manually
```sql
-- convert existing user to corporate prepaid
update users 
set 
  billing_mode = 'prepaid',
  metadata = jsonb_set(
    coalesce(metadata, '{}'::jsonb),
    '{corporate_ref}',
    '"DEAL-123"'
  )
where email = 'user@company.com';
```

### finding corporate accounts
```sql
-- list all corporate accounts
select 
  id,
  email,
  name,
  metadata->>'corporate_ref' as reference_id,
  created_at,
  (select count(*) from users where account_owner_id = u.id) as team_members
from users u
where billing_mode = 'prepaid'
  and account_owner_id is null
order by created_at desc;
```

## external-integrations

the `corporate_ref` field in metadata enables direct correlation with external systems:

### hubspot integration
- deal id stored in `metadata.corporate_ref`
- validation requires hubspot api access with scopes:
  - `crm.objects.deals.read` - verify deal exists and read properties
  - `crm.objects.contacts.read` - get associated contact emails
- email validation ensures only authorized contacts can register
- usage data can be pushed to hubspot custom properties
- invoice generation triggered based on hubspot deal stage

### security
- hubspot api key stored in environment variable `HUBSPOT_API_KEY`
- all registration attempts logged for audit trail
- invalid deal ids or email mismatches blocked
- prevents unauthorized access to prepaid billing mode

### accounting workflow
1. monthly usage reports generated using the queries above
2. reference id links usage to specific contracts
3. invoices created in accounting system with matching reference
4. payment reconciliation uses the reference id for matching

## api-endpoints

### corporate validation
`post /api/auth/validate-corporate`
validates hubspot deal id and email match for corporate registration

### usage report
`get /api/usage`
returns detailed usage data for corporate accounts, aggregated by team

### team management
- `post /api/team/invite` - invite team members
- `get /api/team/members` - list team members
- `delete /api/team/members/:id` - remove team member

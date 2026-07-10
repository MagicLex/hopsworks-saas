# Known Issues & Solutions

## Build/Deployment Issues

### 1. React Unescaped Entities
**Error**: `Error: '`' can be escaped with &apos;, &lsquo;, &#39;, &rsquo;. react/no-unescaped-entities`

**Solution**: Replace apostrophes with `&apos;` in JSX text content:
```jsx
// ❌ Bad
<Text>You'll be logged in</Text>

// ✅ Good
<Text>You&apos;ll be logged in</Text>
```

### 2. Auth0 Environment Variables in Vercel
**Error**: `"baseURL" must be a valid uri`

**Solution**: Environment variables in Vercel must not have trailing newlines or spaces:
- ❌ `AUTH0_BASE_URL`: `https://hopsworks-managed.vercel.app\n`
- ✅ `AUTH0_BASE_URL`: `https://hopsworks-managed.vercel.app`
- ❌ `AUTH0_ISSUER_BASE_URL`: `dev-fur3a3gej0xmnk7f.eu.auth0.com`
- ✅ `AUTH0_ISSUER_BASE_URL`: `https://dev-fur3a3gej0xmnk7f.eu.auth0.com`

**Important**: Use Vercel dashboard to set variables, not CLI with echo/printf.

### 3. Tailwind-Quartz Component API Changes
**Error**: Component props not recognized (variant, size, wrap, etc.)

**Solution**: Check actual component API:
```jsx
// ❌ Bad - These props don't exist
<Button variant="primary" size="sm" />
<Flex wrap="wrap" />

// ✅ Good - Use correct props
<Button intent="primary" />
<Flex className="flex-wrap" />
```

### 4. Auth0 SDK Version
**Error**: Import errors with @auth0/nextjs-auth0 v4

**Solution**: Must use Auth0 SDK v3, not v4:
```json
"@auth0/nextjs-auth0": "^3.8.0"  // NOT ^4.x.x
```

## Authentication Issues

### 1. Static Export with API Routes
**Error**: API routes don't work with `output: 'export'`

**Solution**: Remove static export from next.config.js:
```js
// Remove this line:
// output: 'export',
```

### 2. Auth0 Callback URLs
**Issue**: Auth0 redirects fail

**Solution**: Add all callback URLs to Auth0 dashboard:
- `https://hopsworks-managed.vercel.app/api/auth/callback`
- `https://hopsworks-managed.vercel.app/api/auth/login`
- `https://hopsworks-managed.vercel.app/`

## Development Tips

### 1. Environment Variables
Create `.env.local` with:
```env
AUTH0_SECRET=<32-byte-hex>  # Generate: openssl rand -hex 32
AUTH0_BASE_URL=http://localhost:3000  # No trailing slash!
AUTH0_ISSUER_BASE_URL=https://your-domain.auth0.com  # With https://
AUTH0_CLIENT_ID=<your-client-id>
AUTH0_CLIENT_SECRET=<your-client-secret>
```

### 2. TypeScript Strict Checks
When using tailwind-quartz components, check the actual exported types:
```bash
# Check what's actually exported
grep -r "export" node_modules/tailwind-quartz/dist/
```

### 3. Next.js Build Errors
Always run locally before deploying:
```bash
npm run build
npm run start
```

## Hopsworks Integration

### 1. Project Quota Counts Created, Not Active (Workaround Active)

**Status**: Workaround active, pending Hopsworks fix

**Issue**: Hopsworks counts **created** projects against `maxNumProjects` quota, not **active** ones. When a user deletes a project, the quota slot is permanently consumed. A free user (limit=1) who creates and deletes a project can never create another one.

**Root cause**: No Hopsworks -> SaaS webhook exists. The bridge only discovers deletions by polling.

**Workaround**: Three changes work together:

1. **`project-sync.ts`**: when the cron detects a project was deleted (marked inactive), it bumps `maxNumProjects` by the number of deleted projects via `updateUserProjectLimit`.

2. **One-way ratchet on `maxNumProjects`**: every call site that writes `maxNumProjects` now uses a `<` guard instead of `!==`. This means the value can only go UP, never be reset down. This prevents Health Check 5, cluster assignment, Stripe webhooks, and billing APIs from undoing the workaround bump.

   **Files with the ratchet guard** (11 call sites total):
   - `src/pages/api/auth/sync-user.ts` (Health Check 5)
   - `src/lib/cluster-assignment.ts` (2 locations)
   - `src/pages/api/webhooks/stripe.ts` (3 locations: upgrade, sub deleted, payment removed)
   - `src/pages/api/billing.ts` (2 locations: upgrade, downgrade)
   - `src/pages/api/billing/setup-payment.ts` (1 location)
   - `src/lib/project-sync.ts` (workaround bump, structurally additive)
   - `src/pages/api/admin/fix-project-quotas.ts` (one-off fix)

3. **`hopsworks-info.ts`**: always fetches projects fresh from Hopsworks instead of using cache, so deleted projects never show in the UI.

**Important for future developers**: If you add a new call to `updateUserProjectLimit`, you **MUST** follow the ratchet pattern:
```typescript
const hwUser = await getHopsworksUserById(credentials, userId);
if (hwUser && (hwUser.maxNumProjects ?? 0) < desiredLimit) {
  await updateUserProjectLimit(credentials, userId, desiredLimit);
}
```
Never use `!==`: it will reset the workaround and lock users out of creating projects.

**One-off fix for existing users**: `POST /api/admin/fix-project-quotas`
- Finds all users with inactive (deleted) projects
- Computes `baseLimit + deletedCount` (idempotent, safe to run multiple times)
- Supports `{ "dryRun": true }` to preview before applying
- See the admin tools table in `docs/OPS.md`

**TODO**: Remove workaround when Hopsworks counts active projects instead of created.

### 2. SSO Configuration
Hopsworks Identity Provider needs:
- Connection URL: `https://dev-fur3a3gej0xmnk7f.eu.auth0.com`
- Email claim: `email`
- Given name claim: `given_name`
- Family name claim: `family_name`

### 3. CORS Issues
If CORS errors occur with Hopsworks API:
- Add your domain to Hopsworks allowed origins
- Use server-side API routes to proxy requests

**Note**: Existing projects in DB may have stale namespace values. Run project sync to update: `POST /api/cron/sync-projects`
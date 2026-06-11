/**
 * Sync User Health Check Tests
 *
 * Tests the user sync and health check logic.
 * If these break, users may get wrong project limits,
 * or Hopsworks/Supabase may get out of sync.
 */

import { describe, it, expect } from 'vitest';
import { calculateMaxNumProjects } from '@/lib/cluster-assignment';

describe('maxNumProjects calculation', () => {
  // These tests use the exported function from cluster-assignment
  // which is the same logic used in sync-user

  it('team members always get 0 projects', () => {
    // Team members can never create projects, only access owner projects
    expect(calculateMaxNumProjects(true, false, false, false)).toBe(0);
    expect(calculateMaxNumProjects(true, true, false, false)).toBe(0);
    expect(calculateMaxNumProjects(true, false, true, false)).toBe(0);
    expect(calculateMaxNumProjects(true, true, true, true)).toBe(0);
  });

  it('free tier owners get 1 project', () => {
    expect(calculateMaxNumProjects(false, false, false, true)).toBe(1);
  });

  it('paid owners get 5 projects', () => {
    // With subscription
    expect(calculateMaxNumProjects(false, true, false, false)).toBe(5);
    // With prepaid
    expect(calculateMaxNumProjects(false, false, true, false)).toBe(5);
    // Both (shouldn't happen, but should still be 5)
    expect(calculateMaxNumProjects(false, true, true, false)).toBe(5);
  });

  it('owners without any billing get 0 projects', () => {
    // No subscription, not prepaid, not free = can't create projects
    expect(calculateMaxNumProjects(false, false, false, false)).toBe(0);
  });
});

describe('health check patterns', () => {
  it('sync-user does not reconcile Hopsworks state (event-driven via webhook)', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const sourceFile = path.join(process.cwd(), 'src/pages/api/auth/sync-user.ts');
    const source = fs.readFileSync(sourceFile, 'utf-8');

    // Health checks 3-7 were removed: no per-login maxNumProjects push,
    // no Hopsworks user creation at login
    expect(source).not.toContain('updateUserProjectLimit');
    expect(source).not.toContain('createHopsworksOAuthUser');

    // The webhook receiver owns user linking now
    const webhookFile = path.join(process.cwd(), 'src/pages/api/webhooks/hopsworks-lifecycle.ts');
    const webhook = fs.readFileSync(webhookFile, 'utf-8');
    expect(webhook).toContain('handleUserUpserted');
    expect(webhook).toContain('hopsworks_user_id');
  });

  it('creates hopsworks user with retry logic', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const sourceFile = path.join(process.cwd(), 'src/lib/cluster-assignment.ts');
    const source = fs.readFileSync(sourceFile, 'utf-8');

    // Should have retry loop
    expect(source).toContain('maxRetries');
    expect(source).toContain('for (let attempt');

    // Should have exponential backoff
    expect(source).toContain('Math.pow(2, attempt)');
  });

  it('logs health check failures to database', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const sourceFile = path.join(process.cwd(), 'src/lib/cluster-assignment.ts');
    const source = fs.readFileSync(sourceFile, 'utf-8');

    // Should log failures
    expect(source).toContain('health_check_failures');
    expect(source).toContain('hopsworks_user_creation');
  });
});

describe('sync-user security patterns', () => {
  it('validates auth0 token before processing', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const sourceFile = path.join(process.cwd(), 'src/pages/api/auth/sync-user.ts');
    const source = fs.readFileSync(sourceFile, 'utf-8');

    // Must have auth check
    expect(source).toContain('getSession');
  });

  it('uses admin supabase client for privileged operations', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const sourceFile = path.join(process.cwd(), 'src/pages/api/auth/sync-user.ts');
    const source = fs.readFileSync(sourceFile, 'utf-8');

    // Should use service role key for admin operations
    expect(source).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
});

describe('user state consistency', () => {
  it('syncs hopsworks_user_id to both users and assignments tables', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const sourceFile = path.join(process.cwd(), 'src/lib/cluster-assignment.ts');
    const source = fs.readFileSync(sourceFile, 'utf-8');

    // Should update users table
    expect(source).toContain("from('users')");
    expect(source).toContain('hopsworks_user_id');

    // Should update assignments table
    expect(source).toContain("from('user_hopsworks_assignments')");
  });

  it('validates hopsworks user ID is positive', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const sourceFile = path.join(process.cwd(), 'src/lib/hopsworks-api.ts');
    const source = fs.readFileSync(sourceFile, 'utf-8');

    // Should validate ID > 0 (bug fix from earlier)
    expect(source).toContain('fullUser.id <= 0');
    expect(source).toContain('invalid ID');
  });
});

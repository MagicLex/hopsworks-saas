/**
 * Signup-time abuse gates: disposable emails, abuse-IP reuse, per-IP velocity.
 * These run BEFORE account creation in sync-user.
 */

import { describe, it, expect } from 'vitest';
import { checkSignupAbuse, isDisposableEmail, isCardRequiredEmail } from '@/lib/signup-abuse';

function supabaseStub(rows: any[], error: any = null) {
  return {
    from: () => ({
      select: () => ({
        eq: async () => ({ data: rows, error }),
      }),
    }),
  };
}

const IP = '13.244.10.20';

describe('isDisposableEmail', () => {
  it('blocks community-list domains', () => {
    expect(isDisposableEmail('miner@mailinator.com')).toBe(true);
  });

  it('blocks our extra domains missing from the community list', () => {
    expect(isDisposableEmail('barrettloudermilk@bltiwd.com')).toBe(true);
  });

  it('allows regular providers', () => {
    expect(isDisposableEmail('dev@gmail.com')).toBe(false);
    expect(isDisposableEmail('qa@witnessai.com')).toBe(false);
  });
});

describe('isCardRequiredEmail', () => {
  it('flags anonymity-friendly providers (card-before-free, not blocked)', () => {
    expect(isCardRequiredEmail('gregorygnatt@proton.me')).toBe(true);
    expect(isCardRequiredEmail('x@protonmail.com')).toBe(true);
    expect(isCardRequiredEmail('x@pm.me')).toBe(true);
  });

  it('does not flag mainstream providers', () => {
    expect(isCardRequiredEmail('dev@gmail.com')).toBe(false);
    expect(isCardRequiredEmail('qa@witnessai.com')).toBe(false);
  });
});

describe('checkSignupAbuse', () => {
  it('blocks disposable emails before any DB query', async () => {
    const reason = await checkSignupAbuse(supabaseStub([]), 'x@mailinator.com', IP, false);
    expect(reason).toMatch(/disposable/);
  });

  it('blocks when the IP matches an abuse-suspended account', async () => {
    const rows = [{
      status: 'suspended',
      metadata: { suspension_reason: 'abuse' },
      registration_ip: `${IP}, 10.0.0.1`,
      created_at: '2026-01-01T00:00:00Z',
    }];
    const reason = await checkSignupAbuse(supabaseStub(rows), 'new@gmail.com', IP, false);
    expect(reason).toMatch(/abuse-suspended/);
  });

  it('does NOT block on billing suspensions from the same IP', async () => {
    const rows = [{
      status: 'suspended',
      metadata: { suspension_reason: 'payment_deadline' },
      registration_ip: IP,
      created_at: '2026-01-01T00:00:00Z',
    }];
    const reason = await checkSignupAbuse(supabaseStub(rows), 'colleague@corp.com', IP, false);
    expect(reason).toBeNull();
  });

  it('does not match longer IPs sharing a prefix', async () => {
    const rows = [{
      status: 'suspended',
      metadata: { suspension_reason: 'abuse' },
      registration_ip: '13.244.10.200',
      created_at: '2026-01-01T00:00:00Z',
    }];
    const reason = await checkSignupAbuse(supabaseStub(rows), 'new@gmail.com', '13.244.10.20', false);
    expect(reason).toBeNull();
  });

  it('blocks the third signup from one IP within 24h', async () => {
    const now = new Date().toISOString();
    const rows = [
      { status: 'active', metadata: {}, registration_ip: IP, created_at: now },
      { status: 'active', metadata: {}, registration_ip: IP, created_at: now },
    ];
    const reason = await checkSignupAbuse(supabaseStub(rows), 'third@gmail.com', IP, false);
    expect(reason).toMatch(/24h/);
  });

  it('allows a second signup from one IP (office NAT)', async () => {
    const rows = [
      { status: 'active', metadata: {}, registration_ip: IP, created_at: new Date().toISOString() },
    ];
    const reason = await checkSignupAbuse(supabaseStub(rows), 'second@corp.com', IP, false);
    expect(reason).toBeNull();
  });

  it('ignores old signups for velocity', async () => {
    const rows = [
      { status: 'active', metadata: {}, registration_ip: IP, created_at: '2026-01-01T00:00:00Z' },
      { status: 'active', metadata: {}, registration_ip: IP, created_at: '2026-01-02T00:00:00Z' },
    ];
    const reason = await checkSignupAbuse(supabaseStub(rows), 'new@gmail.com', IP, false);
    expect(reason).toBeNull();
  });

  it('invite token bypasses IP checks but not the disposable check', async () => {
    const now = new Date().toISOString();
    const rows = [
      { status: 'active', metadata: {}, registration_ip: IP, created_at: now },
      { status: 'active', metadata: {}, registration_ip: IP, created_at: now },
    ];
    expect(await checkSignupAbuse(supabaseStub(rows), 'invitee@corp.com', IP, true)).toBeNull();
    expect(await checkSignupAbuse(supabaseStub([]), 'invitee@mailinator.com', IP, true)).toMatch(/disposable/);
  });

  it('fails open on DB errors and private IPs', async () => {
    expect(await checkSignupAbuse(supabaseStub([], new Error('boom')), 'x@gmail.com', IP, false)).toBeNull();
    expect(await checkSignupAbuse(supabaseStub([]), 'x@gmail.com', '127.0.0.1', false)).toBeNull();
    expect(await checkSignupAbuse(supabaseStub([]), 'x@gmail.com', undefined, false)).toBeNull();
  });
});

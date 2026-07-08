import { describe, it, expect } from 'vitest';
import { resolveOnboardingState, OnboardingInput, OnboardingUserRow } from '@/lib/onboarding';

function owner(overrides: Partial<OnboardingUserRow> = {}): OnboardingUserRow {
  return {
    deletedAt: null,
    status: 'active',
    accountOwnerId: null,
    termsAcceptedAt: '2026-07-01T00:00:00Z',
    billingMode: 'free',
    hasSubscription: false,
    ...overrides,
  };
}

function input(overrides: Partial<OnboardingInput> = {}): OnboardingInput {
  return {
    authenticated: true,
    emailVerified: true,
    user: owner(),
    hasClusterAssignment: true,
    ...overrides,
  };
}

describe('resolveOnboardingState', () => {
  it('unauthenticated wins over everything', () => {
    expect(resolveOnboardingState(input({ authenticated: false })).state).toBe('unauthenticated');
  });

  it('deleted user is terminal even with a full setup', () => {
    expect(
      resolveOnboardingState(input({ user: owner({ deletedAt: '2026-01-01T00:00:00Z' }) })).state
    ).toBe('deleted');
  });

  describe('no DB row yet', () => {
    it('unverified email blocks account creation', () => {
      const r = resolveOnboardingState(input({ user: null, emailVerified: false }));
      expect(r.state).toBe('email_unverified');
    });

    it('verified email without a row means sync must (re)run', () => {
      const r = resolveOnboardingState(input({ user: null, emailVerified: true }));
      expect(r).toEqual({ state: 'needs_account', detail: 'account_missing' });
    });

    it('missing claim passes (SSO connections without email_verified)', () => {
      const r = resolveOnboardingState(input({ user: null, emailVerified: null }));
      expect(r).toEqual({ state: 'needs_account', detail: 'account_missing' });
    });
  });

  it('suspended user is routed to recovery regardless of cluster', () => {
    expect(
      resolveOnboardingState(input({ user: owner({ status: 'suspended' }) })).state
    ).toBe('suspended');
  });

  describe('existing user with unverified claim', () => {
    it('does not lock out an existing account (mirrors sync-user creation-only gate)', () => {
      expect(resolveOnboardingState(input({ emailVerified: false })).state).toBe('ready');
    });
  });

  describe('team members', () => {
    it('ready when cluster assigned, no terms/payment gates', () => {
      const member = owner({ accountOwnerId: 'owner-1', termsAcceptedAt: null, billingMode: null });
      expect(resolveOnboardingState(input({ user: member })).state).toBe('ready');
    });

    it('assigning_cluster when not yet on the owner cluster', () => {
      const member = owner({ accountOwnerId: 'owner-1' });
      expect(
        resolveOnboardingState(input({ user: member, hasClusterAssignment: false })).state
      ).toBe('assigning_cluster');
    });
  });

  describe('terms and plan', () => {
    it('no terms -> needs_account', () => {
      const r = resolveOnboardingState(input({ user: owner({ termsAcceptedAt: null }) }));
      expect(r).toEqual({ state: 'needs_account', detail: 'terms_or_plan' });
    });

    it('no billing_mode (limbo account) -> needs_account', () => {
      const r = resolveOnboardingState(input({ user: owner({ billingMode: null }) }));
      expect(r).toEqual({ state: 'needs_account', detail: 'terms_or_plan' });
    });
  });

  describe('payment gate', () => {
    it('postpaid without subscription -> needs_payment', () => {
      const r = resolveOnboardingState(input({ user: owner({ billingMode: 'postpaid' }) }));
      expect(r.state).toBe('needs_payment');
    });

    it('postpaid with subscription and cluster -> ready', () => {
      const r = resolveOnboardingState(
        input({ user: owner({ billingMode: 'postpaid', hasSubscription: true }) })
      );
      expect(r.state).toBe('ready');
    });

    it('free and prepaid skip the payment gate', () => {
      for (const billingMode of ['free', 'prepaid']) {
        const r = resolveOnboardingState(
          input({ user: owner({ billingMode }), hasClusterAssignment: false })
        );
        expect(r.state).toBe('assigning_cluster');
      }
    });
  });

  it('everything satisfied -> ready', () => {
    expect(resolveOnboardingState(input()).state).toBe('ready');
  });
});

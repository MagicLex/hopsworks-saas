// Server-side onboarding state machine. The state is always DERIVED from
// durable sources (Auth0 session claim, users row, cluster assignment) —
// never stored. Every consumer (gate, pages, APIs) reads the same resolution
// instead of recomputing its own guess from partial data.

export type OnboardingState =
  | 'unauthenticated'
  | 'email_unverified'
  | 'needs_account'
  | 'needs_payment'
  | 'assigning_cluster'
  | 'ready'
  | 'suspended'
  | 'deleted';

export type OnboardingDetail = 'account_missing' | 'terms_or_plan';

export interface OnboardingUserRow {
  deletedAt: string | null;
  status: string | null;
  accountOwnerId: string | null;
  termsAcceptedAt: string | null;
  billingMode: string | null;
  hasSubscription: boolean;
}

export interface OnboardingInput {
  authenticated: boolean;
  // Auth0 claim. Only explicit false blocks — a missing claim (some SSO
  // connections) passes, mirroring the sync-user creation gate.
  emailVerified: boolean | null | undefined;
  user: OnboardingUserRow | null;
  hasClusterAssignment: boolean;
}

export interface OnboardingResolution {
  state: OnboardingState;
  detail?: OnboardingDetail;
}

export function resolveOnboardingState(input: OnboardingInput): OnboardingResolution {
  if (!input.authenticated) {
    return { state: 'unauthenticated' };
  }

  const { user } = input;

  if (user?.deletedAt) {
    return { state: 'deleted' };
  }

  if (!user) {
    // No DB row yet: either sync-user refused creation (unverified email)
    // or the creation sync has not run/failed. Verified emails retry sync.
    if (input.emailVerified === false) {
      return { state: 'email_unverified' };
    }
    return { state: 'needs_account', detail: 'account_missing' };
  }

  if (user.status === 'suspended') {
    return { state: 'suspended' };
  }

  // Team members inherit billing and terms handling from the invite flow;
  // their only onboarding dependency is the cluster assignment.
  if (user.accountOwnerId) {
    return input.hasClusterAssignment
      ? { state: 'ready' }
      : { state: 'assigning_cluster' };
  }

  if (!user.termsAcceptedAt || !user.billingMode) {
    return { state: 'needs_account', detail: 'terms_or_plan' };
  }

  // Postpaid pays before provisioning. The subscription row is written by the
  // Stripe checkout webhook, or recovered by the sync-user health check when
  // the user returns from checkout before the webhook lands.
  if (user.billingMode === 'postpaid' && !user.hasSubscription) {
    return { state: 'needs_payment' };
  }

  if (!input.hasClusterAssignment) {
    return { state: 'assigning_cluster' };
  }

  return { state: 'ready' };
}

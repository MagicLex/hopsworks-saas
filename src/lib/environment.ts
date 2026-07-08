export type ClusterEnvironment = 'production' | 'staging';

// CLUSTER_ENVIRONMENT decouples cluster assignment from the app environment:
// the staging bridge tests against the production cluster (shared DB, real
// webhook emitter) while keeping its staging banner and Stripe test mode.
export function currentClusterEnvironment(): ClusterEnvironment {
  const env = process.env.CLUSTER_ENVIRONMENT || process.env.NEXT_PUBLIC_ENVIRONMENT;
  return env === 'staging' ? 'staging' : 'production';
}

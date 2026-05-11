export type ClusterEnvironment = 'production' | 'staging';

export function currentClusterEnvironment(): ClusterEnvironment {
  return process.env.NEXT_PUBLIC_ENVIRONMENT === 'staging' ? 'staging' : 'production';
}

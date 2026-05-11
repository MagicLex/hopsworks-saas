/**
 * Renders a sticky top banner when NEXT_PUBLIC_ENVIRONMENT !== 'production'.
 * Staging shares the production DB intentionally (bridge testing only).
 * Banner must make this loud so destructive tests don't trash real users.
 */
export function EnvironmentBanner() {
  const env = process.env.NEXT_PUBLIC_ENVIRONMENT;
  if (!env || env === 'production') return null;

  const label = env.toUpperCase();
  const tone =
    env === 'staging'
      ? 'bg-quartz-label-red text-quartz-white'
      : 'bg-quartz-label-purple text-quartz-white';

  return (
    <div
      className={`sticky top-0 z-50 w-full px-4 py-1 text-center text-xs font-mono font-semibold tracking-wider ${tone}`}
    >
      {label} — shared production DB. Writes affect real users. Bridge testing only.
    </div>
  );
}

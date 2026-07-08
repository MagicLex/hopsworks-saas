/**
 * Non-production (staging/preview) only: loud warning — shared prod DB, writes hit real users.
 */
export function EnvironmentBanner() {
  const env = (process.env.NEXT_PUBLIC_ENVIRONMENT || '').trim();

  if (env === 'production' || !env) {
    return null;
  }

  return (
    <div className="sticky top-0 z-50 w-full bg-quartz-label-red px-4 py-1 text-center text-xs font-mono font-semibold tracking-wider text-quartz-white">
      {env.toUpperCase()} — shared production DB. Writes affect real users. Bridge testing only.
    </div>
  );
}

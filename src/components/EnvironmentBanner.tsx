/**
 * Production: subtle migration notice with contact link.
 * Non-production (staging/preview): loud warning — shared prod DB, writes hit real users.
 */
export function EnvironmentBanner() {
  const env = (process.env.NEXT_PUBLIC_ENVIRONMENT || '').trim();

  if (env === 'production' || !env) {
    return (
      <div className="sticky top-0 z-50 w-full bg-quartz-gray-shade3 px-4 py-1 text-center text-xs font-mono text-quartz-gray-shade1">
        Possible disturbance with the SaaS bridge while we migrate test clusters to 5.0. Issues?{' '}
        <a
          href="https://www.hopsworks.ai/contact/main"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold underline hover:text-quartz-black"
        >
          contact us
        </a>
        .
      </div>
    );
  }

  return (
    <div className="sticky top-0 z-50 w-full bg-quartz-label-red px-4 py-1 text-center text-xs font-mono font-semibold tracking-wider text-quartz-white">
      {env.toUpperCase()} — shared production DB. Writes affect real users. Bridge testing only.
    </div>
  );
}

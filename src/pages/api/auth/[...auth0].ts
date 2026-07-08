import { handleAuth, handleLogin, handleLogout } from '@auth0/nextjs-auth0';
import { NextApiRequest, NextApiResponse } from 'next';
import { appendSignupRefsCookie } from '@/lib/signup-refs';

// Validate returnTo to prevent open redirect attacks
function validateReturnTo(returnTo: string | string[] | undefined): string {
  if (!returnTo || Array.isArray(returnTo)) return '/';

  // Only allow relative paths (starting with /)
  // Reject absolute URLs, protocol-relative URLs (//), and other schemes
  if (!returnTo.startsWith('/') || returnTo.startsWith('//')) {
    return '/';
  }

  // Additional safety: no backslashes (IE quirk), no control chars
  if (returnTo.includes('\\') || /[\x00-\x1f]/.test(returnTo)) {
    return '/';
  }

  return returnTo;
}

// Corporate/promo refs arrive as query params on /api/auth/{login,signup} and
// are persisted in an httpOnly cookie before the Auth0 round trip. sync-user
// reads the cookie at account creation — the refs survive tab changes and the
// email-verification detour, unlike the old sessionStorage relay.
function captureRefs(req: NextApiRequest, res: NextApiResponse) {
  const corporateRef = typeof req.query.corporate_ref === 'string' ? req.query.corporate_ref : undefined;
  const promoCode = typeof req.query.promo === 'string' ? req.query.promo : undefined;
  if (corporateRef || promoCode) {
    appendSignupRefsCookie(res, { corporateRef, promoCode });
  }
}

export default handleAuth({
  login: async (req: NextApiRequest, res: NextApiResponse) => {
    captureRefs(req, res);
    return handleLogin(req, res, {
      getLoginState: (r: NextApiRequest) => ({
        returnTo: validateReturnTo(r.query.returnTo)
      })
    });
  },
  signup: async (req: NextApiRequest, res: NextApiResponse) => {
    captureRefs(req, res);
    return handleLogin(req, res, {
      authorizationParams: {
        screen_hint: 'signup'
      },
      getLoginState: (r: NextApiRequest) => ({
        returnTo: validateReturnTo(r.query.returnTo)
      })
    });
  },
  logout: handleLogout({
    returnTo: process.env.AUTH0_BASE_URL
  })
});

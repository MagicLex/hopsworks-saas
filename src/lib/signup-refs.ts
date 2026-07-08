import { NextApiResponse } from 'next';

// httpOnly cookie carrying corporate/promo signup refs across the Auth0
// round trip and the email-verification detour. Written by /api/auth/login
// and /api/auth/signup, consumed and cleared by sync-user at account creation.

export const SIGNUP_REFS_COOKIE = 'hw_signup_refs';

// Long enough to survive a slow email verification, short enough not to
// resurrect stale refs on a much later signup.
const MAX_AGE_SECONDS = 7 * 24 * 3600;

export interface SignupRefs {
  corporateRef?: string;
  promoCode?: string;
}

function baseAttributes(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax${secure}`;
}

// The Auth0 SDK also writes Set-Cookie on these responses — always append,
// never replace.
function appendSetCookie(res: NextApiResponse, cookie: string) {
  const existing = res.getHeader('Set-Cookie');
  const values = existing ? (Array.isArray(existing) ? existing.map(String) : [String(existing)]) : [];
  res.setHeader('Set-Cookie', [...values, cookie]);
}

export function appendSignupRefsCookie(res: NextApiResponse, refs: SignupRefs) {
  const value = encodeURIComponent(JSON.stringify(refs));
  appendSetCookie(res, `${SIGNUP_REFS_COOKIE}=${value}; Max-Age=${MAX_AGE_SECONDS}; ${baseAttributes()}`);
}

export function parseSignupRefsCookie(cookieValue: string | undefined): SignupRefs {
  if (!cookieValue) return {};
  try {
    const parsed = JSON.parse(decodeURIComponent(cookieValue));
    return {
      corporateRef: typeof parsed.corporateRef === 'string' ? parsed.corporateRef : undefined,
      promoCode: typeof parsed.promoCode === 'string' ? parsed.promoCode : undefined,
    };
  } catch {
    return {};
  }
}

export function clearSignupRefsCookie(res: NextApiResponse) {
  appendSetCookie(res, `${SIGNUP_REFS_COOKIE}=; Max-Age=0; ${baseAttributes()}`);
}

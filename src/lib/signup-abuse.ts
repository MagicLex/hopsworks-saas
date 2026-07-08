// Signup-time abuse gates. All three fire BEFORE account creation, so a
// stolen card doesn't help (unlike the hosting-ASN card gate in asn-check.ts).
//
// 1. Disposable email domain → block
// 2. Signup IP matches an abuse-suspended/blocked account → block
// 3. Per-IP velocity: too many signups from one IP in 24h → block
//
// IP checks are skipped for invited team members (the invite token vouches;
// an invite requires an owner with billing) and fail open on DB errors.

import disposableDomains from 'disposable-email-domains';
import { firstIp, isPrivateOrLocal } from './asn-check';

// The community list misses some domains we've seen in the wild.
// EXTRA_BLOCKED_EMAIL_DOMAINS (comma-separated env) extends it without a deploy.
const EXTRA_DISPOSABLE_DOMAINS = ['bltiwd.com'];

const DISPOSABLE_DOMAINS = new Set<string>([
  ...(disposableDomains as string[]),
  ...EXTRA_DISPOSABLE_DOMAINS,
  ...(process.env.EXTRA_BLOCKED_EMAIL_DOMAINS?.split(',').map(d => d.trim().toLowerCase()).filter(Boolean) ?? []),
]);

// Block the Nth signup from one IP within 24h. Two legit accounts per office
// NAT per day pass; the June 2026 mining batch (10 accounts, one EC2 IP pool,
// shared IPs) dies at account #3 of any shared IP.
const MAX_SIGNUPS_PER_IP_PER_DAY = 2;

// Anonymity-friendly providers favored by abusers (June 2026 data: 4 of 11
// proton accounts were mining-suspended, vs 2.9% for gmail). Not blocked:
// like hosting ASNs, these signups must validate a card before free compute.
// CARD_REQUIRED_EMAIL_DOMAINS (comma-separated env) extends without a deploy.
const CARD_REQUIRED_DOMAINS = new Set<string>([
  'proton.me',
  'protonmail.com',
  'protonmail.ch',
  'pm.me',
  'proton.ch',
  ...(process.env.CARD_REQUIRED_EMAIL_DOMAINS?.split(',').map(d => d.trim().toLowerCase()).filter(Boolean) ?? []),
]);

export function isCardRequiredEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return !!domain && CARD_REQUIRED_DOMAINS.has(domain);
}

export function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return !!domain && DISPOSABLE_DOMAINS.has(domain);
}

/**
 * Returns a block reason string, or null if the signup may proceed.
 * Reasons are for server logs only — callers send a generic message to the client.
 */
export async function checkSignupAbuse(
  supabaseAdmin: { from: (table: string) => any },
  email: string,
  ipHeader: string | undefined | null,
  hasInviteToken: boolean
): Promise<string | null> {
  if (isDisposableEmail(email)) {
    return `disposable email domain (${email.split('@')[1]})`;
  }

  const ip = firstIp(ipHeader);
  if (!ip || isPrivateOrLocal(ip) || hasInviteToken) return null;

  // registration_ip is an inet column: LIKE has no inet operator (42883,
  // this gate silently failed open until 2026-07-08). inet equality it is.
  const { data: rows, error } = await supabaseAdmin
    .from('users')
    .select('status, deleted_at, deletion_reason, created_at, registration_ip, metadata')
    .eq('registration_ip', ip);

  if (error) {
    // Fail open: an unreadable users table must not block signups (it would
    // break the insert right after anyway)
    console.error('[Signup abuse] IP lookup failed:', error);
    return null;
  }

  const sameIp = (rows ?? []).filter(
    (r: any) => firstIp(r.registration_ip) === ip
  );

  const abuseMatch = sameIp.find(
    (r: any) =>
      (r.status === 'suspended' && r.metadata?.suspension_reason === 'abuse') ||
      (r.deleted_at && r.deletion_reason === 'abuse')
  );
  if (abuseMatch) {
    return `IP ${ip} matches an abuse-suspended account`;
  }

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentSignups = sameIp.filter(
    (r: any) => r.created_at && new Date(r.created_at).getTime() > dayAgo
  ).length;
  if (recentSignups >= MAX_SIGNUPS_PER_IP_PER_DAY) {
    return `IP ${ip} already created ${recentSignups} accounts in the last 24h`;
  }

  return null;
}

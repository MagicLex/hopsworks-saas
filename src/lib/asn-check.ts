// Registration-IP ASN check (anti-abuse).
//
// Miners sign up from datacenter IPs (EC2, Hetzner, OVH...) with throwaway
// emails to farm free compute. We don't hard-block datacenter ranges (legit
// users sign up from corporate VPNs and cloud workstations): we flag the
// account and require a validated payment method before free-tier compute.
//
// Lookup is Team Cymru's IP-to-ASN DNS service (origin.asn.cymru.com): no
// API key, no database to refresh, ~tens of ms. Fail-open: any lookup
// failure means no flag, never a blocked signup.

import { promises as dns } from 'dns';

const LOOKUP_TIMEOUT_MS = 1500;

// Hosting / cloud providers whose IPs warrant payment validation before
// free compute. Flag-only policy: false positives cost the user one card
// validation, not access.
const HOSTING_ASNS: Record<number, string> = {
  16509: 'Amazon AWS',
  14618: 'Amazon AES',
  8987: 'Amazon Data Services',
  396982: 'Google Cloud',
  15169: 'Google',
  8075: 'Microsoft Azure',
  16276: 'OVH',
  24940: 'Hetzner',
  14061: 'DigitalOcean',
  63949: 'Linode/Akamai',
  20473: 'Vultr',
  51167: 'Contabo',
  45102: 'Alibaba Cloud',
  31898: 'Oracle Cloud',
  12876: 'Scaleway',
  132203: 'Tencent Cloud',
};

export interface AsnInfo {
  asn: number;
  asnOrg: string;
  hosting: boolean;
}

export function isHostingAsn(asn: number): boolean {
  return asn in HOSTING_ASNS;
}

/** First client IP from an x-forwarded-for style header (or a plain IP). */
export function firstIp(ipHeader: string | undefined | null): string | null {
  if (!ipHeader) return null;
  const ip = ipHeader.split(',')[0].trim();
  return ip || null;
}

export function isPrivateOrLocal(ip: string): boolean {
  return (
    ip === '::1' ||
    ip.startsWith('127.') ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')
  );
}

/** Cymru DNS name for an IP: reversed octets (v4) or reversed nibbles (v6). */
export function cymruName(ip: string): string | null {
  if (ip.includes(':')) {
    // Expand IPv6 to full form, reverse nibble by nibble
    const parts = ip.split('::');
    if (parts.length > 2) return null;
    const head = parts[0] ? parts[0].split(':') : [];
    const tail = parts[1] ? parts[1].split(':') : [];
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    const groups = [...head, ...Array(missing).fill('0'), ...tail].map(g => g.padStart(4, '0'));
    const nibbles = groups.join('').split('').reverse().join('.');
    return `${nibbles}.origin6.asn.cymru.com`;
  }
  const octets = ip.split('.');
  if (octets.length !== 4) return null;
  return `${octets.reverse().join('.')}.origin.asn.cymru.com`;
}

/** Parse a Cymru TXT answer: "16509 | 13.244.0.0/15 | US | arin | 2018-07-11" */
export function parseCymruTxt(txt: string): number | null {
  const asnField = txt.split('|')[0]?.trim();
  // Multi-origin answers list several ASNs space-separated; take the first
  const asn = parseInt(asnField?.split(/\s+/)[0] ?? '', 10);
  return Number.isFinite(asn) && asn > 0 ? asn : null;
}

/**
 * Free-tier gate for flagged signups (hosting ASN or card-required email
 * domain). Returns true when the user may proceed (not flagged, already
 * validated, or has a card on file — in which case the validated marker is
 * persisted so we never re-check Stripe).
 * Admin can override by setting metadata.hosting_asn_validated manually.
 */
export async function hostingSignupCanGoFree(
  supabaseAdmin: { from: (table: string) => any },
  userId: string,
  user: { metadata?: Record<string, unknown> | null; stripe_customer_id?: string | null }
): Promise<boolean> {
  const meta = user.metadata ?? {};
  if (!meta.hosting_asn && !meta.card_required_email) return true;
  if (meta.hosting_asn_validated) return true;
  if (!user.stripe_customer_id) return false;

  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-06-30.basil' });
    const paymentMethods = await stripe.paymentMethods.list({
      customer: user.stripe_customer_id,
      type: 'card',
      limit: 1,
    });
    if (paymentMethods.data.length === 0) return false;

    await supabaseAdmin
      .from('users')
      .update({ metadata: { ...meta, hosting_asn_validated: true } })
      .eq('id', userId);
    return true;
  } catch (err) {
    // Fail closed here: a flagged account doesn't get free compute on a Stripe outage
    console.error(`[ASN check] card validation failed for ${userId}:`, err);
    return false;
  }
}

/**
 * Look up the ASN of a registration IP. Returns null on private IPs,
 * malformed input, timeout, or DNS failure — callers treat null as "no flag".
 */
export async function checkRegistrationIp(ipHeader: string | undefined | null): Promise<AsnInfo | null> {
  const ip = firstIp(ipHeader);
  if (!ip || isPrivateOrLocal(ip)) return null;

  const name = cymruName(ip);
  if (!name) return null;

  try {
    const records = await Promise.race([
      dns.resolveTxt(name),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('ASN lookup timeout')), LOOKUP_TIMEOUT_MS)
      ),
    ]);
    const txt = records?.[0]?.join('');
    if (!txt) return null;
    const asn = parseCymruTxt(txt);
    if (!asn) return null;
    return {
      asn,
      asnOrg: HOSTING_ASNS[asn] ?? `AS${asn}`,
      hosting: isHostingAsn(asn),
    };
  } catch (err) {
    // Fail open: an unreachable DNS service must never break signup
    console.warn(`[ASN check] lookup failed for ${ip}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

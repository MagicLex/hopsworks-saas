/**
 * ASN check (anti-abuse) — pure function tests.
 *
 * The DNS lookup itself is fail-open and not tested here (no network in CI);
 * these cover the parsing and policy pieces that decide who gets flagged.
 */

import { describe, it, expect } from 'vitest';
import { cymruName, parseCymruTxt, firstIp, isHostingAsn } from '@/lib/asn-check';

describe('firstIp', () => {
  it('takes the first client IP from x-forwarded-for chains', () => {
    expect(firstIp('13.244.10.20, 141.101.76.1')).toBe('13.244.10.20');
    expect(firstIp('8.8.8.8')).toBe('8.8.8.8');
  });

  it('handles missing input', () => {
    expect(firstIp(undefined)).toBeNull();
    expect(firstIp('')).toBeNull();
  });
});

describe('cymruName', () => {
  it('reverses IPv4 octets', () => {
    expect(cymruName('13.244.10.20')).toBe('20.10.244.13.origin.asn.cymru.com');
  });

  it('expands and nibble-reverses IPv6', () => {
    expect(cymruName('2001:db8::1')).toBe(
      '1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.origin6.asn.cymru.com'
    );
  });

  it('rejects malformed input', () => {
    expect(cymruName('not-an-ip')).toBeNull();
    expect(cymruName('1.2.3')).toBeNull();
  });
});

describe('parseCymruTxt', () => {
  it('parses a standard answer', () => {
    expect(parseCymruTxt('16509 | 13.244.0.0/15 | US | arin | 2018-07-11')).toBe(16509);
  });

  it('takes the first ASN of multi-origin answers', () => {
    expect(parseCymruTxt('16509 14618 | 52.0.0.0/8 | US | arin | 1991-12-19')).toBe(16509);
  });

  it('rejects garbage', () => {
    expect(parseCymruTxt('')).toBeNull();
    expect(parseCymruTxt('NA | nothing')).toBeNull();
  });
});

describe('isHostingAsn (policy)', () => {
  it('flags the big cloud and bare-metal hosters', () => {
    expect(isHostingAsn(16509)).toBe(true); // AWS — the Cape Town mining farm range
    expect(isHostingAsn(24940)).toBe(true); // Hetzner
    expect(isHostingAsn(16276)).toBe(true); // OVH
    expect(isHostingAsn(14061)).toBe(true); // DigitalOcean
  });

  it('does not flag residential / business ISPs', () => {
    expect(isHostingAsn(3215)).toBe(false); // Orange
    expect(isHostingAsn(7922)).toBe(false); // Comcast
    expect(isHostingAsn(3303)).toBe(false); // Swisscom
  });
});

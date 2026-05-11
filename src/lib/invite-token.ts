import { createHash, randomBytes } from 'crypto';

/**
 * Invite tokens are stored as SHA256 hashes in the DB; the plaintext is only
 * sent in the invite URL/email. Lookup must hash the incoming token first.
 *
 * Reason: if `team_invites` leaks, plaintext tokens would let any reader
 * accept any pending invite. Storing only the hash makes the table inert.
 */

export function generateInviteToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

-- Hash team_invites tokens with SHA256.
-- Plaintext tokens stay only in the email URL; DB stores the hash.
-- Run BEFORE deploying the matching code change. Idempotent.

ALTER TABLE team_invites ADD COLUMN IF NOT EXISTS token_hash text;

UPDATE team_invites
SET token_hash = encode(sha256(token::bytea), 'hex')
WHERE token_hash IS NULL AND token IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS team_invites_token_hash_idx
  ON team_invites(token_hash);

-- Enforce NOT NULL after backfill so future writes can't silently skip the hash.
ALTER TABLE team_invites ALTER COLUMN token_hash SET NOT NULL;

-- Allow new code to insert without `token` column. The plaintext column
-- stays for one release as a rollback safety; drop in a follow-up migration
-- once you're confident no rollback is needed.
ALTER TABLE team_invites ALTER COLUMN token DROP NOT NULL;

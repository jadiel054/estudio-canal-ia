-- PR-1A — OAuth YouTube somente leitura
-- Não executar automaticamente. Client secret, tokens e chave AEAD permanecem no ambiente.

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS owner_id TEXT,
  ADD COLUMN IF NOT EXISTS workspace_id TEXT,
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS channels_owner_workspace_platform_external_uidx
  ON channels (owner_id, workspace_id, platform, external_channel_id)
  WHERE external_channel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS channels_owner_workspace_platform_idx
  ON channels (owner_id, workspace_id, platform);

CREATE TABLE IF NOT EXISTS oauth_connection_states (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('youtube')),
  state_hash TEXT NOT NULL UNIQUE,
  redirect_uri TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS oauth_connection_states_expiry_idx
  ON oauth_connection_states (provider, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS youtube_oauth_credentials (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  access_token_ciphertext BYTEA,
  refresh_token_ciphertext BYTEA NOT NULL,
  encryption_iv BYTEA NOT NULL,
  encryption_tag BYTEA NOT NULL,
  key_version TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (owner_id, workspace_id, channel_id)
);

CREATE INDEX IF NOT EXISTS youtube_oauth_credentials_owner_idx
  ON youtube_oauth_credentials (owner_id, workspace_id);

ALTER TABLE channels
  DROP CONSTRAINT IF EXISTS channels_platform_check;
ALTER TABLE channels
  ADD CONSTRAINT channels_platform_check
  CHECK (platform IN ('youtube', 'tiktok'));

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  active_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS group_members_user_id_idx ON group_members(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS messages_group_created_idx
  ON messages(group_id, created_at DESC);

INSERT OR IGNORE INTO groups
  (id, name, description, category, owner_id, active_count, created_at)
VALUES
  ('seed-night-owls', 'Night Owls', 'A late-night corner for good conversations, playlists, and ideas.', 'Community', NULL, 0, '2026-09-30T00:00:00.000Z'),
  ('seed-pixel-foundry', 'Pixel Foundry', 'Share works in progress, visual experiments, and helpful feedback.', 'Art & Design', NULL, 0, '2026-09-29T00:00:00.000Z'),
  ('seed-co-op-quest', 'Co-op Quest', 'Find teammates and plan the next co-op run together.', 'Gaming', NULL, 0, '2026-09-28T00:00:00.000Z');
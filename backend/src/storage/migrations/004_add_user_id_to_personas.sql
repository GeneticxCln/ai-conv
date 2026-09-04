-- Scope persisted personas to a local profile.
ALTER TABLE personas ADD COLUMN user_id TEXT;

UPDATE personas
SET user_id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)
WHERE user_id IS NULL;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (4, 'add_user_id_to_personas');

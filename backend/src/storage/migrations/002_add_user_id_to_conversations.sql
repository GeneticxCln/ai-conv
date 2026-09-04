-- Add user_id and participants columns to conversations
ALTER TABLE conversations ADD COLUMN user_id TEXT;
ALTER TABLE conversations ADD COLUMN participants TEXT;

UPDATE conversations
SET user_id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)
WHERE user_id IS NULL;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (2, 'add_user_id_to_conversations');

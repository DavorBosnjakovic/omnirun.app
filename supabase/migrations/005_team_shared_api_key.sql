-- ============================================================
-- Migration 005: Add encrypted API key column to teams table
-- ============================================================
-- When the owner enables "shared key" mode, their API keys are
-- encrypted client-side and stored here so team members can
-- retrieve and decrypt them locally.
--
-- The value is a JSON string of encrypted provider configs,
-- NOT a plain-text API key. Encryption/decryption happens
-- entirely in the app — Supabase never sees raw keys.
--
-- Existing RLS policies already cover access:
--   "Members read own team"       → members can read this column
--   "Owners update own team"      → only owner can write this column
-- ============================================================

-- Add the encrypted key column
ALTER TABLE "public"."teams"
  ADD COLUMN IF NOT EXISTS "encrypted_api_keys" TEXT DEFAULT NULL;

-- Add a timestamp so members know when the shared keys were last updated
ALTER TABLE "public"."teams"
  ADD COLUMN IF NOT EXISTS "shared_keys_updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Add a comment for clarity
COMMENT ON COLUMN "public"."teams"."encrypted_api_keys"
  IS 'Client-encrypted JSON blob of API provider configs. Only populated when api_key_policy = shared. Encrypted/decrypted in-app, never stored in plain text.';

COMMENT ON COLUMN "public"."teams"."shared_keys_updated_at"
  IS 'Timestamp of last shared key update, so members can detect changes.';
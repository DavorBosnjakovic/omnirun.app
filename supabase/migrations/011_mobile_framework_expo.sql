-- ============================================================
-- Migration 011: Update mobile app templates framework
-- Date: 2026-04-11
-- Description: Change mobile-apps templates from 'react' to 'expo'
--   so Omnirun detects them as Expo (React Native) projects.
-- ============================================================

UPDATE templates SET framework = 'expo' WHERE category = 'mobile-apps';
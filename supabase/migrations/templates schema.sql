-- ============================================================
-- OMNIRUN: Templates Schema
-- Run this in Supabase SQL Editor
-- ============================================================

-- ── Enum for template tier (plan gating) ─────────────────────
CREATE TYPE template_tier AS ENUM ('basic', 'pro', 'custom');

-- ── Templates table ──────────────────────────────────────────
-- Stores metadata for all templates. Actual template files
-- live in Supabase Storage bucket "templates".
CREATE TABLE templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE,            -- folder name in storage, e.g. "landing-page"
  name          TEXT NOT NULL,                   -- display name, e.g. "Landing Page"
  category      TEXT NOT NULL,                   -- category ID, e.g. "websites"
  description   TEXT NOT NULL DEFAULT '',        -- short description for card
  icon          TEXT NOT NULL DEFAULT '📁',      -- emoji icon
  default_name  TEXT NOT NULL DEFAULT 'My Project', -- default project name when selected
  framework     TEXT NOT NULL DEFAULT 'static',  -- "static" | "react" | "next" | "vue" etc.
  tier          template_tier NOT NULL DEFAULT 'basic', -- plan gating: basic (Starter+), pro (Pro+), custom (Enterprise)
  sort_order    INT NOT NULL DEFAULT 0,          -- ordering within category
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,   -- soft delete / hide without removing
  featured      BOOLEAN NOT NULL DEFAULT FALSE,  -- highlight in gallery
  version       INT NOT NULL DEFAULT 1,          -- bump when template files are updated
  file_count    INT NOT NULL DEFAULT 0,          -- number of files in storage (informational)
  tags          TEXT[] DEFAULT '{}',             -- searchable tags, e.g. {"react", "tailwind", "dashboard"}
  preview_url   TEXT,                            -- optional screenshot URL in storage
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast category + tier queries
CREATE INDEX idx_templates_category ON templates (category, sort_order);
CREATE INDEX idx_templates_tier ON templates (tier);
CREATE INDEX idx_templates_active ON templates (is_active) WHERE is_active = TRUE;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER templates_updated_at
  BEFORE UPDATE ON templates
  FOR EACH ROW
  EXECUTE FUNCTION update_templates_updated_at();

-- ── Template downloads tracking (analytics) ──────────────────
-- Optional: track which templates are popular
CREATE TABLE template_downloads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_template_downloads_template ON template_downloads (template_id);
CREATE INDEX idx_template_downloads_user ON template_downloads (user_id);

-- ── RLS Policies ─────────────────────────────────────────────
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_downloads ENABLE ROW LEVEL SECURITY;

-- Templates: everyone can read active templates, only admins can write
CREATE POLICY "Anyone can read active templates"
  ON templates FOR SELECT
  USING (is_active = TRUE);

CREATE POLICY "Admins can manage templates"
  ON templates FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Template downloads: users can insert their own, admins can read all
CREATE POLICY "Users can log their own downloads"
  ON template_downloads FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read their own downloads"
  ON template_downloads FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can read all downloads"
  ON template_downloads FOR SELECT
  USING (is_admin());

-- ── Storage Bucket ───────────────────────────────────────────
-- Run these separately if the SQL editor doesn't support storage API:
--
-- 1. Go to Supabase Dashboard > Storage > New Bucket
--    Name: templates
--    Public: YES (template files are not sensitive)
--    File size limit: 10MB
--
-- 2. Storage structure:
--    templates/
--      landing-page/
--        index.html
--        style.css
--      budget-tracker/
--        package.json
--        index.html
--        src/
--          App.jsx
--          style.css
--      business-website/
--        ...
--
-- 3. Add storage policy (Dashboard > Storage > templates > Policies):
--    - SELECT (download): Allow for all authenticated users
--    - INSERT/UPDATE/DELETE: Allow only for admins (service role or is_admin check)

-- Alternatively, create bucket via SQL:
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('templates', 'templates', TRUE, 10485760)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Anyone can download templates"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'templates');

CREATE POLICY "Admins can upload templates"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'templates' AND is_admin());

CREATE POLICY "Admins can update templates"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'templates' AND is_admin());

CREATE POLICY "Admins can delete templates"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'templates' AND is_admin());

-- ── Helper: Get templates available for a plan ───────────────
-- Returns templates the user's plan allows access to.
-- Usage: SELECT * FROM get_templates_for_plan('pro');
CREATE OR REPLACE FUNCTION get_templates_for_plan(user_plan TEXT)
RETURNS SETOF templates AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM templates
  WHERE is_active = TRUE
    AND (
      tier = 'basic'
      OR (tier = 'pro' AND user_plan IN ('pro', 'business', 'enterprise'))
      OR (tier = 'custom' AND user_plan = 'enterprise')
    )
  ORDER BY category, sort_order, name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── Seed: Insert initial template metadata ───────────────────
-- NOTE: You still need to upload the actual template files
-- to the "templates" storage bucket separately.

INSERT INTO templates (slug, name, category, description, icon, default_name, framework, tier, sort_order) VALUES
  -- Websites
  ('business-website',  'Business Website',  'websites', 'Company site with pages and contact form',    '🏢', 'My Business Website',  'static',  'basic', 1),
  ('landing-page',      'Landing Page',      'websites', 'Single page, conversion focused',             '🚀', 'My Landing Page',      'static',  'basic', 2),
  ('ecommerce-store',   'E-commerce Store',  'websites', 'Products, cart, and checkout',                '🛒', 'My Store',             'react',   'pro',   3),
  ('portfolio',         'Portfolio',         'websites', 'Showcase your work beautifully',              '🎨', 'My Portfolio',         'static',  'basic', 4),
  ('blog',              'Blog',              'websites', 'Articles, categories, and comments',           '📝', 'My Blog',              'react',   'pro',   5),
  ('restaurant-cafe',   'Restaurant / Café', 'websites', 'Menu, hours, location, and reservations',     '☕', 'My Restaurant',        'static',  'basic', 6),

  -- Personal Tools
  ('budget-tracker',    'Budget Tracker',    'personal-tools', 'Income, expenses, categories, and charts', '💰', 'My Budget Tracker',    'react', 'basic', 1),
  ('habit-tracker',     'Habit Tracker',     'personal-tools', 'Daily habits, streaks, and progress',      '✅', 'My Habit Tracker',     'react', 'basic', 2),
  ('recipe-organizer',  'Recipe Organizer',  'personal-tools', 'Recipes, ingredients, and meal planning',  '🍳', 'My Recipe Organizer',  'react', 'pro',   3),
  ('workout-log',       'Workout Log',       'personal-tools', 'Exercises, sets, and progress tracking',   '💪', 'My Workout Log',       'react', 'pro',   4),
  ('reading-list',      'Reading List',      'personal-tools', 'Books, status, notes, and ratings',        '📚', 'My Reading List',      'react', 'basic', 5),

  -- Business Tools
  ('admin-dashboard',   'Admin Dashboard',   'business-tools', 'Data tables, charts, and user management', '📊', 'My Dashboard',         'react', 'pro',   1),
  ('inventory-tracker', 'Inventory Tracker', 'business-tools', 'Stock levels, alerts, and history',        '📦', 'My Inventory Tracker', 'react', 'pro',   2),
  ('crm-system',        'CRM System',        'business-tools', 'Contacts, deals, pipeline, and tasks',     '🤝', 'My CRM',              'react', 'pro',   3),
  ('booking-system',    'Booking System',    'business-tools', 'Calendar, appointments, and reminders',    '📅', 'My Booking System',    'react', 'pro',   4),
  ('invoice-generator', 'Invoice Generator', 'business-tools', 'Create and manage professional invoices',  '🧾', 'My Invoice Generator', 'react', 'pro',   5),

  -- Automations
  ('file-organizer',    'File Organizer',    'automations', 'Sort files by rules, clean up folders',       '📂', 'My File Organizer',    'static', 'pro',   1),
  ('report-generator',  'Report Generator',  'automations', 'Pull data and create formatted reports',     '📋', 'My Report Generator',  'static', 'pro',   2),
  ('photo-organizer',   'Photo Organizer',   'automations', 'Sort by date, remove duplicates',            '📸', 'My Photo Organizer',   'static', 'pro',   3),

  -- Fun & Learning
  ('quiz-app',          'Quiz App',          'fun-learning', 'Questions, scoring, and categories',         '❓', 'My Quiz App',          'react', 'basic', 1),
  ('flashcards',        'Flashcards',        'fun-learning', 'Study tool with spaced repetition',          '🃏', 'My Flashcards',        'react', 'basic', 2),
  ('random-generator',  'Random Generator',  'fun-learning', 'Names, ideas, prompts, and more',            '🎲', 'My Random Generator',  'react', 'basic', 3)
ON CONFLICT (slug) DO NOTHING;
-- ============================================================
-- Migration 009: Mobile App Templates
-- Date: 2026-04-11
-- Description: Add mobile-apps category templates to templates table
-- ============================================================

INSERT INTO templates (slug, name, category, description, icon, default_name, framework, tier, sort_order, is_active, featured, tags)
VALUES
  ('todo-app', 'Todo App', 'mobile-apps', 'Task management with lists, priorities, due dates, and swipe actions.', '✅', 'My Todo App', 'react', 'basic', 1, true, false, ARRAY['react', 'vite', 'todo', 'tasks', 'productivity', 'mobile']),
  ('weather-app', 'Weather App', 'mobile-apps', 'Current weather, forecasts, and location-based conditions with clean UI.', '🌤️', 'My Weather App', 'react', 'basic', 2, true, false, ARRAY['react', 'vite', 'weather', 'forecast', 'api', 'mobile']),
  ('notes-app', 'Notes App', 'mobile-apps', 'Create, organize, and search notes with markdown support and folders.', '📝', 'My Notes App', 'react', 'basic', 3, true, false, ARRAY['react', 'vite', 'notes', 'markdown', 'writing', 'mobile']),
  ('fitness-tracker', 'Fitness Tracker', 'mobile-apps', 'Track workouts, set goals, view progress charts and streaks.', '💪', 'My Fitness Tracker', 'react', 'pro', 4, true, false, ARRAY['react', 'vite', 'fitness', 'workout', 'health', 'mobile']);
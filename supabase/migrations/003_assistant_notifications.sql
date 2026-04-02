CREATE TABLE public.assistant_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,          -- 'discord', 'slack', 'gmail', 'github', etc.
  title TEXT NOT NULL,           -- short summary shown in dropdown
  body TEXT,                     -- longer detail shown in Assistant chat
  source_meta JSONB DEFAULT '{}', -- flexible: channel name, sender, thread id, etc.
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Fast lookup: unread notifications per user, newest first
CREATE INDEX idx_notifications_user_unread 
  ON public.assistant_notifications (user_id, is_read, created_at DESC);

-- RLS
ALTER TABLE public.assistant_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own notifications"
  ON public.assistant_notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users update own notifications"
  ON public.assistant_notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.assistant_notifications;
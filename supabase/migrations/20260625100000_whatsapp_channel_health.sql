-- WhatsApp-Channel-Health Monitoring (User-Feedback 25.06.2026)
--
-- Wiederkehrendes Problem: alle ~30 Tage verliert der Whapi-Channel
-- die Authentifizierung (zuletzt am 19.05., 01.06., 19.06., 25.06.).
-- Bisher hat der User das erst bemerkt, wenn die Mitarbeiter sich
-- über fehlende Reminder beschwert haben.
--
-- Neu: alle 6h prüft eine Edge-Function (whatsapp-channel-monitor)
-- den Health-Endpoint von Whapi. Bei Auth-Verlust geht eine Email
-- via Resend an bks@handwerkapp.at — einmalig pro Outage, kein Spam.
-- Das Spam-Filtering passiert via dieser Tabelle: bei Status-Wechsel
-- wird `alert_sent=true` gesetzt, beim Recovery wird ein neuer
-- Eintrag mit status="READY" geschrieben.

CREATE TABLE IF NOT EXISTS public.whatsapp_channel_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_code INTEGER,
  status_text TEXT,
  channel_id TEXT,
  device_id INTEGER,
  user_id TEXT,
  alert_sent BOOLEAN DEFAULT FALSE,
  alert_email_log_id UUID REFERENCES public.email_log(id) ON DELETE SET NULL,
  raw_response JSONB
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_channel_health_checked_at
  ON public.whatsapp_channel_health(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_channel_health_alert_sent
  ON public.whatsapp_channel_health(alert_sent) WHERE alert_sent = false;

ALTER TABLE public.whatsapp_channel_health ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whatsapp_channel_health_admin_read"
  ON public.whatsapp_channel_health;
CREATE POLICY "whatsapp_channel_health_admin_read"
  ON public.whatsapp_channel_health FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('administrator', 'vorarbeiter')
  ));

COMMENT ON TABLE public.whatsapp_channel_health IS
  'Whapi-Channel-Health-Snapshots alle 6h. status_code=0/READY = OK, alles andere (AUTH, QR, …) ist ein Outage. alert_sent verhindert Spam: nur erster Eintrag in einer Outage-Serie sendet Email.';

-- Cron-Job: alle 6h Channel-Health prüfen.
-- Schedule "0 */6 * * *" = 00:00, 06:00, 12:00, 18:00 UTC.
-- (Vienna: 02:00, 08:00, 14:00, 20:00 — gut über den Tag verteilt.)
SELECT cron.schedule(
  'whatsapp-channel-monitor-job',
  '0 */6 * * *',
  $$
    SELECT net.http_post(
      url := 'https://zbxizeirecoipqvxymdx.supabase.co/functions/v1/whatsapp-channel-monitor',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT value FROM public.app_settings WHERE key = 'cron_webhook_secret' LIMIT 1)
      ),
      body := '{"source":"cron"}'::jsonb
    ) AS request_id
  $$
);

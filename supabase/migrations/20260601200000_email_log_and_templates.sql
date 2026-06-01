-- Email-Versand-Infrastruktur:
-- 1) email_log: Audit-Tabelle für jede verschickte Email (Resend-Versand)
-- 2) email_templates: Default-Betreff + Body pro Dokumenttyp (Admin-editierbar)
-- 3) app_settings-Keys: default_reply_to, email_signature

CREATE TABLE IF NOT EXISTS public.email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  to_address TEXT NOT NULL,
  cc_addresses TEXT[] DEFAULT NULL,
  reply_to TEXT,
  subject TEXT NOT NULL,
  body_html TEXT,
  body_text TEXT,
  attachment_filename TEXT,
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | sent | failed | bounced
  error_message TEXT,
  sent_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_log_invoice_id ON public.email_log(invoice_id);
CREATE INDEX IF NOT EXISTS idx_email_log_sent_at ON public.email_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_status ON public.email_log(status);

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

-- Admin + Vorarbeiter dürfen ALLE Einträge sehen
DROP POLICY IF EXISTS "email_log_select_admin_vorarbeiter" ON public.email_log;
CREATE POLICY "email_log_select_admin_vorarbeiter"
  ON public.email_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('administrator', 'vorarbeiter')
    )
  );

-- Mitarbeiter sehen nur ihre eigenen Versendungen
DROP POLICY IF EXISTS "email_log_select_own" ON public.email_log;
CREATE POLICY "email_log_select_own"
  ON public.email_log FOR SELECT
  TO authenticated
  USING (sent_by = auth.uid());

-- Inserts dürfen nur Admin + Vorarbeiter (UI-seitig nur sie sehen den Send-Button)
DROP POLICY IF EXISTS "email_log_insert_admin_vorarbeiter" ON public.email_log;
CREATE POLICY "email_log_insert_admin_vorarbeiter"
  ON public.email_log FOR INSERT
  TO authenticated
  WITH CHECK (
    sent_by = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('administrator', 'vorarbeiter')
    )
  );

-- Status-Updates (für Retry-Button etc.) — Admin + Vorarbeiter
DROP POLICY IF EXISTS "email_log_update_admin_vorarbeiter" ON public.email_log;
CREATE POLICY "email_log_update_admin_vorarbeiter"
  ON public.email_log FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('administrator', 'vorarbeiter')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('administrator', 'vorarbeiter')
    )
  );

COMMENT ON TABLE public.email_log IS
  'Audit-Trail aller Email-Versendungen von Belegen (Rechnungen, Angebote, etc.) via Resend.';
COMMENT ON COLUMN public.email_log.status IS
  'queued = an Resend übergeben aber noch keine Bestätigung; sent = Resend hat Übernahme bestätigt; failed = Send-Aufruf schlug fehl; bounced = Resend-Webhook hat Bounce gemeldet.';

-- =====================================================================
-- Email-Templates pro Dokumenttyp (Admin-editierbar)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  typ TEXT NOT NULL UNIQUE,  -- angebot | auftragsbestaetigung | rechnung | anzahlungsrechnung | schlussrechnung | gutschrift
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_templates_select_all_auth" ON public.email_templates;
CREATE POLICY "email_templates_select_all_auth"
  ON public.email_templates FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "email_templates_write_admin" ON public.email_templates;
CREATE POLICY "email_templates_write_admin"
  ON public.email_templates FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'administrator'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'administrator'
    )
  );

COMMENT ON TABLE public.email_templates IS
  'Default-Betreff + Body-HTML für Email-Versand pro Dokumenttyp. Platzhalter: {{kunde_name}}, {{dokument_nr}}, {{dokument_datum}}, {{betrag}}, {{firma}}.';

-- Seed: Standard-Templates pro Doc-Typ
INSERT INTO public.email_templates (typ, subject, body_html)
VALUES
  ('angebot',
   'Ihr Angebot {{dokument_nr}} – BKS BauKomplettService',
   '<p>Sehr geehrte Damen und Herren,</p><p>anbei übermitteln wir Ihnen unser Angebot <strong>{{dokument_nr}}</strong> vom {{dokument_datum}}.</p><p>Bei Fragen stehen wir Ihnen gerne zur Verfügung.</p><p>Mit freundlichen Grüßen<br>BKS BauKomplettService</p>'),
  ('auftragsbestaetigung',
   'Auftragsbestätigung {{dokument_nr}} – BKS BauKomplettService',
   '<p>Sehr geehrte Damen und Herren,</p><p>anbei finden Sie unsere Auftragsbestätigung <strong>{{dokument_nr}}</strong> vom {{dokument_datum}}.</p><p>Mit freundlichen Grüßen<br>BKS BauKomplettService</p>'),
  ('rechnung',
   'Ihre Rechnung {{dokument_nr}} – BKS BauKomplettService',
   '<p>Sehr geehrte Damen und Herren,</p><p>anbei erhalten Sie unsere Rechnung <strong>{{dokument_nr}}</strong> vom {{dokument_datum}} über <strong>{{betrag}}</strong>.</p><p>Wir bitten um Überweisung des offenen Betrages innerhalb der angegebenen Zahlungsfrist.</p><p>Mit freundlichen Grüßen<br>BKS BauKomplettService</p>'),
  ('anzahlungsrechnung',
   'Anzahlungsrechnung {{dokument_nr}} – BKS BauKomplettService',
   '<p>Sehr geehrte Damen und Herren,</p><p>anbei erhalten Sie unsere Anzahlungsrechnung <strong>{{dokument_nr}}</strong> vom {{dokument_datum}} über <strong>{{betrag}}</strong>.</p><p>Mit freundlichen Grüßen<br>BKS BauKomplettService</p>'),
  ('schlussrechnung',
   'Schlussrechnung {{dokument_nr}} – BKS BauKomplettService',
   '<p>Sehr geehrte Damen und Herren,</p><p>anbei erhalten Sie unsere Schlussrechnung <strong>{{dokument_nr}}</strong> vom {{dokument_datum}} über <strong>{{betrag}}</strong>.</p><p>Mit freundlichen Grüßen<br>BKS BauKomplettService</p>'),
  ('gutschrift',
   'Gutschrift {{dokument_nr}} – BKS BauKomplettService',
   '<p>Sehr geehrte Damen und Herren,</p><p>anbei erhalten Sie unsere Gutschrift <strong>{{dokument_nr}}</strong> vom {{dokument_datum}} über <strong>{{betrag}}</strong>.</p><p>Mit freundlichen Grüßen<br>BKS BauKomplettService</p>')
ON CONFLICT (typ) DO NOTHING;

-- =====================================================================
-- Default-Reply-To als app_settings-Key (vom Admin editierbar)
-- =====================================================================
INSERT INTO public.app_settings (key, value)
VALUES ('email_default_reply_to', 'montage@monti.pro')
ON CONFLICT (key) DO NOTHING;

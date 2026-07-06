-- Fremdfirmen / Subfirmen auf der Plantafel (User-Feedback 26.06.2026)
--
-- Firmen, die nur gelegentlich für uns arbeiten. Kein Login/Mitarbeiter,
-- daher eigenes Datenmodell (nicht über profiles/einsaetze, deren user_id
-- ein NOT-NULL-FK auf auth.users ist).
--
--   fremdfirmen           = Stammdaten (Name, Adresse, Telefon, Ansprechpartner)
--   fremdfirma_einsaetze  = Einsätze auf Baustellen (Projekt + Zeitraum),
--                           analog zu einsaetze, aber firmenbezogen.

CREATE TABLE IF NOT EXISTS public.fremdfirmen (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firmenname TEXT NOT NULL,
  adresse TEXT,
  plz TEXT,
  ort TEXT,
  telefon TEXT,
  ansprechpartner TEXT,
  notizen TEXT,
  aktiv BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.fremdfirma_einsaetze (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fremdfirma_id UUID NOT NULL REFERENCES public.fremdfirmen(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  beschreibung TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  ganztaegig BOOLEAN NOT NULL DEFAULT true,
  start_time TEXT,
  end_time TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fremdfirma_einsaetze_firma
  ON public.fremdfirma_einsaetze(fremdfirma_id);
CREATE INDEX IF NOT EXISTS idx_fremdfirma_einsaetze_dates
  ON public.fremdfirma_einsaetze(start_date, end_date);

ALTER TABLE public.fremdfirmen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fremdfirma_einsaetze ENABLE ROW LEVEL SECURITY;

-- Lesen: jeder eingeloggte Benutzer. Verwalten: Admin + Vorarbeiter.
DROP POLICY IF EXISTS "fremdfirmen_read" ON public.fremdfirmen;
CREATE POLICY "fremdfirmen_read" ON public.fremdfirmen
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "fremdfirmen_manage" ON public.fremdfirmen;
CREATE POLICY "fremdfirmen_manage" ON public.fremdfirmen
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('administrator','vorarbeiter')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('administrator','vorarbeiter')));

DROP POLICY IF EXISTS "fremdfirma_einsaetze_read" ON public.fremdfirma_einsaetze;
CREATE POLICY "fremdfirma_einsaetze_read" ON public.fremdfirma_einsaetze
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "fremdfirma_einsaetze_manage" ON public.fremdfirma_einsaetze;
CREATE POLICY "fremdfirma_einsaetze_manage" ON public.fremdfirma_einsaetze
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('administrator','vorarbeiter')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('administrator','vorarbeiter')));

COMMENT ON TABLE public.fremdfirmen IS
  'Subfirmen/Fremdfirmen für die Plantafel — nur Firmenstammdaten, kein Login/Mitarbeiter.';
COMMENT ON TABLE public.fremdfirma_einsaetze IS
  'Einsätze von Fremdfirmen auf Baustellen (Projekt + Zeitraum). Analog zu einsaetze, aber firmenbezogen.';

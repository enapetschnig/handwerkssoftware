-- ═══════════════════════════════════════════════════════════════════
-- USER-DELETE DATEN-ERHALTUNG
-- ═══════════════════════════════════════════════════════════════════
-- Bislang: Das Loeschen eines auth.users hat via ON DELETE CASCADE
-- alle time_entries, einsaetze, employees etc. mitgerissen. Konkreter
-- Vorfall: Manfred Bettger - 102.5 h Stunden waeren weg gewesen
-- wenn der UI-Loesch-Pfad jemals erfolgreich durchgelaufen waere.
--
-- Diese Migration:
--   1. Erzeugt eine Archiv-Tabelle deleted_users_archive — sichert
--      Name, Telefon, Adresse, austritt_datum, raw-Daten vor Loeschung.
--   2. Stellt FKs auf historisch relevanten Tabellen auf
--      ON DELETE SET NULL um (time_entries, employees, documents,
--      einsaetze, reports). NOT-NULL-Constraint auf user_id wird gedroppt,
--      sodass NULL-Werte erlaubt sind.
--   3. Fuegt eine archived_user_id-Spalte hinzu, die nach dem User-Delete
--      auf den deleted_users_archive-Eintrag zeigt — so wissen wir trotz
--      NULL user_id immer, von wem der historische Eintrag stammt.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. Archive-Tabelle ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.deleted_users_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_user_id UUID NOT NULL,
  email TEXT,
  vorname TEXT,
  nachname TEXT,
  username TEXT,
  telefon TEXT,
  adresse TEXT,
  plz TEXT,
  ort TEXT,
  land TEXT,
  austritt_datum DATE,
  rolle TEXT,
  -- Roh-Snapshots, falls spaeter ein Feld nachgereicht wurde
  employee_snapshot JSONB,
  profile_snapshot JSONB,
  auth_meta_snapshot JSONB,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notiz TEXT
);

CREATE INDEX IF NOT EXISTS idx_deleted_users_archive_original_user_id
  ON public.deleted_users_archive(original_user_id);
CREATE INDEX IF NOT EXISTS idx_deleted_users_archive_deleted_at
  ON public.deleted_users_archive(deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_deleted_users_archive_nachname
  ON public.deleted_users_archive(nachname, vorname);

ALTER TABLE public.deleted_users_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deleted_users_archive_admin_read" ON public.deleted_users_archive;
CREATE POLICY "deleted_users_archive_admin_read"
  ON public.deleted_users_archive FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('administrator', 'vorarbeiter')
  ));

DROP POLICY IF EXISTS "deleted_users_archive_admin_write" ON public.deleted_users_archive;
CREATE POLICY "deleted_users_archive_admin_write"
  ON public.deleted_users_archive FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'administrator'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'administrator'
  ));

COMMENT ON TABLE public.deleted_users_archive IS
  'Snapshot-Tabelle: vor einer User-Loeschung werden hier Stammdaten gesichert. Verwaiste historische Eintraege (time_entries, employees, ...) zeigen via archived_user_id auf den Snapshot.';

-- ─── 2. FK-Schalter & Archiv-Referenz auf time_entries ─────────────
-- 2a. user_id NULLable machen
ALTER TABLE public.time_entries
  ALTER COLUMN user_id DROP NOT NULL;

-- 2b. CASCADE durch SET NULL ersetzen
ALTER TABLE public.time_entries
  DROP CONSTRAINT IF EXISTS time_entries_user_id_fkey;
ALTER TABLE public.time_entries
  ADD CONSTRAINT time_entries_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id)
    ON DELETE SET NULL;

-- 2c. Archiv-Referenz: nach User-Delete zeigt diese Spalte auf den Snapshot
ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS archived_user_id UUID
    REFERENCES public.deleted_users_archive(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_time_entries_archived_user_id
  ON public.time_entries(archived_user_id)
  WHERE archived_user_id IS NOT NULL;

COMMENT ON COLUMN public.time_entries.user_id IS
  'Mitarbeiter dieses Stunden-Eintrags. NULL wenn der Mitarbeiter geloescht wurde — dann verweist archived_user_id auf den Snapshot in deleted_users_archive.';
COMMENT ON COLUMN public.time_entries.archived_user_id IS
  'Verweis auf deleted_users_archive nachdem der zugehoerige auth.users-Eintrag geloescht wurde. NULL solange der User noch aktiv ist.';

-- ─── 3. Gleiche Behandlung fuer employees ───────────────────────────
ALTER TABLE public.employees
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_user_id_fkey;
ALTER TABLE public.employees
  ADD CONSTRAINT employees_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id)
    ON DELETE SET NULL;
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS archived_user_id UUID
    REFERENCES public.deleted_users_archive(id) ON DELETE SET NULL;

-- ─── 4. Documents (Personalakten / Krankmeldungen) ─────────────────
ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS documents_user_id_fkey;
ALTER TABLE public.documents
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.documents
  ADD CONSTRAINT documents_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id)
    ON DELETE SET NULL;
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS archived_user_id UUID
    REFERENCES public.deleted_users_archive(id) ON DELETE SET NULL;

-- ─── 5. Einsaetze (Plantafel-Historie) ─────────────────────────────
-- einsaetze.user_id verweist auf profiles. profiles wird beim
-- User-Delete via CASCADE entfernt (profiles_id_fkey CASCADE auf
-- auth.users). Damit historische Einsaetze nicht weg sind, FK-Schalter
-- + NULL-Toleranz.
ALTER TABLE public.einsaetze
  DROP CONSTRAINT IF EXISTS einsaetze_user_id_fkey;
ALTER TABLE public.einsaetze
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.einsaetze
  ADD CONSTRAINT einsaetze_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id)
    ON DELETE SET NULL;
ALTER TABLE public.einsaetze
  ADD COLUMN IF NOT EXISTS archived_user_id UUID
    REFERENCES public.deleted_users_archive(id) ON DELETE SET NULL;

-- ─── 6. Reports ─────────────────────────────────────────────────────
ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_user_id_fkey;
ALTER TABLE public.reports
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.reports
  ADD CONSTRAINT reports_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id)
    ON DELETE SET NULL;
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS archived_user_id UUID
    REFERENCES public.deleted_users_archive(id) ON DELETE SET NULL;

-- ─── 7. NICHT umstellen ────────────────────────────────────────────
-- profiles, user_roles, team_members, photo_prompt_locks,
-- worker_assignments_legacy, user_role_overrides bleiben CASCADE —
-- das sind sitzungs-/berechtigungs-gebundene Eintraege, deren
-- Erhaltung beim User-Delete keinen Mehrwert hat.

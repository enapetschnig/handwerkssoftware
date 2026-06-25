-- Hauptprojekt / Unterprojekt-Verknuepfung.
-- User-Wunsch (15.06.2026): bestehende Projekte sollen miteinander
-- verknuepft werden koennen — Hauptprojekt sammelt allgemeine Infos,
-- Unterprojekte fuer einzelne Leistungen (z.B. Fliesen, Boden, Tueren).
--
-- projects.projekt_typ existiert bereits ('hauptprojekt' | 'unterprojekt'
-- | 'einzelprojekt') wird beim Anlegen geschrieben — aber bisher fehlt
-- der FK auf das Hauptprojekt, weshalb die Verknuepfung nicht persistiert
-- werden konnte.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS parent_project_id UUID
    REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_parent_project_id
  ON public.projects(parent_project_id)
  WHERE parent_project_id IS NOT NULL;

COMMENT ON COLUMN public.projects.parent_project_id IS
  'Verweist auf das Hauptprojekt, wenn dieses Projekt ein Unterprojekt ist. NULL = Hauptprojekt oder Einzelprojekt.';

-- projekt_typ-Konsolidierung: bestehende Datensaetze ohne Wert als
-- "einzelprojekt" markieren, damit der Edit-Dialog einen sichtbaren
-- Default sieht und nicht weiter leere Felder zeigt.
UPDATE public.projects
  SET projekt_typ = 'einzelprojekt'
  WHERE projekt_typ IS NULL OR TRIM(projekt_typ) = '';

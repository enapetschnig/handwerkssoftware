-- Materialien vs. Arbeitsleistungen — getrennte Verwaltung im Template-Katalog.
-- User-Wunsch (15.06.2026): "Arbeitsleistungen und Materialien als getrennte
-- Gruppen führen, separat ausgewählt und verwaltet werden können."
--
-- Bisheriges Feld `kategorie` ist Freitext-Bezeichnung (Fliesen, Geräte, …).
-- Neu: `art`-Spalte als strukturierte Klassifizierung Material vs. Leistung.

ALTER TABLE public.invoice_templates
  ADD COLUMN IF NOT EXISTS art TEXT;  -- 'material' | 'leistung' | NULL (Bestand)

CREATE INDEX IF NOT EXISTS idx_invoice_templates_art
  ON public.invoice_templates(art) WHERE art IS NOT NULL;

COMMENT ON COLUMN public.invoice_templates.art IS
  'Material oder Arbeitsleistung. NULL = Bestand vor dieser Migration (im UI als "unbestimmt" anzeigen, User kann zuordnen).';

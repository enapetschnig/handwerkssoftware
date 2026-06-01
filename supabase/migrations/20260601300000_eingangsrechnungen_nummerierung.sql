-- Eingangsrechnungen: fortlaufende Nummerierung ER_YYYY_NNN
-- + Immutability-Trigger (finanzamtskonform: einmal vergeben,
-- nicht mehr änderbar). Backfill für bestehende Datensätze.

-- 1) Spalte hinzufügen (UNIQUE später nach Backfill, sonst bricht der
-- Backfill bei mehrfachen NULLs nicht — UNIQUE-Constraint NULL-tolerant).
ALTER TABLE public.purchase_invoices
  ADD COLUMN IF NOT EXISTS nummer TEXT;

-- 2) number_ranges-Eintrag für eingangsrechnung (analog Ausgangsrechnungen)
INSERT INTO public.number_ranges (typ, label, prefix, suffix, format_pattern, start_nummer, aktuelle_nummer, stellen, jahr_format)
VALUES ('eingangsrechnung', 'Eingangsrechnungen', 'ER', '', '{PREFIX}_{YYYY}_{NNN}', 1, 0, 3, 'YY')
ON CONFLICT (typ) DO NOTHING;

-- 3) Backfill: bestehende Datensätze chronologisch durchnummerieren
-- Pro Jahrgang separat — Jahr aus rechnungsdatum ableiten.
DO $$
DECLARE
  rec RECORD;
  yr INTEGER;
  current_yr INTEGER := -1;
  counter INTEGER := 0;
  new_nummer TEXT;
BEGIN
  FOR rec IN
    SELECT id, rechnungsdatum
    FROM public.purchase_invoices
    WHERE nummer IS NULL
    ORDER BY rechnungsdatum NULLS LAST, created_at
  LOOP
    yr := EXTRACT(YEAR FROM COALESCE(rec.rechnungsdatum, NOW()::DATE));
    IF yr <> current_yr THEN
      current_yr := yr;
      counter := 0;
    END IF;
    counter := counter + 1;
    new_nummer := FORMAT('ER_%s_%s', yr, LPAD(counter::TEXT, 3, '0'));
    UPDATE public.purchase_invoices SET nummer = new_nummer WHERE id = rec.id;
  END LOOP;

  -- aktuelle_nummer in number_ranges auf den höchsten Backfill-Wert
  -- für das laufende Jahr setzen, damit next_document_number nahtlos
  -- weiterzählt.
  UPDATE public.number_ranges
  SET aktuelle_nummer = COALESCE((
    SELECT MAX(
      SPLIT_PART(SPLIT_PART(nummer, '_', 3), '', 1)::INTEGER
    )
    FROM public.purchase_invoices
    WHERE nummer LIKE FORMAT('ER_%s_%%', EXTRACT(YEAR FROM NOW())::INTEGER)
  ), 0)
  WHERE typ = 'eingangsrechnung';
END;
$$ LANGUAGE plpgsql;

-- 4) UNIQUE-Constraint NACH Backfill
ALTER TABLE public.purchase_invoices
  DROP CONSTRAINT IF EXISTS purchase_invoices_nummer_unique;
ALTER TABLE public.purchase_invoices
  ADD CONSTRAINT purchase_invoices_nummer_unique UNIQUE (nummer);

-- 5) Auto-Nummer beim Insert via BEFORE INSERT-Trigger
CREATE OR REPLACE FUNCTION public.purchase_invoices_auto_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  yr INTEGER;
BEGIN
  IF NEW.nummer IS NULL OR NEW.nummer = '' THEN
    yr := EXTRACT(YEAR FROM COALESCE(NEW.rechnungsdatum, NOW()::DATE))::INTEGER;
    NEW.nummer := public.next_document_number('eingangsrechnung', yr);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_invoices_auto_number ON public.purchase_invoices;
CREATE TRIGGER trg_purchase_invoices_auto_number
  BEFORE INSERT ON public.purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION public.purchase_invoices_auto_number();

-- 6) Immutability-Trigger: nummer + rechnungsdatum gesperrt für UPDATE
CREATE OR REPLACE FUNCTION public.purchase_invoices_immutable_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.nummer IS DISTINCT FROM OLD.nummer THEN
    RAISE EXCEPTION 'Eingangsrechnungs-Nummer kann nicht geändert werden (finanzamtskonform)';
  END IF;
  IF NEW.rechnungsdatum IS DISTINCT FROM OLD.rechnungsdatum THEN
    RAISE EXCEPTION 'Rechnungsdatum einer Eingangsrechnung kann nicht geändert werden (finanzamtskonform)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_invoices_immutable ON public.purchase_invoices;
CREATE TRIGGER trg_purchase_invoices_immutable
  BEFORE UPDATE ON public.purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION public.purchase_invoices_immutable_fields();

COMMENT ON COLUMN public.purchase_invoices.nummer IS
  'Interne fortlaufende Nummer ER_YYYY_NNN. Beim Insert automatisch gesetzt via Trigger. Nicht änderbar (Immutability-Trigger).';

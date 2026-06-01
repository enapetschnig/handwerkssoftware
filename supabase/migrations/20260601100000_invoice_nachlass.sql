-- Nachlass-Posten zusätzlich zum globalen Rabatt: User-definierter
-- Freitext + Betrag (z. B. "Nachlass für Eigenleistung -200 €").
-- Wird im PDF/HTML zwischen Rabatt und Nettobetrag als eigene Zeile
-- gerendert und vom Netto subtrahiert.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS nachlass_betrag NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nachlass_bezeichnung TEXT;

COMMENT ON COLUMN public.invoices.nachlass_betrag IS
  'Zusätzlicher Abzug-Posten zum globalen Rabatt — User-definiert (z. B. "Nachlass für Eigenleistung"). Wird vom Netto subtrahiert. NULL/0 = kein Nachlass.';
COMMENT ON COLUMN public.invoices.nachlass_bezeichnung IS
  'Anzeige-Label für den Nachlass-Posten im PDF/HTML. Fallback wenn NULL: "Nachlass".';

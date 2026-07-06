-- Plantafel-Balken: optionale Textfarbe (User-Feedback 06.07.2026)
--
-- Die Lieblingsfarben konnten bisher nur einen Hintergrund setzen; die
-- Balken-Schrift war hart schwarz und auf dunklen Farben unlesbar. Jetzt
-- kann pro Board-Projekt eine Textfarbe gespeichert werden. Ist keine
-- gesetzt, berechnet das Frontend automatisch Schwarz/Weiß nach Kontrast.

ALTER TABLE public.board_projects
  ADD COLUMN IF NOT EXISTS board_text_color TEXT;

COMMENT ON COLUMN public.board_projects.board_text_color IS
  'Optionale Textfarbe des Balkens. NULL → Frontend nutzt Auto-Kontrast (schwarz/weiß je nach Hintergrund).';

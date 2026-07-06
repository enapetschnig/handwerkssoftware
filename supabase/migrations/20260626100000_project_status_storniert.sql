-- Projektstatus "Storniert" ergänzen (User-Feedback 26.06.2026)
--
-- In der Projektliste kann der Status unten rechts geändert werden
-- (Anfrage / Angebot / Auftrag / In Arbeit / …). Es fehlte eine
-- Möglichkeit, Projekte, die nicht zustande kommen oder abgesagt
-- wurden, sauber als storniert zu kennzeichnen.
--
-- Sortierung hinter "Abgeschlossen" (sort_order 8). Rot als Signalfarbe.
-- Idempotent: falls schon vorhanden, passiert nichts.

INSERT INTO project_statuses (name, farbe_bg, farbe_text, sort_order, is_default)
VALUES ('Storniert', '#dc2626', '#ffffff', 8, FALSE)
ON CONFLICT (name) DO NOTHING;

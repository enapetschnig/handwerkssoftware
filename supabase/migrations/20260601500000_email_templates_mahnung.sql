-- Mahnungs-Email-Templates seeden. User kann sie im Admin-Bereich
-- editieren. Drei Stufen:
--  1. Zahlungserinnerung (freundlich)
--  2. Mahnung 2 (eindringlich)
--  3. Mahnung 3 (letzte Aufforderung)
-- Platzhalter zusätzlich zu den Standard-Vars:
--  {{mahnstufe}} = "1"/"2"/"3"
--  {{offen}}     = offener Betrag (brutto - bezahlt)

INSERT INTO public.email_templates (typ, subject, body_html)
VALUES
  ('mahnung_1',
   'Zahlungserinnerung zu Rechnung {{dokument_nr}}',
   '<p>Sehr geehrte Damen und Herren,</p>'
   || '<p>vermutlich ist es nur ein Versehen — unsere Rechnung <strong>{{dokument_nr}}</strong> '
   || 'vom {{dokument_datum}} über <strong>{{betrag}}</strong> ist bisher unbeglichen.</p>'
   || '<p>Wir bitten Sie höflich, den offenen Betrag von <strong>{{offen}}</strong> '
   || 'innerhalb der nächsten 7 Tage zu überweisen.</p>'
   || '<p>Sollte sich die Zahlung mit dieser Erinnerung überschnitten haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.</p>'
   || '<p>Mit freundlichen Grüßen<br>{{firma}}</p>'),
  ('mahnung_2',
   '2. Mahnung zu Rechnung {{dokument_nr}}',
   '<p>Sehr geehrte Damen und Herren,</p>'
   || '<p>trotz unserer Zahlungserinnerung ist unsere Rechnung <strong>{{dokument_nr}}</strong> '
   || 'vom {{dokument_datum}} über <strong>{{betrag}}</strong> noch immer unbezahlt.</p>'
   || '<p>Wir fordern Sie auf, den offenen Betrag von <strong>{{offen}}</strong> umgehend, spätestens innerhalb von 7 Tagen, zu überweisen.</p>'
   || '<p>Bei weiterer Säumnis behalten wir uns die Berechnung von Mahngebühren und Verzugszinsen vor.</p>'
   || '<p>Mit freundlichen Grüßen<br>{{firma}}</p>'),
  ('mahnung_3',
   'Letzte Mahnung zu Rechnung {{dokument_nr}} — Inkasso-Übergabe angekündigt',
   '<p>Sehr geehrte Damen und Herren,</p>'
   || '<p>unsere Rechnung <strong>{{dokument_nr}}</strong> vom {{dokument_datum}} über <strong>{{betrag}}</strong> '
   || 'ist trotz mehrfacher Mahnung weiterhin unbeglichen. Der derzeit offene Betrag beläuft sich auf <strong>{{offen}}</strong>.</p>'
   || '<p>Wir fordern Sie hiermit <strong>letztmalig</strong> auf, diesen Betrag binnen 7 Tagen ab Erhalt dieses Schreibens zu überweisen.</p>'
   || '<p>Sollte bis dahin kein Zahlungseingang erfolgen, werden wir die Forderung ohne weitere Ankündigung '
   || 'einem Inkasso-Unternehmen oder Rechtsanwalt zur weiteren Bearbeitung übergeben — verbunden mit erheblichen Mehrkosten zu Ihren Lasten.</p>'
   || '<p>Mit freundlichen Grüßen<br>{{firma}}</p>')
ON CONFLICT (typ) DO NOTHING;

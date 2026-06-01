-- Ersttermine → Fotos ins Projekt übernehmen: scheiterte bislang
-- silent an fehlenden INSERT/UPDATE/DELETE-Policies für den
-- project-photos-Bucket. Es gab nur eine SELECT-Policy, daher
-- konnte niemand Fotos in diesen Bucket hochladen.

-- INSERT: jeder authentifizierte User darf in project-photos uploaden.
-- (Sicherheit auf Anwendungsebene — UI prüft Projekt-Zugehörigkeit.)
DROP POLICY IF EXISTS "Authenticated users can upload project photos" ON storage.objects;
CREATE POLICY "Authenticated users can upload project photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'project-photos');

-- UPDATE: nötig für upsert-Operationen und Metadaten-Updates.
DROP POLICY IF EXISTS "Authenticated users can update project photos" ON storage.objects;
CREATE POLICY "Authenticated users can update project photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'project-photos')
  WITH CHECK (bucket_id = 'project-photos');

-- DELETE: Admin-Recht für Aufräum-Aktionen.
DROP POLICY IF EXISTS "Admins can delete project photos" ON storage.objects;
CREATE POLICY "Admins can delete project photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'project-photos'
    AND has_role(auth.uid(), 'administrator'::app_role)
  );

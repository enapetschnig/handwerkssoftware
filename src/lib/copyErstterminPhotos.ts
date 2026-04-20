import { supabase } from "@/integrations/supabase/client";

/**
 * Kopiert alle Fotos eines Ersttermins in den project-photos-Bucket des
 * verknüpften Projekts. Idempotent: Dateien, die bereits dort liegen
 * (gleicher Dateiname), werden übersprungen.
 */
export async function copyErstterminPhotosToProject(
  erstterminId: string,
  projectId: string
): Promise<{ copied: number; skipped: number; failed: number }> {
  let copied = 0;
  let skipped = 0;
  let failed = 0;

  const { data: photos } = await (supabase.from("ersttermin_interessent_photos" as never) as any)
    .select("id, file_path, file_name")
    .eq("ersttermin_interessent_id", erstterminId);

  if (!photos?.length) return { copied, skipped, failed };

  // Vorhandene Dateien im Zielordner auflisten (für Dedup)
  const { data: existing } = await supabase.storage
    .from("project-photos")
    .list(projectId);
  const existingNames = new Set((existing || []).map((f) => f.name));

  for (const photo of photos as any[]) {
    const srcPath = photo.file_path as string;
    // Wir behalten den Original-Dateinamen, falls möglich, sonst nehmen wir
    // die Datei-Basis-Bezeichnung aus dem Storage-Pfad.
    const basename = (photo.file_name || srcPath.split("/").pop() || `foto_${Date.now()}.jpg`)
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    const destName = `ersttermin_${basename}`;
    const destPath = `${projectId}/${destName}`;

    if (existingNames.has(destName)) {
      skipped++;
      continue;
    }

    try {
      const { data: blob, error: dlErr } = await supabase.storage
        .from("ersttermin-photos")
        .download(srcPath);
      if (dlErr || !blob) {
        failed++;
        continue;
      }
      const { error: upErr } = await supabase.storage
        .from("project-photos")
        .upload(destPath, blob, { upsert: false, contentType: blob.type || "image/jpeg" });
      if (upErr) {
        failed++;
        continue;
      }
      copied++;
    } catch {
      failed++;
    }
  }

  return { copied, skipped, failed };
}

import { supabase } from "@/integrations/supabase/client";

export interface CopyResult {
  copied: number;
  skipped: number;
  failed: number;
  errors: string[];
}

/**
 * Kopiert alle Fotos eines Ersttermins in den project-photos-Bucket des
 * verknüpften Projekts. Idempotent: Dateien, die bereits dort liegen
 * (gleicher Dateiname), werden übersprungen.
 *
 * Detailliertes Error-Logging pro Foto (siehe `errors`-Array im
 * Rückgabewert), damit der User im UI Fehler-Ursachen sieht statt
 * eines stillen Scheiterns.
 */
export async function copyErstterminPhotosToProject(
  erstterminId: string,
  projectId: string
): Promise<CopyResult> {
  const result: CopyResult = { copied: 0, skipped: 0, failed: 0, errors: [] };

  const { data: photos, error: photosErr } = await (supabase.from("ersttermin_interessent_photos" as never) as any)
    .select("id, file_path, file_name")
    .eq("ersttermin_interessent_id", erstterminId);

  if (photosErr) {
    result.errors.push(`Foto-Liste konnte nicht geladen werden: ${photosErr.message}`);
    return result;
  }
  if (!photos?.length) return result;

  // Vorhandene Dateien im Zielordner auflisten (für Dedup)
  const { data: existing, error: listErr } = await supabase.storage
    .from("project-photos")
    .list(projectId);
  if (listErr) {
    // Liste-Fehler ist nicht fatal — wir kopieren ohne Dedup weiter
    result.errors.push(`Ziel-Ordner konnte nicht gelistet werden: ${listErr.message}`);
  }
  const existingNames = new Set((existing || []).map((f) => f.name));

  for (const photo of photos as { id: string; file_path: string; file_name?: string }[]) {
    const srcPath = photo.file_path;
    const basename = (photo.file_name || srcPath.split("/").pop() || `foto_${Date.now()}.jpg`)
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    const destName = `ersttermin_${basename}`;
    const destPath = `${projectId}/${destName}`;

    if (existingNames.has(destName)) {
      result.skipped++;
      continue;
    }

    try {
      const { data: blob, error: dlErr } = await supabase.storage
        .from("ersttermin-photos")
        .download(srcPath);
      if (dlErr || !blob) {
        result.failed++;
        result.errors.push(`${basename}: Download fehlgeschlagen — ${dlErr?.message || "leer"}`);
        continue;
      }
      const { error: upErr } = await supabase.storage
        .from("project-photos")
        .upload(destPath, blob, { upsert: false, contentType: blob.type || "image/jpeg" });
      if (upErr) {
        result.failed++;
        result.errors.push(`${basename}: Upload fehlgeschlagen — ${upErr.message}`);
        continue;
      }
      result.copied++;
    } catch (err) {
      result.failed++;
      result.errors.push(`${basename}: ${(err as Error).message || "Unbekannter Fehler"}`);
    }
  }

  return result;
}

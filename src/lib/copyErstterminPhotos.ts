import { supabase } from "@/integrations/supabase/client";

export interface CopyResult {
  copied: number;
  skipped: number;
  failed: number;
  errors: string[];
}

/**
 * Kopiert alle Fotos eines Ersttermins in das verknüpfte Projekt.
 *
 * WICHTIG: Ein Projekt-Foto besteht aus ZWEI Teilen — der Datei im
 * `project-photos`-Bucket UND einer Zeile in der `documents`-Tabelle
 * (typ='photos'). Die Projekt-Galerie liest ausschließlich `documents`.
 * Frühere Versionen luden nur in den Bucket → die Fotos tauchten nie im
 * Projekt auf, und beim zweiten Klick meldete der Dedup „übersprungen",
 * obwohl in der DB nichts existierte. Deshalb: Dedup + Zählung laufen
 * jetzt über die `documents`-Tabelle, und pro Foto wird eine
 * `documents`-Zeile angelegt.
 *
 * Idempotent: existiert bereits eine `documents`-Zeile mit gleichem
 * Namen, wird übersprungen. Storage-Upload nutzt upsert=true, damit
 * verwaiste Dateien aus alten Versuchen mitrepariert werden.
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

  const { data: { user } } = await supabase.auth.getUser();

  // Bereits im Projekt vorhandene Foto-Dokumente laden (für Dedup).
  // Die Galerie liest aus `documents`, also ist das die maßgebliche Quelle.
  const { data: existingDocs, error: listErr } = await supabase
    .from("documents")
    .select("name")
    .eq("project_id", projectId)
    .eq("typ", "photos");
  if (listErr) {
    // Liste-Fehler ist nicht fatal — wir kopieren ohne Dedup weiter
    result.errors.push(`Vorhandene Projekt-Fotos konnten nicht geladen werden: ${listErr.message}`);
  }
  const existingNames = new Set(((existingDocs as { name: string }[]) || []).map((d) => d.name));

  for (const photo of photos as { id: string; file_path: string; file_name?: string }[]) {
    const srcPath = photo.file_path;
    const basename = (photo.file_name || srcPath.split("/").pop() || `foto_${Date.now()}.jpg`)
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    // photo.id in den Zielnamen aufnehmen — sonst kollidieren zwei
    // verschiedene Fotos mit gleichem Dateinamen (z.B. IMG-…-WA0001.jpg,
    // Kamera-Defaults) und das zweite würde still als "übersprungen"
    // gezählt. Mit photo.id bleibt es idempotent (Re-Run → gleicher Name)
    // und kollisionsfrei zwischen unterschiedlichen Fotos.
    const destName = `ersttermin_${photo.id}_${basename}`;
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
      // upsert=true: repariert auch verwaiste Storage-Dateien aus alten
      // Kopier-Versuchen, die noch keine documents-Zeile hatten.
      const { error: upErr } = await supabase.storage
        .from("project-photos")
        .upload(destPath, blob, { upsert: true, contentType: blob.type || "image/jpeg" });
      if (upErr) {
        result.failed++;
        result.errors.push(`${basename}: Upload fehlgeschlagen — ${upErr.message}`);
        continue;
      }
      // documents-Zeile anlegen — sonst erscheint das Foto nie im Projekt.
      const { data: urlData } = supabase.storage.from("project-photos").getPublicUrl(destPath);
      const { error: dbErr } = await supabase.from("documents").insert({
        project_id: projectId,
        user_id: user?.id ?? null,
        typ: "photos",
        name: destName,
        file_url: urlData.publicUrl,
        beschreibung: "Aus Ersttermin übernommen",
      } as any);
      if (dbErr) {
        // Rollback — verwaistes Storage-File wieder entfernen
        await supabase.storage.from("project-photos").remove([destPath]);
        result.failed++;
        result.errors.push(`${basename}: DB-Eintrag fehlgeschlagen — ${dbErr.message}`);
        continue;
      }
      existingNames.add(destName);
      result.copied++;
    } catch (err) {
      result.failed++;
      result.errors.push(`${basename}: ${(err as Error).message || "Unbekannter Fehler"}`);
    }
  }

  return result;
}

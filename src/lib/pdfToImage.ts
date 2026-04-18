/**
 * Rendert die erste Seite eines PDFs in ein Bild (JPEG data URL).
 * Wird für den KI-Scan von Eingangsrechnungen verwendet, da GPT-4 Vision
 * nur Bilder akzeptiert, keine PDFs.
 */

let workerConfigured = false;

async function ensureWorker() {
  if (workerConfigured) return;
  const pdfjs = await import("pdfjs-dist");
  // Worker aus dem Bundle laden (via Vite ?url import)
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  workerConfigured = true;
}

/**
 * Lädt die erste Seite einer PDF-Datei als JPEG-Data-URL mit definiertem
 * Skalierungsfaktor (Default ~1440px breit — gut für OCR, nicht zu groß).
 */
export async function pdfFirstPageToJpegDataUrl(file: File, maxWidth = 1440, quality = 0.85): Promise<string> {
  await ensureWorker();
  const pdfjs = await import("pdfjs-dist");

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);

  // Skalierung so wählen, dass Breite ~maxWidth beträgt
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(3, Math.max(1, maxWidth / baseViewport.width));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D-Context nicht verfügbar");

  // Weißer Hintergrund (manche PDFs sind transparent)
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport, canvas }).promise;

  return canvas.toDataURL("image/jpeg", quality);
}

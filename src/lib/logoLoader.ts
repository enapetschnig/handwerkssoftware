import { supabase } from "@/integrations/supabase/client";

let cachedLogoDataUri: string | null | undefined;
let cachedAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5min

/**
 * Lädt das Firmenlogo als Data-URI.
 * Reihenfolge:
 *   1. Custom-Logo aus Supabase Storage (logos/logo.*)
 *   2. Fallback: Standard MONTI.PRO Logo
 *
 * In-Memory-Cache für 5 Minuten um Netzwerk-Last zu reduzieren.
 */
export async function loadInvoiceLogo(forceRefresh = false): Promise<string | undefined> {
  const now = Date.now();
  if (!forceRefresh && cachedLogoDataUri !== undefined && (now - cachedAt) < CACHE_TTL) {
    return cachedLogoDataUri || undefined;
  }

  const asDataUri = async (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });

  // 1. Versuch: Custom-Logo aus Supabase Storage
  try {
    const extensions = ["png", "jpg", "jpeg", "webp"];
    for (const ext of extensions) {
      const { data } = supabase.storage.from("logos").getPublicUrl(`logo.${ext}`);
      if (!data?.publicUrl) continue;
      try {
        const res = await fetch(data.publicUrl, { cache: "no-cache" });
        if (res.ok) {
          const blob = await res.blob();
          // Minimal size check — Supabase liefert leeres blob wenn Datei nicht existiert (200 OK aber 0 bytes)
          if (blob.size > 100) {
            const uri = await asDataUri(blob);
            cachedLogoDataUri = uri;
            cachedAt = now;
            return uri;
          }
        }
      } catch { /* try next extension */ }
    }
  } catch { /* fall through to default */ }

  // 2. Fallback: Standard MONTI.PRO Logo
  try {
    const res = await fetch("/newmontilogo.png");
    const blob = await res.blob();
    const uri = await asDataUri(blob);
    cachedLogoDataUri = uri;
    cachedAt = now;
    return uri;
  } catch {
    cachedLogoDataUri = null;
    cachedAt = now;
    return undefined;
  }
}

/** Cache invalidieren — z.B. nach Logo-Upload im Admin */
export function clearLogoCache() {
  cachedLogoDataUri = undefined;
  cachedAt = 0;
}

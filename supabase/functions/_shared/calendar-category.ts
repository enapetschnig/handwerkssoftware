/**
 * Shared Helper für den Kategorie-basierten Google-Kalender-Routing.
 *
 * Jedes Projekt trägt eine `kategorie` (montipro / bks / gartenmacher /
 * fensterwerk / ladenbau / portas / chef) oder NULL. Die passende
 * Kalender-ID wird aus `app_settings.google_calendar_id_<kategorie>`
 * bzw. bei NULL aus `app_settings.google_calendar_id_default` gelesen.
 */

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export type ProjektKategorie =
  | 'montipro' | 'bks' | 'gartenmacher' | 'fensterwerk'
  | 'ladenbau' | 'portas' | 'chef';

/** Liste aller gültigen Kategorien (Single Source of Truth). */
export const KATEGORIE_VALUES: readonly ProjektKategorie[] = [
  'montipro', 'bks', 'gartenmacher', 'fensterwerk',
  'ladenbau', 'portas', 'chef',
] as const;

export function isKategorie(v: unknown): v is ProjektKategorie {
  return typeof v === 'string' && (KATEGORIE_VALUES as readonly string[]).includes(v);
}

/**
 * Lädt die Google-Calendar-ID für ein Projekt — anhand der
 * `projects.kategorie`-Spalte. Bei NULL-Kategorie wird die
 * Default-Calendar-ID zurückgegeben. Bei fehlendem Default wird
 * NULL zurückgegeben (aufrufer-Check nötig).
 */
export async function getCalendarIdForProject(
  supabase: SupabaseClient,
  projectId: string,
): Promise<string | null> {
  if (!projectId) {
    return await getDefaultCalendarId(supabase);
  }

  const { data: proj } = await supabase
    .from('projects')
    .select('kategorie')
    .eq('id', projectId)
    .maybeSingle();

  const cat = proj?.kategorie;
  const key = isKategorie(cat) ? `google_calendar_id_${cat}` : 'google_calendar_id_default';

  const { data: setting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  const id = setting?.value?.trim();
  if (id) return id;

  // Fallback: wenn kategorie-spezifische ID fehlt aber Kategorie gesetzt
  // war, versuche Default statt mit leerem String zu returnen.
  if (isKategorie(cat)) {
    return await getDefaultCalendarId(supabase);
  }
  return null;
}

async function getDefaultCalendarId(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'google_calendar_id_default')
    .maybeSingle();
  return data?.value?.trim() || null;
}

/**
 * Lädt das komplette Mapping (alle 7 Kategorien + Default) —
 * nützlich für den Multi-Kalender-Viewer, der alle gleichzeitig
 * abfragen muss.
 */
export async function getAllCalendarIds(
  supabase: SupabaseClient,
): Promise<Record<ProjektKategorie | 'default', string | null>> {
  const keys = [
    ...KATEGORIE_VALUES.map(k => `google_calendar_id_${k}`),
    'google_calendar_id_default',
  ];
  const { data } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', keys);

  const result: Record<string, string | null> = {};
  for (const k of KATEGORIE_VALUES) result[k] = null;
  result['default'] = null;

  for (const row of (data as Array<{ key: string; value: string }> ) || []) {
    const m = row.key.match(/^google_calendar_id_(.+)$/);
    if (m) result[m[1]] = row.value?.trim() || null;
  }

  return result as Record<ProjektKategorie | 'default', string | null>;
}

/** 404-Erkennung aus Google-API-Fehlern. */
export function isNotFoundError(err: unknown): boolean {
  if (!err) return false;
  // deno-lint-ignore no-explicit-any
  const e = err as any;
  if (e.status === 404) return true;
  if (typeof e.message === 'string' && /not\s*found|404/i.test(e.message)) return true;
  return false;
}

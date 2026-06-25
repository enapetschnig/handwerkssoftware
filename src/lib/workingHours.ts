export interface WorkTimePreset {
  startTime: string;
  endTime: string;
  pauseStart: string;
  pauseEnd: string;
  pauseMinutes: number;
  totalHours: number;
}

/**
 * Regelarbeitszeit pro Werktag.
 * Mo-Do: 10h (07:00-17:30, Pause 12:00-12:30). Fr/Sa/So: arbeitsfrei.
 *
 * Optionales holidaySet (YYYY-MM-DD-Strings) — wenn der Tag in dem Set
 * enthalten ist, wird 0 zurueckgegeben (oeffentlicher Feiertag = arbeitsfrei).
 * Hook fuer das Set: useAustrianHolidays.
 */
export function getNormalWorkingHours(date: Date, holidaySet?: Set<string>): number {
  if (holidaySet) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    if (holidaySet.has(`${yyyy}-${mm}-${dd}`)) return 0;
  }
  const dayOfWeek = date.getDay();
  if (dayOfWeek >= 1 && dayOfWeek <= 4) return 10;
  return 0;
}

/**
 * Früher gab es einen Freitags-Überstundenanteil — entfällt mit neuer
 * Regelung (Freitag arbeitsfrei). Funktion bleibt für Kompatibilität.
 */
export function getFridayOvertime(_date: Date): number {
  return 0;
}

/**
 * Gesamte Arbeitsstunden inkl. optionaler Überstunden pro Tag.
 * Deckungsgleich mit getNormalWorkingHours, da es keine automatischen
 * Überstundenanteile mehr gibt.
 */
export function getTotalWorkingHours(date: Date, holidaySet?: Set<string>): number {
  return getNormalWorkingHours(date, holidaySet);
}

/**
 * Wochensoll: 4 × 10h = 40 Stunden (Mo-Do).
 */
export function getWeeklyTargetHours(): number {
  return 40;
}

/**
 * Standard-Arbeitszeiten für einen Tag.
 */
export function getDefaultWorkTimes(date: Date): WorkTimePreset | null {
  const dayOfWeek = date.getDay();

  // Mo-Do: 07:00 - 17:30, Pause 12:00 - 12:30 = 10h netto
  if (dayOfWeek >= 1 && dayOfWeek <= 4) {
    return {
      startTime: "07:00",
      endTime: "17:30",
      pauseStart: "12:00",
      pauseEnd: "12:30",
      pauseMinutes: 30,
      totalHours: 10,
    };
  }

  // Fr/Sa/So: arbeitsfrei
  return null;
}

/**
 * Arbeitsfrei: Freitag, Samstag, Sonntag.
 */
export function isNonWorkingDay(date: Date): boolean {
  const dayOfWeek = date.getDay();
  return dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
}

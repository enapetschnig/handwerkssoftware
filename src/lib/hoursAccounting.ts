// Zentrale Saldo-Logik für Stundenauswertung.
//
// Kernregel: Überstunden und Minusstunden werden PRO TAG gerechnet,
// nicht pro time_entry. Bei mehreren Projekten am selben Tag würde
// eine per-Entry-Berechnung Math.max(0, 6h - 10h) = 0 zweimal liefern,
// obwohl der Tag in Summe 12h und damit +2h Überstunden hat.
//
// Sonderzeiten (Urlaub / Krankenstand / Feiertag / Zeitausgleich /
// Weiterbildung): Tagessoll wird auf 0 gesetzt UND die Stunden werden
// nicht als Überstunden gewertet. Saldo neutral pro solchem Tag.

import { getNormalWorkingHours } from "@/lib/workingHours";

export type TimeEntryLite = {
  datum: string;
  stunden: number | string | null;
  taetigkeit?: string | null;
};

export type DayBalance = {
  datum: string;          // YYYY-MM-DD
  ist: number;            // gebuchte Summe (alle Einträge des Tages)
  soll: number;           // Tagessoll (10/0 Mo-Do/sonst, 0 bei Sonderzeit)
  saldo: number;          // ist - soll, kann negativ sein
  istSonderzeit: boolean;
};

/**
 * Tätigkeiten, die das Tagessoll als erfüllt markieren — der Tag
 * wird neutral (Saldo 0) gerechnet, egal wie viele Stunden gebucht
 * sind.
 */
export const SONDER_TAETIGKEITEN = new Set([
  "Urlaub",
  "Krankenstand",
  "Feiertag",
  "Weiterbildung",
  // Zeitausgleich zählt hier als NEUTRAL (Saldo 0). Der eigentliche Abzug
  // passiert genau EINMAL über das Zeitkonto (time_accounts.balance_hours =
  // "Manuell"). Früher wurde der ZA-Tag zusätzlich mit saldo=-ist im "Auto"-
  // Saldo verrechnet → 10h ZA senkten den Effektiv-Saldo um 20h statt 10h
  // (Doppelzählung, User-Feedback 06.07.2026). Der Effektiv-Saldo
  // (Auto + Manuell) sinkt weiterhin um genau die ZA-Stunden.
  "Zeitausgleich",
]);

export const ZEITAUSGLEICH_TAETIGKEIT = "Zeitausgleich";

/**
 * Tätigkeiten, bei denen die Ort-Spalte in HoursReport/MyHours leer
 * sein soll. Umfasst SONDER_TAETIGKEITEN + Zeitausgleich — denn auch
 * an einem ZA-Tag ist "Baustelle" als Ort irreführend.
 */
export function ortAnzeigeAusblenden(taetigkeit: string | null | undefined): boolean {
  if (!taetigkeit) return false;
  return SONDER_TAETIGKEITEN.has(taetigkeit) || taetigkeit === ZEITAUSGLEICH_TAETIGKEIT;
}

/**
 * Aggregiert beliebige time_entries nach Datum und liefert je Tag
 * Ist-, Soll- und Saldo-Stunden. Sortiert aufsteigend nach Datum.
 */
export function aggregateByDay(entries: TimeEntryLite[], holidaySet?: Set<string>): DayBalance[] {
  const grouped = new Map<string, TimeEntryLite[]>();
  for (const e of entries) {
    if (!e?.datum) continue;
    const list = grouped.get(e.datum) || [];
    list.push(e);
    grouped.set(e.datum, list);
  }
  const out: DayBalance[] = [];
  for (const [datum, dayEntries] of grouped) {
    const ist = dayEntries.reduce((s, e) => s + Number(e.stunden || 0), 0);
    const istSonderzeit = dayEntries.some(
      (e) => !!e.taetigkeit && SONDER_TAETIGKEITEN.has(e.taetigkeit),
    );
    const isHoliday = holidaySet?.has(datum) === true;

    // Zwei Fälle:
    //   1) Sonderzeit (Urlaub, Krankenstand, Feiertag, Weiterbildung,
    //      Zeitausgleich) oder AT-Feiertag: Soll=0, Saldo=0 (neutral).
    //      ZA wird separat über das Zeitkonto (Manuell) abgezogen — hier
    //      neutral, um Doppelzählung zu vermeiden.
    //   2) Normaler Arbeitstag: Soll = Wochentag-Regel, Saldo = ist - soll.
    let soll: number;
    let saldo: number;
    if (istSonderzeit || isHoliday) {
      soll = 0;
      saldo = 0;
    } else {
      soll = getNormalWorkingHours(new Date(datum + "T12:00:00"), holidaySet);
      saldo = ist - soll;
    }

    out.push({
      datum, ist, soll, saldo,
      istSonderzeit: istSonderzeit || isHoliday,
    });
  }
  return out.sort((a, b) => a.datum.localeCompare(b.datum));
}

/** Saldo-Summe über die gegebenen Einträge — Auto-Saldo aus time_entries. */
export function totalAutoSaldo(entries: TimeEntryLite[], holidaySet?: Set<string>): number {
  return aggregateByDay(entries, holidaySet).reduce((s, d) => s + d.saldo, 0);
}

/**
 * Formatierter Saldo mit Vorzeichen (für UI und Excel-Export).
 * +0,00 bei genau 0 — leer string nur explizit angefordert.
 */
export function formatSaldo(value: number, opts?: { hideZero?: boolean }): string {
  if (opts?.hideZero && Math.abs(value) < 0.005) return "";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "±";
  return `${sign}${Math.abs(value).toFixed(2)}`;
}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Config ──────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const openaiKey = Deno.env.get("OPENAI_API_KEY")!;
const WAPI_TOKEN = Deno.env.get("WAPI_TOKEN")!;
const WAPI_BASE = "https://gate.whapi.cloud";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Working hours per weekday (matches src/lib/workingHours.ts)
// Mo-Do: 8.5h, Fr: 5.0h (inkl. 0.5h ZA-Überstunde), Sa-So: 0h
function getRegelarbeitszeit(date: Date = new Date()): number {
  const day = date.getDay();
  if (day === 0 || day === 6) return 0;    // Weekend
  if (day >= 1 && day <= 4) return 8.5;    // Mo-Do
  if (day === 5) return 5.0;              // Fr (inkl. 0.5h Überstunde)
  return 0;
}

// ─── Types ───────────────────────────────────────────────

interface ConversationEntry {
  role: "user" | "assistant" | "system";
  content: string;
}

// ─── WAPI helpers ────────────────────────────────────────

async function sendWhatsApp(to: string, message: string) {
  const recipient = to.includes("@") ? to : `${to}@s.whatsapp.net`;
  const res = await fetch(`${WAPI_BASE}/messages/text`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WAPI_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to: recipient, body: message }),
  });
  const result = await res.json();
  if (!res.ok) console.error("WAPI send error:", result);
  return result;
}

// SHA-256-Hash eines Bildes → Content-basierter Fingerprint für Duplikat-Erkennung
async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuf = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function downloadMedia(mediaRef: string, messageId?: string): Promise<ArrayBuffer> {
  console.log("Downloading media, ref:", mediaRef, "msgId:", messageId);

  // Method 1: Direct URL (Wasabi S3 links from WAPI)
  if (mediaRef.startsWith("http")) {
    // WAPI S3 URLs don't need auth
    const res = await fetch(mediaRef);
    if (res.ok) {
      console.log("Downloaded via direct URL, size:", res.headers.get("content-length"));
      return res.arrayBuffer();
    }
    // Try with auth
    const res2 = await fetch(mediaRef, {
      headers: { Authorization: `Bearer ${WAPI_TOKEN}` },
    });
    if (res2.ok) return res2.arrayBuffer();
    console.error("Direct URL failed:", res.status);
  }

  // Method 2: Fetch message details from WAPI to get the image link
  const msgId = messageId || mediaRef;
  if (msgId) {
    console.log("Fetching message details for:", msgId);
    const msgRes = await fetch(`${WAPI_BASE}/messages/${msgId}`, {
      headers: { Authorization: `Bearer ${WAPI_TOKEN}` },
    });
    if (msgRes.ok) {
      const msgData = await msgRes.json();
      const imgLink = msgData.image?.link || msgData.media?.link;
      console.log("Message image link:", imgLink);
      if (imgLink) {
        const dlRes = await fetch(imgLink);
        if (dlRes.ok) return dlRes.arrayBuffer();
      }
    }
  }

  // Method 3: WAPI /media endpoint
  const mediaRes = await fetch(`${WAPI_BASE}/media/${mediaRef}`, {
    headers: { Authorization: `Bearer ${WAPI_TOKEN}` },
  });
  if (mediaRes.ok) {
    const ct = mediaRes.headers.get("content-type") || "";
    if (ct.includes("json")) {
      const json = await mediaRes.json();
      const link = json.link || json.url;
      if (link) {
        const dlRes = await fetch(link);
        if (dlRes.ok) return dlRes.arrayBuffer();
      }
    } else {
      return mediaRes.arrayBuffer();
    }
  }

  throw new Error(`All download methods failed for ${mediaRef}`);
}

// ─── Speech-to-Text via OpenAI Whisper ───────────────────

async function transcribeAudio(audioUrl: string): Promise<string> {
  console.log("Transcribing audio:", audioUrl);

  const audioBuffer = await downloadMedia(audioUrl);
  const blob = new Blob([audioBuffer], { type: "audio/ogg" });

  const formData = new FormData();
  formData.append("file", blob, "voice.ogg");
  formData.append("model", "whisper-1");
  formData.append("language", "de");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: formData,
  });

  const result = await res.json();

  if (!res.ok) {
    console.error("Whisper error:", result);
    throw new Error("Spracherkennung fehlgeschlagen");
  }

  console.log("Transcribed:", result.text);
  return result.text;
}

// ─── Employee lookup ─────────────────────────────────────

async function findEmployeeByPhone(phone: string) {
  const cleaned = phone
    .replace("@s.whatsapp.net", "")
    .replace(/[\s\-\+\(\)]/g, "")
    .replace(/^0+/, "");
  const last8 = cleaned.slice(-8);

  const { data } = await supabase
    .from("employees")
    .select("id, vorname, nachname, user_id, telefon, whatsapp_aktiv")
    .or(`telefon.ilike.%${last8}%`)
    .limit(1)
    .maybeSingle();

  return data;
}

// ─── Conversation persistence ────────────────────────────

async function loadHistory(phone: string, limit = 6): Promise<ConversationEntry[]> {
  const { data } = await supabase
    .from("whatsapp_messages")
    .select("direction, message_body")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!data) return [];
  return data
    .reverse()
    .filter((m) => m.message_body)
    .map((m) => ({
      role: m.direction === "incoming" ? ("user" as const) : ("assistant" as const),
      content: m.message_body!,
    }));
}

async function saveMsg(
  phone: string,
  direction: "incoming" | "outgoing",
  body: string,
  employeeId?: string,
  userId?: string,
  wapiMessageId?: string
) {
  await supabase.from("whatsapp_messages").insert({
    phone,
    direction,
    message_body: body,
    message_type: "text",
    employee_id: employeeId || null,
    user_id: userId || null,
    processed: true,
    wapi_message_id: wapiMessageId || null,
  });
}

// ─── Helper: get monday of current week ──────────────────

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function getRegelarbeitszeitForDate(d: Date): number {
  const day = d.getDay();
  if (day === 0 || day === 6) return 0;
  if (day >= 1 && day <= 4) return 8.5;
  if (day === 5) return 5.0;
  return 0;
}

// ─── Rich context (the "brain" per employee) ─────────────

async function gatherContext(userId: string) {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const dayNames = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  const dayName = dayNames[now.getDay()];

  // Get the full week range (Monday–Sunday)
  const monday = getMonday(now);
  const mondayStr = monday.toISOString().split("T")[0];
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const sundayStr = sunday.toISOString().split("T")[0];

  const [projectsRes, todayEntriesRes, assignmentsRes, weekEntriesRes] =
    await Promise.all([
      supabase.from("projects").select("id, name").not("status", "eq", "Abgeschlossen").order("name"),
      supabase.from("time_entries")
        .select("id, stunden, taetigkeit, project_id, projects(name), created_at")
        .eq("user_id", userId).eq("datum", today)
        .order("created_at", { ascending: false }),
      // Plantafel-Einteilung heute aus einsaetze (nicht mehr worker_assignments)
      supabase.from("einsaetze")
        .select("project_id, projects(name), start_time, end_time, ganztaegig, adresse, beschreibung")
        .eq("user_id", userId)
        .lte("start_date", today)
        .gte("end_date", today)
        .order("start_time"),
      // Entire week for the weekly brain
      supabase.from("time_entries")
        .select("datum, stunden, taetigkeit, projects(name)")
        .eq("user_id", userId)
        .gte("datum", mondayStr)
        .lte("datum", sundayStr)
        .order("datum", { ascending: true }),
    ]);

  const projects = projectsRes.data || [];
  const todayEntries = todayEntriesRes.data || [];
  const assignments = (assignmentsRes.data || []) as any[];
  const weekEntries = (weekEntriesRes.data || []) as any[];

  // ── Today ──
  const todayHours = todayEntries.reduce(
    (sum: number, e: any) => sum + (e.stunden || 0), 0
  );
  const dailyTarget = getRegelarbeitszeit();
  const remainingHours = Math.max(0, dailyTarget - todayHours);

  // ── Week analysis ──
  const weekHoursByDay: Record<string, number> = {};
  const weekDetailsByDay: Record<string, string[]> = {};
  weekEntries.forEach((e: any) => {
    weekHoursByDay[e.datum] = (weekHoursByDay[e.datum] || 0) + e.stunden;
    if (!weekDetailsByDay[e.datum]) weekDetailsByDay[e.datum] = [];
    weekDetailsByDay[e.datum].push(`${e.stunden}h ${e.projects?.name || "?"}`);
  });

  const weekTotal = Object.values(weekHoursByDay).reduce((a, b) => a + b, 0);
  const weekTarget = 39; // Mo-Fr Soll

  // Find missing days (work days with no or too few hours)
  const missingDays: string[] = [];
  for (let i = 0; i < 5; i++) { // Mo-Fr
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    const dStr = d.toISOString().split("T")[0];
    if (dStr > today) break; // Don't check future days
    const dayTarget = getRegelarbeitszeitForDate(d);
    const dayBooked = weekHoursByDay[dStr] || 0;
    if (dayBooked < dayTarget - 0.5) {
      const dayLabel = dayNames[d.getDay()];
      const missing = dayTarget - dayBooked;
      missingDays.push(`${dayLabel} (${dStr}): ${dayBooked}/${dayTarget}h – fehlen ${missing}h`);
    }
  }

  // ── Build context string ──
  let ctx = `═══ MITARBEITER-GEHIRN ═══\n`;
  ctx += `DATUM HEUTE: ${today} (${dayName})\n`;
  ctx += `REGELARBEITSZEIT HEUTE: ${dailyTarget}h (${dayName === "Freitag" ? "Freitag = kuerzerer Tag" : "Mo-Do"})\n`;
  ctx += `HEUTE GEBUCHT: ${todayHours}h\n`;
  ctx += `NOCH OFFEN HEUTE: ${remainingHours}h\n`;

  if (todayEntries.length > 0) {
    ctx += `\nHEUTIGE BUCHUNGEN:\n`;
    todayEntries.forEach((e: any) => {
      ctx += `  • ${e.stunden}h → ${e.projects?.name || "?"} – ${e.taetigkeit || "k.A."}\n`;
    });
  }

  if (assignments.length > 0) {
    ctx += `\nPLANTAFEL-EINTEILUNG HEUTE:\n`;
    assignments.forEach((a: any) => {
      const timeStr = a.ganztaegig
        ? " (ganztags)"
        : a.start_time && a.end_time
          ? ` (${(a.start_time || "").slice(0, 5)}–${(a.end_time || "").slice(0, 5)})`
          : "";
      const addrStr = a.adresse ? ` – 📍 ${a.adresse}` : "";
      const noteStr = a.beschreibung ? ` – ${a.beschreibung}` : "";
      ctx += `  • ${a.projects?.name || "?"}${timeStr}${addrStr}${noteStr}\n`;
    });
  }

  // ── Weekly overview ──
  ctx += `\n═══ WOCHENUEBERBLICK (KW ${getISOWeek(now)}) ═══\n`;
  ctx += `WOCHENSOLL: ${weekTarget}h | GEBUCHT: ${weekTotal}h | DIFFERENZ: ${(weekTotal - weekTarget).toFixed(1)}h\n`;

  // Day-by-day breakdown
  ctx += `\nTAG-FUER-TAG:\n`;
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    const dStr = d.toISOString().split("T")[0];
    const dLabel = dayNames[d.getDay()].slice(0, 2);
    const dTarget = getRegelarbeitszeitForDate(d);
    const dBooked = weekHoursByDay[dStr] || 0;
    const isToday = dStr === today;
    const isFuture = dStr > today;
    const status = isFuture ? "⏳" : dBooked >= dTarget - 0.5 ? "✅" : "❌";
    const details = weekDetailsByDay[dStr]?.join(", ") || (isFuture ? "–" : "KEINE BUCHUNG");
    ctx += `  ${status} ${dLabel} ${dStr}: ${dBooked}/${dTarget}h ${isToday ? "(HEUTE)" : ""} → ${details}\n`;
  }

  if (missingDays.length > 0) {
    ctx += `\n⚠️ FEHLENDE STUNDEN:\n`;
    missingDays.forEach((d) => { ctx += `  • ${d}\n`; });
    ctx += `→ Wenn der Mitarbeiter heute Stunden bucht, frag ob er auch die fehlenden Tage nachtragen will!\n`;
  }

  ctx += `\nAKTIVE PROJEKTE (nummeriert):\n`;
  projects.forEach((p: any, i: number) => {
    ctx += `  ${i + 1}. ${p.name}  [ID: ${p.id}]\n`;
  });

  return { context: ctx, projects, todayHours, remainingHours, dailyTarget, todayEntries, weekTotal, missingDays };
}

function getISOWeek(d: Date): number {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

// ─── OpenAI Tool definitions ─────────────────────────────

const tools = [
  {
    type: "function" as const,
    function: {
      name: "stunden_buchen",
      description:
        "Bucht Arbeitsstunden. arbeitsort = 'baustelle' (auf Projekt), 'werkstatt' (Firma/Büro — KEIN Projekt nötig), oder 'regie' (Regiearbeit — ohne Projekt). Bei arbeitsort='baustelle' ist project_id ODER project_name Pflicht.",
      parameters: {
        type: "object",
        properties: {
          arbeitsort: {
            type: "string",
            enum: ["baustelle", "werkstatt", "regie"],
            description: "baustelle = auf Projekt, werkstatt = Firma/Büro/Werkstatt (ohne Projekt), regie = Regiearbeit (ohne Projekt). Standard: baustelle wenn Projekt angegeben, sonst fragen.",
          },
          project_id: { type: "string", description: "UUID des Projekts (nur bei arbeitsort=baustelle)" },
          project_name: { type: "string", description: "Projektname/Teilname zum Suchen (nur bei arbeitsort=baustelle)" },
          stunden: { type: "number", description: "Stundenanzahl (wird bei start_time+end_time automatisch berechnet)" },
          taetigkeit: { type: "string", description: "Beschreibung der Tätigkeit (z.B. Montage, Kabel verlegen, Aufräumen)" },
          datum: { type: "string", description: "Datum YYYY-MM-DD, Standard = heute" },
          start_time: { type: "string", description: "Startzeit HH:MM (optional, für genaue Zeiterfassung)" },
          end_time: { type: "string", description: "Endzeit HH:MM (optional)" },
          pause_minuten: { type: "number", description: "Pausenzeit in Minuten (optional, Standard 0 oder 30 bei ganztägig Mo-Do)" },
          wetterschicht_stunden: {
            type: "number",
            description: "Optional: Regenstunden dieser Schicht (nur informativ, hat keinen Einfluss auf die gebuchten Arbeitsstunden). Nur bei arbeitsort=baustelle sinnvoll. Beispiele: 'davon 2h Regen', '3 Stunden Wetterschicht'.",
          },
        },
        required: ["taetigkeit", "datum"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "foto_hochladen",
      description: "Laedt ein empfangenes Foto auf ein Projekt hoch. Kann project_id ODER project_name verwenden.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "UUID des Projekts (bevorzugt)" },
          project_name: { type: "string", description: "Projektname oder Teilname (Alternative)" },
          beschreibung: { type: "string", description: "Beschreibung des Fotos" },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "letzte_buchung_loeschen",
      description: "Loescht die letzte Stundenbuchung des heutigen Tages.",
      parameters: {
        type: "object",
        properties: {
          grund: { type: "string", description: "Warum wird geloescht" },
        },
        required: ["grund"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "projekte_anzeigen",
      description: "Zeigt die nummerierte Liste aller aktiven Projekte.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "buchung_bearbeiten",
      description:
        "Bearbeitet eine bestehende Stundenbuchung des Mitarbeiters. Datum optional (Standard: heute). Identifiziert die Buchung über Position (n-te Buchung des Tages) oder projekt-Match. Nur die übergebenen Felder werden geändert.",
      parameters: {
        type: "object",
        properties: {
          datum: { type: "string", description: "Datum YYYY-MM-DD, Standard = heute" },
          position: { type: "number", description: "1-basierte Position der Buchung an diesem Tag (1 = erste/älteste)" },
          project_match: { type: "string", description: "Teil des Projektnamens, um die zu bearbeitende Buchung zu finden (Alternative zu position)" },
          stunden: { type: "number", description: "Neue Stundenzahl (optional)" },
          taetigkeit: { type: "string", description: "Neue Tätigkeit (optional)" },
          start_time: { type: "string", description: "Neue Startzeit HH:MM (optional)" },
          end_time: { type: "string", description: "Neue Endzeit HH:MM (optional)" },
          neues_projekt_name: { type: "string", description: "Falls Projekt geändert werden soll: Name oder Teil" },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "einteilung_anzeigen",
      description:
        "Zeigt, wo/wie der Mitarbeiter laut Plantafel eingeteilt ist. Ohne Parameter: heute. Mit datum/woche: spezifisches Datum oder aktuelle/kommende Woche.",
      parameters: {
        type: "object",
        properties: {
          datum: { type: "string", description: "Datum YYYY-MM-DD (optional, Standard: heute)" },
          woche: { type: "string", description: "'diese_woche' oder 'naechste_woche' (Alternative zu datum)" },
        },
        required: [],
      },
    },
  },
];

// ─── Tool execution ──────────────────────────────────────

async function executeTool(
  name: string,
  input: any,
  userId: string,
  senderName: string,
  mediaRef?: string,
  cachedImageBuffer?: ArrayBuffer | null
): Promise<string> {
  const today = new Date().toISOString().split("T")[0];

  // arbeitsort normalisieren: Aliase erlauben
  if (input.arbeitsort) {
    const a = String(input.arbeitsort).toLowerCase().trim();
    if (["firma", "werkstatt", "büro", "buero", "office"].includes(a)) input.arbeitsort = "werkstatt";
    else if (["regie", "regiearbeit", "stoerung", "störung"].includes(a)) input.arbeitsort = "regie";
    else if (["baustelle", "projekt"].includes(a)) input.arbeitsort = "baustelle";
  }

  // Resolve project_name to project_id if needed (nur relevant bei baustelle)
  if ((input.arbeitsort === undefined || input.arbeitsort === "baustelle")
      && !input.project_id && input.project_name) {
    const searchTerm = input.project_name.trim();
    const { data: matches } = await supabase
      .from("projects")
      .select("id, name")
      .not("status", "eq", "Abgeschlossen")
      .ilike("name", `%${searchTerm}%`)
      .limit(5);

    if (!matches || matches.length === 0) {
      // Try even fuzzier: split search term and match any word
      const words = searchTerm.split(/\s+/).filter((w: string) => w.length > 2);
      let fuzzyMatch = null;
      if (words.length > 0) {
        const { data: allProjects } = await supabase
          .from("projects").select("id, name").not("status", "eq", "Abgeschlossen");
        fuzzyMatch = (allProjects || []).find((p: any) =>
          words.some((w: string) => p.name.toLowerCase().includes(w.toLowerCase()))
        );
      }
      if (fuzzyMatch) {
        input.project_id = fuzzyMatch.id;
      } else {
        const { data: allP } = await supabase.from("projects").select("name").not("status", "eq", "Abgeschlossen");
        const list = (allP || []).map((p: any, i: number) => `${i + 1}. ${p.name}`).join("\n");
        return `FEHLER: Kein Projekt "${searchTerm}" gefunden. Aktive Projekte:\n${list}`;
      }
    } else if (matches.length === 1) {
      input.project_id = matches[0].id;
    } else {
      // Multiple matches - pick the best one (shortest name that contains the search)
      const best = matches.sort((a: any, b: any) => a.name.length - b.name.length)[0];
      input.project_id = best.id;
    }
  }

  switch (name) {
    case "stunden_buchen": {
      const datum = input.datum || today;
      const arbeitsort = input.arbeitsort || (input.project_id ? "baustelle" : undefined);

      if (!arbeitsort) {
        return "FEHLER: Bitte angeben ob Baustelle (mit Projekt), Firma/Werkstatt oder Regiearbeit.";
      }
      if (arbeitsort === "baustelle" && !input.project_id) {
        return "FEHLER: Für Baustelle ist ein Projekt nötig. Schreibe z.B. 'Projektname 8h' oder nutze Arbeitsort Firma.";
      }

      // Stunden: aus start/end ableiten, falls nicht direkt angegeben
      const parseHHMM = (s: string) => {
        const [h, m] = s.split(":").map((x: string) => parseInt(x, 10));
        return (h || 0) * 60 + (m || 0);
      };
      const pauseMin = typeof input.pause_minuten === "number" ? input.pause_minuten : undefined;
      let h = input.stunden as number | undefined;

      if ((!h || h <= 0) && input.start_time && input.end_time) {
        const diff = parseHHMM(input.end_time) - parseHHMM(input.start_time);
        if (diff > 0) {
          // Default-Pause übernehmen: 30min bei >6h Block, sonst 0 — analog Web-App
          const p = pauseMin != null ? pauseMin : (diff > 6 * 60 ? 30 : 0);
          h = Math.max(0, (diff - p) / 60);
          h = Math.round(h * 4) / 4; // auf 0.25 runden
        }
      }

      if (!h || h <= 0 || h > 24)
        return "FEHLER: Stunden muessen zwischen 0.25 und 24 liegen. Gib Stunden oder Start- und Endzeit an.";

      // Check total hours for this day
      const { data: existingEntries } = await supabase
        .from("time_entries")
        .select("stunden")
        .eq("user_id", userId)
        .eq("datum", datum);

      const alreadyBooked = (existingEntries || []).reduce(
        (sum: number, e: any) => sum + (e.stunden || 0), 0
      );
      const totalAfter = alreadyBooked + h;

      const bookingDate = new Date(datum + "T12:00:00");
      const dailyTarget = getRegelarbeitszeit(bookingDate);

      if (totalAfter > dailyTarget + 2) {
        return `FEHLER: Bereits ${alreadyBooked}h gebucht fuer ${datum}. Mit ${h}h waeren es ${totalAfter}h – das ueberschreitet die Regelarbeitszeit (${dailyTarget}h) deutlich. Bitte pruefe die Stunden.`;
      }

      const startTime = input.start_time || "07:00";
      let endTime = input.end_time;
      if (!endTime) {
        const startMins = parseHHMM(startTime);
        const totalMins = startMins + h * 60 + (h > 6 ? 30 : 0);
        endTime = `${String(Math.floor(totalMins / 60)).padStart(2, "0")}:${String(Math.round(totalMins % 60)).padStart(2, "0")}`;
      }

      // DB-location_type: Web-App speichert "regie" als "baustelle" mit null project_id
      const dbLocationType = arbeitsort === "werkstatt" ? "werkstatt" : "baustelle";
      const projectIdForInsert = arbeitsort === "baustelle" ? input.project_id : null;
      const notizen = arbeitsort === "regie" ? "Regiearbeit" : null;

      // Wetterschicht: nur informativ, nur bei Baustelle, 0–24h
      let wetterschicht: number | null = null;
      if (arbeitsort === "baustelle" && typeof input.wetterschicht_stunden === "number") {
        const w = Number(input.wetterschicht_stunden);
        if (w > 0 && w <= 24) wetterschicht = Math.round(w * 4) / 4;
      }

      const { error } = await supabase.from("time_entries").insert({
        user_id: userId,
        datum,
        stunden: h,
        taetigkeit: input.taetigkeit,
        project_id: projectIdForInsert,
        location_type: dbLocationType,
        start_time: startTime,
        end_time: endTime,
        pause_minutes: pauseMin != null ? pauseMin : (h > 6 ? 30 : 0),
        notizen,
        wetterschicht_stunden: wetterschicht,
      });

      if (error) return `FEHLER: ${error.message}`;

      let ortLabel = "";
      if (arbeitsort === "baustelle") {
        const { data: proj } = await supabase
          .from("projects").select("name").eq("id", projectIdForInsert).maybeSingle();
        ortLabel = `"${proj?.name || "Projekt"}"`;
      } else if (arbeitsort === "werkstatt") {
        ortLabel = "Firma/Werkstatt";
      } else {
        ortLabel = "Regiearbeit";
      }

      const remaining = dailyTarget - totalAfter;
      let result = `ERFOLG: ${h}h auf ${ortLabel} am ${datum} gebucht. Taetigkeit: ${input.taetigkeit}. Tagesgesamt: ${totalAfter}h von ${dailyTarget}h.`;
      if (wetterschicht && wetterschicht > 0) {
        result += ` ☔ Wetterschicht: ${wetterschicht}h vermerkt.`;
      }
      if (remaining > 0.25) {
        result += ` HINWEIS: Noch ${remaining}h offen fuer heute (Soll: ${dailyTarget}h).`;
      } else if (remaining >= 0) {
        result += ` Tagessoll erreicht ✓`;
      }
      return result;
    }

    case "foto_hochladen": {
      if (!input.project_id) return "FEHLER: Kein Projekt angegeben. Bitte Projektname nennen.";
      try {
        // ALLE pending Fotos des Users einholen (max 30min alt, nicht verarbeitet)
        // + das ggf. aktuell im Call empfangene (cachedImageBuffer).
        const expiryIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const { data: pendings } = await supabase
          .from("whatsapp_messages")
          .select("id, message_body, photo_hash, created_at")
          .eq("user_id", userId)
          .eq("message_type", "pending_photo")
          .eq("processed", false)
          .gte("created_at", expiryIso)
          .order("created_at", { ascending: true });

        type Job = { buffer: ArrayBuffer; hash: string; pendingRowId?: string };
        const jobs: Job[] = [];

        // Aktuell im Webhook mitgegebenes Foto (Caption-Fall)
        if (cachedImageBuffer) {
          const hash = await sha256Hex(cachedImageBuffer);
          // Kein Duplikat in jobs → direkt anfügen
          jobs.push({ buffer: cachedImageBuffer, hash });
        }

        // Pending-Fotos aus temp-storage nachladen (deduped via hash)
        for (const p of (pendings || []) as any[]) {
          if (jobs.some((j) => j.hash === p.photo_hash)) continue;
          try {
            const res = await fetch(p.message_body);
            if (!res.ok) continue;
            const buf = await res.arrayBuffer();
            const hash = p.photo_hash || (await sha256Hex(buf));
            if (jobs.some((j) => j.hash === hash)) continue;
            jobs.push({ buffer: buf, hash, pendingRowId: p.id });
          } catch (e) {
            console.error("pending photo load failed:", e);
          }
        }

        if (jobs.length === 0) return "FEHLER: Kein Foto vorhanden.";

        // Schon im Projekt vorhandene Hashes nachschlagen → Duplikat-Skip
        const hashList = jobs.map((j) => j.hash);
        const { data: existingDocs } = await supabase
          .from("documents")
          .select("file_hash")
          .eq("project_id", input.project_id)
          .in("file_hash", hashList);
        const alreadyUploadedHashes = new Set(
          ((existingDocs as any[]) || []).map((d: any) => d.file_hash).filter(Boolean)
        );

        let uploaded = 0;
        let skippedDuplicate = 0;
        let failed = 0;

        for (let i = 0; i < jobs.length; i++) {
          const job = jobs[i];
          if (alreadyUploadedHashes.has(job.hash)) {
            skippedDuplicate++;
            if (job.pendingRowId) {
              await supabase.from("whatsapp_messages").delete().eq("id", job.pendingRowId);
            }
            continue;
          }
          try {
            const ts = Date.now();
            const fileName = `${input.project_id}/whatsapp_${ts}_${i}_${job.hash.slice(0, 8)}.jpg`;
            const { error: upErr } = await supabase.storage
              .from("project-photos")
              .upload(fileName, job.buffer, { contentType: "image/jpeg", upsert: false });
            if (upErr) throw upErr;

            const { data: urlData } = supabase.storage
              .from("project-photos").getPublicUrl(fileName);

            await supabase.from("documents").insert({
              name: `WhatsApp Foto – ${senderName} – ${new Date().toLocaleDateString("de-AT")}`,
              file_url: urlData.publicUrl,
              typ: "foto",
              beschreibung: input.beschreibung || `WhatsApp-Upload von ${senderName}`,
              project_id: input.project_id,
              user_id: userId,
              file_hash: job.hash,
            });
            uploaded++;
            alreadyUploadedHashes.add(job.hash);
            if (job.pendingRowId) {
              await supabase.from("whatsapp_messages").delete().eq("id", job.pendingRowId);
            }
          } catch (e: any) {
            console.error("Photo upload failed:", e);
            failed++;
          }
        }

        const { data: proj } = await supabase
          .from("projects").select("name").eq("id", input.project_id).maybeSingle();

        const parts: string[] = [];
        if (uploaded > 0) parts.push(`${uploaded} ${uploaded === 1 ? "Foto" : "Fotos"} hochgeladen`);
        if (skippedDuplicate > 0) parts.push(`${skippedDuplicate} war${skippedDuplicate === 1 ? "" : "en"} schon im Projekt (übersprungen)`);
        if (failed > 0) parts.push(`${failed} fehlgeschlagen`);
        const summary = parts.length ? parts.join(", ") : "Nichts zu tun";
        return `ERFOLG: ${summary} auf Projekt "${proj?.name}".`;
      } catch (e: any) {
        console.error("Photo upload error:", e);
        return `FEHLER: ${e.message}`;
      }
    }

    case "letzte_buchung_loeschen": {
      const { data: last } = await supabase
        .from("time_entries")
        .select("id, stunden, taetigkeit, projects(name)")
        .eq("user_id", userId).eq("datum", today)
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();

      if (!last) return "FEHLER: Heute keine Buchungen vorhanden.";

      const { error } = await supabase.from("time_entries").delete().eq("id", last.id);
      if (error) return `FEHLER: ${error.message}`;

      return `ERFOLG: Buchung geloescht (${last.stunden}h auf ${(last as any).projects?.name}: ${last.taetigkeit}).`;
    }

    case "projekte_anzeigen": {
      const { data: projects } = await supabase
        .from("projects").select("id, name").not("status", "eq", "Abgeschlossen").order("name");

      if (!projects?.length) return "Keine aktiven Projekte.";
      return "AKTIVE PROJEKTE:\n" + projects.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
    }

    case "buchung_bearbeiten": {
      const datum: string = args.datum || new Date().toISOString().slice(0, 10);
      const { data: entries } = await supabase
        .from("time_entries")
        .select("id, stunden, taetigkeit, start_time, end_time, project_id, projects(name)")
        .eq("user_id", userId)
        .eq("datum", datum)
        .order("created_at");
      if (!entries || entries.length === 0) {
        return `ERROR: Keine Buchung am ${datum} gefunden.`;
      }
      let target: any = null;
      if (args.position && entries[args.position - 1]) {
        target = entries[args.position - 1];
      } else if (args.project_match) {
        const needle = String(args.project_match).toLowerCase();
        target = entries.find((e: any) => (e.projects?.name || "").toLowerCase().includes(needle));
      } else if (entries.length === 1) {
        target = entries[0];
      }
      if (!target) {
        const list = entries.map((e: any, i: number) => `${i + 1}. ${e.stunden}h ${(e.projects as any)?.name || "?"}: ${e.taetigkeit}`).join("\n");
        return `ERROR: Konnte Buchung nicht eindeutig identifizieren. Bitte Position (1-${entries.length}) angeben:\n${list}`;
      }
      // Neues Projekt auflösen (falls gegeben)
      const update: any = {};
      if (args.stunden != null) update.stunden = args.stunden;
      if (args.taetigkeit) update.taetigkeit = args.taetigkeit;
      if (args.start_time) update.start_time = args.start_time;
      if (args.end_time) update.end_time = args.end_time;
      if (args.neues_projekt_name) {
        const { data: projs } = await supabase
          .from("projects").select("id, name").not("status", "eq", "Abgeschlossen");
        const needle = String(args.neues_projekt_name).toLowerCase();
        const match = (projs || []).find((p: any) => p.name.toLowerCase().includes(needle));
        if (!match) return `ERROR: Projekt "${args.neues_projekt_name}" nicht gefunden.`;
        update.project_id = match.id;
      }
      if (Object.keys(update).length === 0) return "ERROR: Keine Änderungen angegeben.";

      const { error } = await supabase.from("time_entries").update(update).eq("id", target.id);
      if (error) return `ERROR: ${error.message}`;
      return `ERFOLG: Buchung aktualisiert (${target.stunden}h → ${update.stunden ?? target.stunden}h).`;
    }

    case "einteilung_anzeigen": {
      const todayStr = new Date().toISOString().slice(0, 10);
      let fromDate = args.datum || todayStr;
      let toDate = args.datum || todayStr;
      if (args.woche === "diese_woche" || args.woche === "naechste_woche") {
        const ref = new Date();
        if (args.woche === "naechste_woche") ref.setDate(ref.getDate() + 7);
        const dow = (ref.getDay() + 6) % 7; // Montag = 0
        const monday = new Date(ref); monday.setDate(ref.getDate() - dow);
        const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
        fromDate = monday.toISOString().slice(0, 10);
        toDate = sunday.toISOString().slice(0, 10);
      }
      const { data: einsaetze } = await supabase
        .from("einsaetze")
        .select("name, adresse, start_date, end_date, ganztaegig, start_time, end_time, beschreibung, projects(name)")
        .eq("user_id", userId)
        .lte("start_date", toDate)
        .gte("end_date", fromDate)
        .order("start_date");
      if (!einsaetze || einsaetze.length === 0) {
        return args.datum ? `INFO: Keine Einteilung am ${fromDate}.` : "INFO: Keine Einteilung im angefragten Zeitraum.";
      }
      const lines = einsaetze.map((e: any) => {
        const projektName = e.projects?.name || e.name || "(ohne Projekt)";
        const datum = e.start_date === e.end_date ? e.start_date : `${e.start_date} - ${e.end_date}`;
        const zeit = e.ganztaegig ? "ganztags" : `${(e.start_time || "").slice(0,5)}-${(e.end_time || "").slice(0,5)}`;
        const ort = e.adresse ? ` (${e.adresse})` : "";
        return `• ${datum} ${zeit}: ${projektName}${ort}`;
      });
      return `EINTEILUNG:\n${lines.join("\n")}`;
    }

    default:
      return `FEHLER: Unbekanntes Tool ${name}`;
  }
}

// ─── OpenAI conversation ─────────────────────────────────

async function askGPT(
  systemPrompt: string,
  history: ConversationEntry[],
  userMessage: string,
  userId: string,
  senderName: string,
  mediaRef?: string,
  cachedImageBuffer?: ArrayBuffer | null
): Promise<string> {
  const messages: any[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  const callGPT = async (msgs: any[]) => {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "gpt-4o", messages: msgs, tools, max_tokens: 1024 }),
    });
    return res.json();
  };

  let result = await callGPT(messages);
  let rounds = 0;

  while (result.choices?.[0]?.finish_reason === "tool_calls" && rounds < 5) {
    rounds++;
    const msg = result.choices[0].message;
    messages.push(msg);

    for (const tc of msg.tool_calls || []) {
      const args = JSON.parse(tc.function.arguments);
      const output = await executeTool(tc.function.name, args, userId, senderName, mediaRef, cachedImageBuffer);
      messages.push({ role: "tool", tool_call_id: tc.id, content: output });
    }

    result = await callGPT(messages);
  }

  return result.choices?.[0]?.message?.content || "Entschuldigung, da ist etwas schiefgelaufen.";
}

// ─── System prompt ───────────────────────────────────────

function buildSystemPrompt(
  senderName: string,
  ctx: string,
  todayHours: number,
  remainingHours: number,
  dailyTarget: number,
  missingDays: string[]
): string {
  return `Du bist der *BKS Assistent* – der WhatsApp-Helfer von BKS BauKomplettService.
Sei freundlich, locker, hilfreich – aber kurz und knapp (WhatsApp!).
WhatsApp-Formatierung: *fett*, _kursiv_. Emojis sparsam.

MITARBEITER: ${senderName}

${ctx}

═══ DEIN VERHALTEN ("GEHIRN") ═══

Du hast oben den KOMPLETTEN Wochenueberblick dieses Mitarbeiters. Nutze dieses Wissen AKTIV:

1. Du WEISST immer genau wie viele Stunden heute und diese Woche gebucht sind.
2. NACH JEDER BUCHUNG: Zeig den aktuellen Stand ("${todayHours > 0 ? todayHours + "h" : "0h"} von ${dailyTarget}h heute").
3. Wenn noch Reststunden offen sind → zeige die nummerierte Projektliste und frag:
   "Noch Xh offen – auf welches Projekt? Antworte mit Nummer + Stunden."
4. ${missingDays.length > 0 ? `ACHTUNG: Es fehlen Stunden an frueheren Tagen! Sprich das PROAKTIV an und biete an, nachzutragen.` : "Alle bisherigen Tage der Woche sind komplett ✓"}
5. Wenn Mitarbeiter fragt "Wie sieht meine Woche aus?" → zeig den Wochenueberblick.
6. Wenn Tagessoll erreicht → kurz bestaetigen: "Heute komplett ✓ Schoenen Feierabend!"

═══ ARBEITSZEITEN ═══
Mo–Do: 8,5h (07:00–16:00, Pause 12:00–12:30) | Fr: 5,0h (07:00–12:00, keine Pause) | Wochensoll: 39h
Nicht mehr als Tagessoll buchen (Ueberstunden nur wenn ausdruecklich bestaetigt).

═══ STUNDENBUCHUNG (WICHTIGSTE FUNKTION) ═══

Du bist ein INTELLIGENTER Agent. Du verstehst natuerliche Sprache und ordnest Projekte automatisch zu.

ARBEITSORT — drei Möglichkeiten (arbeitsort-Parameter):
• *baustelle* → klassisch auf einem Projekt (project_id oder project_name Pflicht)
• *werkstatt* (auch "Firma", "Büro") → Arbeit in der Firma/Werkstatt, KEIN Projekt nötig
• *regie* ("Regiearbeit") → Regiearbeit ohne Projektzuordnung

Beispiele für Firma/Werkstatt:
- "Heute 8h in der Firma, Material sortiert" → arbeitsort=werkstatt, 8h, "Material sortiert"
- "Werkstatt 4h Aufräumen" → arbeitsort=werkstatt, 4h, "Aufräumen"
- "7-16 Firma Lager" → arbeitsort=werkstatt, start=07:00, end=16:00

Beispiele für Regie:
- "Regiearbeit 3h Störung Müller" → arbeitsort=regie, 3h
- "2h Regie Kundenanruf" → arbeitsort=regie, 2h

ZEITERFASSUNG:
- Wenn Start/End gegeben ("7 bis 16", "von 8-17") → start_time + end_time, Stunden werden automatisch berechnet (Pause standardmäßig 30min bei >6h Block)
- Wenn nur Stunden genannt ("8h") → stunden direkt, Zeiten werden angenommen
- Pause explizit: "30min Pause" → pause_minuten: 30

WETTERSCHICHT (nur bei Baustelle):
- Wenn der Mitarbeiter Regenstunden erwähnt ("2h Wetterschicht", "davon 3h Regen", "war 4h Regen heute") → wetterschicht_stunden setzen
- Nur informativ — zieht NICHTS von den Arbeitsstunden ab. Der Mitarbeiter bucht normal seine 8h und kann zusätzlich melden, wieviel davon im Regen war.
- Beispiel: "8h Müller, davon 3h Wetterschicht" → stunden=8, wetterschicht_stunden=3

PROJEKTERKENNUNG (nur bei arbeitsort=baustelle) – so gehst du vor:
- "4h auf Müller" → matche "Müller" gegen die Projektliste → "Bauvorhaben Müller" → DIREKT buchen
- "8h Sonnenhof Kabel verlegt" → "Wohnanlage Sonnenhof" → buchen
- "6 Stunden Industriehalle" → "Industriehalle Graz-Süd" → buchen
- "Heute war ich auf der Steiner-Baustelle, 8h" → "Bauvorhaben Steiner" → buchen
- "Gestern 4h auf der Halle in Graz" → "Industriehalle Graz-Süd", gestern → buchen
- Auch Teilnamen, Spitznamen, Abkuerzungen erkennen!
- Bei Sprachnachrichten: Transkriptionsfehler intelligent interpretieren

WENN Projekt EINDEUTIG erkennbar → SOFORT buchen, NICHT erst nachfragen!
WENN Projekt NICHT zuordenbar (z.B. "auf der Baustelle") → Projektliste zeigen
WENN Nummer als Antwort (z.B. "3") → Projekt Nr. 3 aus der Liste im Kontext

ABLAUF:
1. Stunden + Projekt erkannt → buchen → Bestaetigung + Reststand
2. Nur Stunden → Plantafel pruefen, sonst Projektliste zeigen
3. Nur "Stunden schreiben" → Projektliste + Tagessoll
4. Taetigkeit fehlt → sinnvollen Standardwert nehmen (z.B. "Allgemeine Arbeiten") oder kurz fragen
5. Vergangene Tage: "gestern 8h Werkstatt" → korrektes Datum berechnen und buchen

═══ FOTOS ═══
WICHTIG: Mehrere Fotos werden als Batch behandelt — beim foto_hochladen werden
AUTOMATISCH ALLE aktuell wartenden Fotos des Mitarbeiters hochgeladen (nicht nur eines).
Du musst foto_hochladen also nur EINMAL aufrufen, egal wie viele Fotos offen sind.

- Foto(s) mit Beschreibung → Projektname erkennen → foto_hochladen
- "Foto fuer Müller" / "ans Müller" / "für Hinterleitenweg" → Projekt erkennen → foto_hochladen
- Antwort nur mit Nummer ("1") → Projekt aus der letzten Liste im Kontext wählen → foto_hochladen
- Antwort nur mit Projektname → foto_hochladen mit project_name
- Der Upload-Mechanismus erkennt automatisch Duplikate (gleicher Bildinhalt) und überspringt sie still.
- Melde dem Mitarbeiter KURZ wie viele Fotos hochgeladen / übersprungen wurden (der Tool-Return-Wert nennt die Zahl).

═══ SPRACHNACHRICHTEN ═══
Werden transkribiert. Transkriptionsfehler intelligent interpretieren (z.B. "Mühler" = "Müller").

═══ KORREKTUREN ═══
"Das war falsch" / "Loesch das" → letzte_buchung_loeschen
"Aender die Buchung auf 7h" / "Die war nur 5h" → buchung_bearbeiten
  - Wenn mehrere Buchungen am Tag: position oder project_match nutzen
  - Nur die zu ändernden Felder übergeben

═══ EINTEILUNG ═══
"Wo muss ich hin?" / "Wo bin ich heute?" / "Einteilung?" → einteilung_anzeigen (ohne Args = heute)
"Wo bin ich diese Woche?" / "Meine Woche" → einteilung_anzeigen(woche: "diese_woche")
"Was steht nächste Woche an?" → einteilung_anzeigen(woche: "naechste_woche")
"Wo muss ich am 22.04.?" → einteilung_anzeigen(datum: "2026-04-22")

═══ REGELN ═══
- IMMER Deutsch, kurz, knapp
- Sei PROAKTIV: nicht unnoetig nachfragen wenn du zuordnen kannst
- Niemals UUIDs oder technische Details zeigen
- Nach jeder Buchung: Reststand + Projektliste wenn noch offen
- Du bist ein smarter Assistent, kein dummes Menue-System`;
}

// ─── Parse WAPI webhook ──────────────────────────────────

interface ParsedMsg {
  from: string;
  body?: string;
  type: string;
  mediaUrl?: string;
  audioUrl?: string;
  caption?: string;
  messageId?: string;
}

function parseWapiPayload(payload: any): ParsedMsg[] {
  const msgs: ParsedMsg[] = [];
  const messageList = payload.messages || [];

  // Deduplicate: WAPI often sends the same message twice
  const seenIds = new Set<string>();

  for (const m of messageList) {
    const from = (m.from || m.chat_id || "").replace("@s.whatsapp.net", "");
    if (!from || m.from_me) continue;

    // Skip duplicates
    if (m.id && seenIds.has(m.id)) continue;
    if (m.id) seenIds.add(m.id);

    const parsed: ParsedMsg = { from, type: m.type || "text", messageId: m.id };

    if (m.type === "text" || (!m.type && m.text)) {
      parsed.body = m.text?.body || m.body || m.text;
    } else if (m.type === "image") {
      // WAPI image structure: m.image.link is the direct download URL
      parsed.mediaUrl = m.image?.link || m.image?.url || m.image?.id
        || m.media?.link || m.media?.url;
      parsed.caption = m.image?.caption || m.caption;
      console.log("IMAGE:", JSON.stringify(m.image || {}).slice(0, 500));
    } else if (m.type === "document") {
      parsed.mediaUrl = m.document?.link || m.document?.url || m.document?.id;
      parsed.caption = m.document?.filename || m.document?.caption;
    } else if (m.type === "voice" || m.type === "audio" || m.type === "ptt") {
      parsed.audioUrl = m.audio?.link || m.audio?.url || m.audio?.id
        || m.voice?.link || m.voice?.url || m.voice?.id
        || m.ptt?.link || m.ptt?.url || m.ptt?.id;
    } else if (m.type === "video") {
      parsed.mediaUrl = m.video?.link || m.video?.url;
      parsed.caption = m.video?.caption;
    }

    if (!parsed.body && !parsed.mediaUrl && !parsed.audioUrl && m.body) {
      parsed.body = m.body;
    }

    msgs.push(parsed);
  }

  return msgs;
}

// ─── Main handler ────────────────────────────────────────

// HMAC-SHA256 Signatur-Verifikation (Meta WhatsApp Standard)
async function verifyWhatsAppSignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader) return false;
  const secret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!secret) return false; // Falls nicht gesetzt → Signatur nicht verifiziert

  const expectedPrefix = "sha256=";
  if (!signatureHeader.startsWith(expectedPrefix)) return false;
  const providedHex = signatureHeader.slice(expectedPrefix.length);

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
    const sigHex = Array.from(new Uint8Array(sigBuf))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
    // Constant-time compare
    if (sigHex.length !== providedHex.length) return false;
    let diff = 0;
    for (let i = 0; i < sigHex.length; i++) diff |= sigHex.charCodeAt(i) ^ providedHex.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method === "GET") {
    // Webhook-Verification (Meta Hub-Challenge)
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
    if (mode === "subscribe" && token && verifyToken && token === verifyToken && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("OK", { status: 200 });
  }

  try {
    // Raw body für Signatur-Verifikation lesen, dann parsen
    const rawBody = await req.text();
    const sigHeader = req.headers.get("X-Hub-Signature-256") || req.headers.get("x-hub-signature-256");

    // Nur verifizieren wenn Secret gesetzt ist (Migration zum sicheren Modus)
    if (Deno.env.get("WHATSAPP_APP_SECRET")) {
      const ok = await verifyWhatsAppSignature(rawBody, sigHeader);
      if (!ok) {
        console.warn("Webhook-Signatur-Verifikation fehlgeschlagen");
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    const payload = JSON.parse(rawBody);

    // Ignore status updates (delivered, read, etc.) - only process messages
    if (payload.statuses || payload.event === "statuses" || (!payload.messages && !payload.message)) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Payload-Log: Phone-Nummern anonymisieren (GDPR)
    const payloadStr = JSON.stringify(payload).slice(0, 1500);
    console.log("WEBHOOK:", payloadStr.replace(/"(from|phone|wa_id|to)":\s*"(\+?\d{4,})"/g, (_, k, v) => `"${k}":"${v.slice(0, 5)}****${v.slice(-3)}"`));
    const incoming = parseWapiPayload(payload);

    if (incoming.length === 0) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Phone-Maskierung für Logs (GDPR): +436701234567 → +4367****567
    const maskPhone = (p: string): string => {
      if (!p || p.length < 6) return "***";
      return p.slice(0, 5) + "****" + p.slice(-3);
    };

    // Tracker pro phone-Nummer: wie viele NEUE Fotos wurden in diesem Webhook-Call
    // ohne Caption hinzugefügt — für eine einmalige Batch-Antwort am Ende.
    const batchPhotoCount = new Map<string, number>();
    const batchEmp = new Map<string, any>();

    for (const msg of incoming) {
      const phone = msg.from;
      console.log(`WhatsApp von ${maskPhone(phone)} (id: ${msg.messageId})`);

      // Robustes Dedup: die eindeutige WAPI-Message-ID in der DB prüfen.
      // Dadurch werden z.B. gleichartige Bilder im selben Batch nicht mehr
      // fälschlicherweise als Duplikate verworfen.
      if (msg.messageId) {
        const { data: existing } = await supabase
          .from("whatsapp_messages")
          .select("id")
          .eq("wapi_message_id", msg.messageId)
          .limit(1);
        if (existing && existing.length > 0) {
          console.log(`Duplicate message skipped: ${msg.messageId}`);
          continue;
        }
      }

      const emp = await findEmployeeByPhone(phone);

      if (!emp || !emp.user_id) {
        console.log(`Unbekannte Nummer ${maskPhone(phone)}`);
        continue;
      }

      if (!emp.whatsapp_aktiv) {
        await sendWhatsApp(
          phone,
          `Hallo ${emp.vorname}! Dein WhatsApp-Zugang wurde noch nicht vom Admin freigeschaltet. Bitte wende dich an deinen Vorgesetzten.`
        );
        continue;
      }

      const name = `${emp.vorname} ${emp.nachname}`.trim();
      const userId = emp.user_id;

      // ── Build user message ──
      let userMessage = "";
      let cachedImageBuffer: ArrayBuffer | null = null;

      if (msg.audioUrl) {
        // Voice message → transcribe with Whisper
        try {
          const transcription = await transcribeAudio(msg.audioUrl);
          userMessage = `[Sprachnachricht] ${transcription}`;
        } catch (e: any) {
          console.error("Transcription failed:", e);
          await sendWhatsApp(phone,
            "Entschuldigung, ich konnte deine Sprachnachricht leider nicht verstehen. Kannst du es nochmal als Text schreiben? 🙏"
          );
          continue;
        }
      } else if (msg.type === "image" || msg.mediaUrl) {
        // Bild downloaden + als pending_photo speichern. Mehrere Fotos im Batch
        // werden ALLE gesammelt (keine delete-all-before-insert-Logik mehr).
        const mediaRef = msg.mediaUrl || msg.messageId;
        let photoHash = "";
        if (mediaRef) {
          try {
            cachedImageBuffer = await downloadMedia(mediaRef, msg.messageId);
            photoHash = await sha256Hex(cachedImageBuffer);
            console.log(`Image downloaded: ${cachedImageBuffer.byteLength} bytes, hash=${photoHash.slice(0, 12)}`);

            // Temp-Storage: Dateiname mit Hash-Prefix, damit identischer Inhalt
            // in 5 Sekunden nicht zweimal abgelegt wird.
            const tempPath = `whatsapp-temp/${phone}/${photoHash.slice(0, 16)}.jpg`;
            await supabase.storage
              .from("project-photos")
              .upload(tempPath, cachedImageBuffer, { contentType: "image/jpeg", upsert: true });
            const { data: urlData } = supabase.storage
              .from("project-photos")
              .getPublicUrl(tempPath);
            const tempUrl = urlData.publicUrl;

            // Abgelaufene pending (>30min alt) aufräumen — aber aktuelle behalten
            const expireBefore = new Date(Date.now() - 30 * 60 * 1000).toISOString();
            await supabase.from("whatsapp_messages").delete()
              .eq("phone", phone)
              .eq("message_type", "pending_photo")
              .lt("created_at", expireBefore);

            // Nur einfügen wenn kein pending mit gleichem Hash existiert (Dup-Schutz)
            const { data: dupe } = await supabase.from("whatsapp_messages")
              .select("id")
              .eq("user_id", userId)
              .eq("message_type", "pending_photo")
              .eq("processed", false)
              .eq("photo_hash", photoHash)
              .limit(1);
            if (!dupe || dupe.length === 0) {
              await supabase.from("whatsapp_messages").insert({
                phone, direction: "incoming",
                message_body: tempUrl,
                message_type: "pending_photo",
                employee_id: emp.id, user_id: userId, processed: false,
                wapi_message_id: msg.messageId || null,
                photo_hash: photoHash,
              });
            }
          } catch (e: any) {
            console.error("Image download failed:", e.message);
          }
        }

        if (msg.caption) {
          // Caption = Projekt/Anweisung → ganz normal als Text-Input verarbeiten
          userMessage = `[Foto gesendet] ${msg.caption}`;
        } else {
          // Keine Caption → merken für Batch-Antwort am Ende des Webhook-Calls.
          // Keine sofortige Reply pro Foto mehr → das war das Multi-Spam-Problem.
          await saveMsg(phone, "incoming", "[Foto empfangen]", emp.id, userId, msg.messageId);
          batchPhotoCount.set(phone, (batchPhotoCount.get(phone) || 0) + 1);
          batchEmp.set(phone, { emp, userId });
          continue;
        }
      } else {
        userMessage = msg.body || "";
      }

      if (!userMessage.trim()) continue;

      // Pending-Foto-Info: NUR als Info im Kontext, nicht als Text-Zuordnung.
      // Der GPT-Agent entscheidet dann selbst, ob er foto_hochladen aufruft
      // oder die Frage anders beantwortet. So werden Fragen wie "wo bin ich
      // heute" nicht mehr als Projekt-Zuordnung missverstanden.
      const expiryIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data: pendingPhotos } = await supabase
        .from("whatsapp_messages")
        .select("id")
        .eq("user_id", userId)
        .eq("message_type", "pending_photo")
        .eq("processed", false)
        .gte("created_at", expiryIso);
      const pendingCount = (pendingPhotos || []).length;

      await saveMsg(phone, "incoming", userMessage, emp.id, userId, msg.messageId);

      const [ctxData, history] = await Promise.all([
        gatherContext(userId),
        loadHistory(phone, 6),
      ]);

      // Pending-Fotos-Hinweis an den Context anhängen, damit GPT es sieht
      let contextWithPhotos = ctxData.context;
      if (pendingCount > 0) {
        contextWithPhotos += `\n\n═══ PENDING FOTOS ═══\n`;
        contextWithPhotos += `Der Mitarbeiter hat ${pendingCount} Foto${pendingCount === 1 ? "" : "s"} geschickt, die noch keinem Projekt zugeordnet sind.\n`;
        contextWithPhotos += `Wenn seine Antwort eine Projekt-Nummer, einen Projektnamen oder eindeutig auf Foto-Zuordnung hindeutet ("1", "Müller", "für das Müller-Projekt") → foto_hochladen aufrufen (alle ${pendingCount} Fotos werden automatisch zugewiesen).\n`;
        contextWithPhotos += `Wenn er eine andere Frage stellt (Einteilung, Stunden, Info) → normale Antwort geben, Fotos warten weiter.\n`;
      }

      const systemPrompt = buildSystemPrompt(
        name, contextWithPhotos, ctxData.todayHours, ctxData.remainingHours,
        ctxData.dailyTarget, ctxData.missingDays
      );

      const mediaRef = cachedImageBuffer ? "__cached__" : undefined;

      const reply = await askGPT(
        systemPrompt, history, userMessage, userId, name, mediaRef, cachedImageBuffer
      );

      await saveMsg(phone, "outgoing", reply, emp.id, userId);
      await sendWhatsApp(phone, reply);
    }

    // ── Batch-Antwort für caption-lose Fotos ──
    // Egal ob 1 oder 10 Fotos in diesem Webhook-Call: genau EINE smarte
    // Nachricht mit Projekt-Vorschlägen. Wenn aber in den letzten 60s schon
    // eine Projekt-Liste geschickt wurde (Spam-Schutz), keine erneute.
    for (const [phone, count] of batchPhotoCount.entries()) {
      const ctx = batchEmp.get(phone);
      if (!ctx) continue;
      const { emp, userId } = ctx;

      // Spam-Schutz: letzte outgoing-Nachricht <60s? → nicht erneut
      const sixtySecAgo = new Date(Date.now() - 60 * 1000).toISOString();
      const { data: recent } = await supabase
        .from("whatsapp_messages")
        .select("id, message_body, created_at")
        .eq("phone", phone)
        .eq("direction", "outgoing")
        .gte("created_at", sixtySecAgo)
        .order("created_at", { ascending: false })
        .limit(1);
      const lastWasPrompt = recent?.[0]?.message_body?.includes("📸") || false;
      if (lastWasPrompt) {
        console.log(`Skipping batch prompt (spam-protection) for ${phone.slice(0, 5)}`);
        continue;
      }

      // Anzahl aller aktuell noch zugeordneten pending Fotos (inkl. ggf. älteren)
      const expiryIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data: totalPending } = await supabase
        .from("whatsapp_messages")
        .select("id")
        .eq("user_id", userId)
        .eq("message_type", "pending_photo")
        .eq("processed", false)
        .gte("created_at", expiryIso);
      const totalCount = (totalPending || []).length;

      // Projekt-Liste: heute eingeteilte oben, danach Rest
      const todayStr = new Date().toISOString().slice(0, 10);
      const { data: einsaetze } = await supabase
        .from("einsaetze")
        .select("projects(id, name)")
        .eq("user_id", userId)
        .lte("start_date", todayStr)
        .gte("end_date", todayStr);
      const { data: projList } = await supabase
        .from("projects")
        .select("id, name")
        .not("status", "eq", "Abgeschlossen")
        .order("name");

      const heutigeIds = new Set(
        ((einsaetze as any[]) || []).map((e) => e.projects?.id).filter(Boolean)
      );
      const heutige = (projList || []).filter((p: any) => heutigeIds.has(p.id));
      const andere = (projList || []).filter((p: any) => !heutigeIds.has(p.id));

      const heading = totalCount > 1
        ? `📸 ${totalCount} Fotos erhalten!`
        : "📸 Foto erhalten!";

      let reply = `${heading}\n\n`;
      if (heutige.length > 0) {
        reply += "*Heute eingeteilt:*\n";
        heutige.forEach((p: any, i: number) => { reply += `${i + 1}. ${p.name}\n`; });
        if (andere.length > 0) {
          reply += "\n*Andere aktive Projekte:*\n";
          andere.slice(0, 10).forEach((p: any, i: number) => {
            reply += `${heutige.length + i + 1}. ${p.name}\n`;
          });
        }
      } else if (projList && projList.length > 0) {
        reply += "*Auf welches Projekt?*\n";
        projList.slice(0, 10).forEach((p: any, i: number) => {
          reply += `${i + 1}. ${p.name}\n`;
        });
      } else {
        reply += "Keine aktiven Projekte gefunden.";
      }
      reply += totalCount > 1
        ? "\n_Antworte mit Nummer oder Projektname — alle Fotos kommen ins gleiche Projekt._"
        : "\n_Antworte mit Nummer oder Projektname._";

      await sendWhatsApp(phone, reply);
      await saveMsg(phone, "outgoing", reply, emp.id, userId);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Webhook error:", err);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

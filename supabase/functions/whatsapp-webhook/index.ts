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

  // Schritt 1: alle employees mit matching Telefon + active + whatsapp_aktiv
  const { data: candidates } = await supabase
    .from("employees")
    .select("id, vorname, nachname, user_id, telefon, whatsapp_aktiv, aktiv")
    .eq("aktiv", true)
    .eq("whatsapp_aktiv", true)
    .ilike("telefon", `%${last8}%`);

  if (!candidates?.length) return null;

  // Schritt 2: Profile-Status separat nachschlagen (kein !inner, robuster)
  const userIds = candidates.map((c: any) => c.user_id).filter(Boolean);
  const activeProfileIds = new Set<string>();
  if (userIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, is_active")
      .in("id", userIds);
    (profs || []).forEach((p: any) => { if (p.is_active) activeProfileIds.add(p.id); });
  }

  const valid = candidates.filter((c: any) => c.user_id && activeProfileIds.has(c.user_id));
  if (!valid.length) return null;

  const cleanedMatch = `+${cleaned}`;
  return valid.find((c: any) => c.telefon === cleanedMatch) || valid[0];
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
  {
    type: "function" as const,
    function: {
      name: "krankmeldung_eintragen",
      description:
        "Trägt einen Krankenstand in die Zeiterfassung ein. Beispiele: 'bin heute krank', 'war gestern krank', 'krank von Montag bis Freitag'. Erstellt für jeden Werktag einen time_entry mit taetigkeit='Krankenstand' und dem jeweiligen Tagessoll als stunden (Mo-Do 8,5h, Fr 5h). Überspringt Wochenenden und österreichische Feiertage.",
      parameters: {
        type: "object",
        properties: {
          von_datum: { type: "string", description: "Start-Datum YYYY-MM-DD (Standard: heute)" },
          bis_datum: { type: "string", description: "Ende-Datum YYYY-MM-DD (Standard: wie von_datum)" },
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
        console.log(`[foto_hochladen] Start user=${userId} project=${input.project_id}`);
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

        console.log(`[foto_hochladen] pending rows found: ${(pendings || []).length}`);

        type Job = { buffer: ArrayBuffer; hash: string; pendingRowId?: string };
        const jobs: Job[] = [];

        // Aktuell im Webhook mitgegebenes Foto (Caption-Fall)
        if (cachedImageBuffer) {
          const hash = await sha256Hex(cachedImageBuffer);
          jobs.push({ buffer: cachedImageBuffer, hash });
        }

        // Pending-Fotos aus temp-storage nachladen (deduped via hash).
        // Primär via Storage-Download (umgeht Cache/CDN/Expiry-Probleme),
        // Fallback auf die Public-URL via fetch.
        let loadFailures = 0;
        for (const p of (pendings || []) as any[]) {
          if (jobs.some((j) => j.hash === p.photo_hash)) continue;
          let buf: ArrayBuffer | null = null;
          try {
            // Pfad aus der Public-URL extrahieren: .../project-photos/whatsapp-temp/...
            const m = /project-photos\/(whatsapp-temp\/[^?]+)/.exec(p.message_body || "");
            if (m) {
              const { data: blob, error: dlErr } = await supabase.storage
                .from("project-photos")
                .download(m[1]);
              if (!dlErr && blob) buf = await blob.arrayBuffer();
              else console.error(`[foto_hochladen] storage download failed: ${dlErr?.message}`);
            }
            // Fallback auf public HTTP-fetch
            if (!buf) {
              const res = await fetch(p.message_body);
              if (!res.ok) {
                console.error(`[foto_hochladen] temp fetch failed: HTTP ${res.status}`);
                loadFailures++;
                continue;
              }
              buf = await res.arrayBuffer();
            }
            const hash = p.photo_hash || (await sha256Hex(buf));
            if (jobs.some((j) => j.hash === hash)) continue;
            jobs.push({ buffer: buf, hash, pendingRowId: p.id });
          } catch (e: any) {
            console.error(`[foto_hochladen] pending photo load failed: ${e?.message}`);
            loadFailures++;
          }
        }

        console.log(`[foto_hochladen] jobs queued: ${jobs.length}, load failures: ${loadFailures}`);

        if (jobs.length === 0) {
          return loadFailures > 0
            ? `FEHLER: ${loadFailures} Foto${loadFailures === 1 ? "" : "s"} konnten nicht aus dem Zwischenspeicher geladen werden. Bitte noch einmal senden.`
            : "FEHLER: Kein Foto gefunden. Bitte Foto(s) noch einmal senden und dann das Projekt nennen.";
        }

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
            if (upErr) {
              console.error(`[foto_hochladen] storage upload failed: ${upErr.message}`);
              throw upErr;
            }

            const { data: urlData } = supabase.storage
              .from("project-photos").getPublicUrl(fileName);

            const { error: docErr } = await supabase.from("documents").insert({
              name: `WhatsApp Foto – ${senderName} – ${new Date().toLocaleDateString("de-AT")}`,
              file_url: urlData.publicUrl,
              typ: "foto",
              beschreibung: input.beschreibung || `WhatsApp-Upload von ${senderName}`,
              project_id: input.project_id,
              user_id: userId,
              file_hash: job.hash,
            });
            if (docErr) {
              console.error(`[foto_hochladen] document insert failed: ${docErr.message}`);
              throw docErr;
            }
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

        // Prompt-Lock freigeben — nächste Foto-Welle darf wieder einen
        // frischen Prompt auslösen.
        try {
          await supabase.from("photo_prompt_locks").delete().eq("user_id", userId);
        } catch (e) {
          console.error("Lock release failed:", e);
        }

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
      const datum: string = input.datum || new Date().toISOString().slice(0, 10);
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
      if (input.position && entries[input.position - 1]) {
        target = entries[input.position - 1];
      } else if (input.project_match) {
        const needle = String(input.project_match).toLowerCase();
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
      if (input.stunden != null) update.stunden = input.stunden;
      if (input.taetigkeit) update.taetigkeit = input.taetigkeit;
      if (input.start_time) update.start_time = input.start_time;
      if (input.end_time) update.end_time = input.end_time;
      if (input.neues_projekt_name) {
        const { data: projs } = await supabase
          .from("projects").select("id, name").not("status", "eq", "Abgeschlossen");
        const needle = String(input.neues_projekt_name).toLowerCase();
        const match = (projs || []).find((p: any) => p.name.toLowerCase().includes(needle));
        if (!match) return `ERROR: Projekt "${input.neues_projekt_name}" nicht gefunden.`;
        update.project_id = match.id;
      }
      if (Object.keys(update).length === 0) return "ERROR: Keine Änderungen angegeben.";

      const { error } = await supabase.from("time_entries").update(update).eq("id", target.id);
      if (error) return `ERROR: ${error.message}`;
      return `ERFOLG: Buchung aktualisiert (${target.stunden}h → ${update.stunden ?? target.stunden}h).`;
    }

    case "einteilung_anzeigen": {
      const todayStr = new Date().toISOString().slice(0, 10);
      let fromDate = input.datum || todayStr;
      let toDate = input.datum || todayStr;
      if (input.woche === "diese_woche" || input.woche === "naechste_woche") {
        const ref = new Date();
        if (input.woche === "naechste_woche") ref.setDate(ref.getDate() + 7);
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
        return input.datum ? `INFO: Keine Einteilung am ${fromDate}.` : "INFO: Keine Einteilung im angefragten Zeitraum.";
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

    case "krankmeldung_eintragen": {
      const vonDatum = input.von_datum || today;
      const bisDatum = input.bis_datum || vonDatum;

      const start = new Date(vonDatum + "T12:00:00");
      const end = new Date(bisDatum + "T12:00:00");
      if (end.getTime() < start.getTime()) {
        return "FEHLER: bis_datum liegt vor von_datum.";
      }

      // Österreichische Feiertage für den Zeitraum holen
      const { data: feiertage } = await supabase
        .from("austrian_holidays")
        .select("datum")
        .gte("datum", vonDatum)
        .lte("datum", bisDatum);
      const feiertagSet = new Set(((feiertage as any[]) || []).map((f: any) => f.datum));

      const created: string[] = [];
      const skipped: string[] = [];
      for (
        let d = new Date(start);
        d.getTime() <= end.getTime();
        d.setDate(d.getDate() + 1)
      ) {
        const iso = d.toISOString().slice(0, 10);
        const dow = d.getDay(); // 0=So, 6=Sa
        if (dow === 0 || dow === 6) { skipped.push(`${iso} (Wochenende)`); continue; }
        if (feiertagSet.has(iso)) { skipped.push(`${iso} (Feiertag)`); continue; }

        // Schon ein Eintrag für diesen Tag?
        const { data: existing } = await supabase
          .from("time_entries")
          .select("id, taetigkeit")
          .eq("user_id", userId)
          .eq("datum", iso)
          .limit(1);
        if (existing && existing.length > 0) {
          skipped.push(`${iso} (bereits ${(existing[0] as any).taetigkeit || "Eintrag"})`);
          continue;
        }

        const soll = getRegelarbeitszeit(d);
        const startTime = dow === 5 ? "07:00" : "07:00";
        const endTime = dow === 5 ? "12:00" : "16:00";
        const { error } = await supabase.from("time_entries").insert({
          user_id: userId, datum: iso,
          stunden: soll,
          taetigkeit: "Krankenstand",
          project_id: null,
          location_type: "werkstatt",
          start_time: startTime,
          end_time: endTime,
          pause_minutes: 0,
          notizen: `Krankmeldung via WhatsApp-Bot von ${senderName}`,
        });
        if (error) { skipped.push(`${iso} (Fehler: ${error.message})`); continue; }
        created.push(iso);
      }

      if (created.length === 0 && skipped.length === 0) {
        return "INFO: Kein Werktag im Zeitraum.";
      }
      let result = `ERFOLG: Krankmeldung eingetragen für ${created.length} Tag${created.length === 1 ? "" : "e"}`;
      if (created.length > 0) result += `: ${created.join(", ")}`;
      if (skipped.length > 0) {
        result += `. Übersprungen: ${skipped.slice(0, 5).join(", ")}`;
        if (skipped.length > 5) result += ` +${skipped.length - 5} weitere`;
      }
      return result;
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

═══ KRANKMELDUNG ═══
"Bin heute krank" / "melde mich krank" → krankmeldung_eintragen() (heute)
"War gestern krank" → krankmeldung_eintragen(von_datum=gestern)
"Bin bis Freitag krank" → krankmeldung_eintragen(von_datum=heute, bis_datum=Freitag)
"Krank von Montag bis Mittwoch" → von/bis ableiten und eintragen
Das Tool erstellt für jeden Werktag einen time_entry (Krankenstand) mit dem
Tagessoll. Wochenenden und Feiertage werden übersprungen. Falls an einem
Tag bereits ein Eintrag existiert, wird er übersprungen (nicht überschrieben).
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

      // SOFORT protokollieren — damit wir im Audit-Log sehen dass die
      // Message angekommen ist, unabhängig davon was danach crasht.
      try {
        const earlyBody = msg.body || msg.caption || `[${msg.type || "unknown"}]`;
        await supabase.from("whatsapp_messages").insert({
          phone, direction: "incoming",
          message_body: earlyBody,
          message_type: msg.type === "image" ? "image_in" : "text_in",
          processed: false,
          wapi_message_id: msg.messageId || null,
        });
      } catch (e: any) {
        console.error("Early audit save failed:", e?.message);
      }

      try {

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
        // Voice message → transcribe with Whisper. Robuster Fallback:
        // leer/zu kurz/nur Geräusch → klar nachfragen, nicht erraten.
        try {
          const transcription = await transcribeAudio(msg.audioUrl);
          const clean = (transcription || "").trim();
          // Whisper liefert bei Rausch manchmal nur "Bitte abonnieren." o.ä. —
          // als Heuristik: <3 Wörter UND keine Zahlen UND keine Projekt-
          // Stichworte → nachfragen.
          const wordCount = clean.split(/\s+/).filter(Boolean).length;
          const tooShort = clean.length < 3 || wordCount < 2;
          if (tooShort) {
            await sendWhatsApp(phone,
              "Sorry, ich konnte deine Sprachnachricht nicht gut verstehen 🙏 Kannst du's bitte kurz als Text schreiben? Oder nochmal langsam und ohne viel Hintergrundgeräusch einsprechen."
            );
            continue;
          }
          userMessage = `[Sprachnachricht] ${clean}`;
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

            // Gibt es pending Fotos die erst vor kurzem (<60s) reingekommen sind?
            // Nur dann gilt das als "aktuell laufende Welle" → kein neuer Prompt.
            // Alles ältere ist eine vergessene/ignorierte Welle → neue Welle
            // bekommt ruhig einen frischen Prompt (atomic claim verhindert Spam).
            const recentWindowIso = new Date(Date.now() - 60 * 1000).toISOString();
            const { count: recentPendingCount } = await supabase
              .from("whatsapp_messages")
              .select("id", { count: "exact", head: true })
              .eq("user_id", userId)
              .eq("message_type", "pending_photo")
              .eq("processed", false)
              .gte("created_at", recentWindowIso);
            const hadPendingBefore = (recentPendingCount || 0) > 0;

            // Nur einfügen wenn kein pending mit gleichem Hash existiert (Dup-Schutz)
            const { data: dupe } = await supabase.from("whatsapp_messages")
              .select("id")
              .eq("user_id", userId)
              .eq("message_type", "pending_photo")
              .eq("processed", false)
              .eq("photo_hash", photoHash)
              .limit(1);
            if (!dupe || dupe.length === 0) {
              // wapi_message_id bewusst NICHT setzen — die hat bereits der
              // early-audit-Eintrag (message_type="image_in") belegt. UNIQUE-
              // Constraint würde sonst den pending_photo-Insert abwürgen.
              const { error: pendErr } = await supabase.from("whatsapp_messages").insert({
                phone, direction: "incoming",
                message_body: tempUrl,
                message_type: "pending_photo",
                employee_id: emp.id, user_id: userId, processed: false,
                photo_hash: photoHash,
              });
              if (pendErr) {
                console.error(`[pending_photo] insert failed: ${pendErr.message}`);
              }
            }

            // Marker für Batch-Logik weiter unten: nur beim ERSTEN Foto
            // einen Prompt senden. Alle folgenden Fotos (egal ob im selben
            // Webhook-Call oder in separaten Calls danach) bleiben still.
            (msg as any).__hadPendingBefore = hadPendingBefore;
          } catch (e: any) {
            console.error("Image download failed:", e.message);
          }
        }

        if (msg.caption) {
          // Caption = Projekt/Anweisung → ganz normal als Text-Input verarbeiten
          userMessage = `[Foto gesendet] ${msg.caption}`;
        } else {
          // Keine Caption → merken für Batch-Antwort am Ende des Webhook-Calls.
          // ABER nur triggern wenn DAVOR noch keine pending Fotos lagen
          // (sonst gäb's bei jedem einzelnen Foto-Webhook-Call eine neue
          // Projekt-Liste → genau das Spam-Problem, das wir vermeiden wollen).
          if (!(msg as any).__hadPendingBefore) {
            batchPhotoCount.set(phone, (batchPhotoCount.get(phone) || 0) + 1);
            batchEmp.set(phone, { emp, userId });
          } else {
            console.log(`Photo added to existing batch (no new prompt)`);
          }
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

      // incoming ist bereits früh als Audit gespeichert — hier nur processed=true setzen
      if (msg.messageId) {
        await supabase.from("whatsapp_messages")
          .update({ employee_id: emp.id, user_id: userId, processed: true })
          .eq("wapi_message_id", msg.messageId);
      }

      const [ctxData, history] = await Promise.all([
        gatherContext(userId),
        loadHistory(phone, 6),
      ]);

      // Pending-Fotos-Hinweis + letzte an den Mitarbeiter geschickte
      // Projektliste als Kontext an GPT geben. So kann GPT eine Nummer-
      // Antwort wie "6" korrekt auf die passende Liste mappen.
      let contextWithPhotos = ctxData.context;
      if (pendingCount > 0) {
        // Letzte outgoing-Projektliste finden (mit 📸 + Nummerierung)
        const { data: lastPrompt } = await supabase
          .from("whatsapp_messages")
          .select("message_body")
          .eq("phone", phone)
          .eq("direction", "outgoing")
          .like("message_body", "%📸%")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        contextWithPhotos += `\n\n═══ PENDING FOTOS ═══\n`;
        contextWithPhotos += `Der Mitarbeiter hat ${pendingCount} Foto${pendingCount === 1 ? "" : "s"} geschickt, die noch keinem Projekt zugeordnet sind.\n`;
        if (lastPrompt?.message_body) {
          contextWithPhotos += `\nDIESE PROJEKT-LISTE hast du ihm zuletzt geschickt (die Nummern beziehen sich GENAU auf diese Liste, NICHT auf die allgemeine AKTIVE PROJEKTE-Nummerierung):\n`;
          contextWithPhotos += lastPrompt.message_body + `\n`;
        }
        contextWithPhotos += `\nWENN die Antwort eine Nummer oder ein Projektname ist (z.B. "6", "Hörmann", "für Rene") → foto_hochladen mit dem Projekt aus der Liste oben aufrufen. NUMMER BEZIEHT SICH AUF DIE LETZTE LISTE. Alle ${pendingCount} Fotos werden automatisch zugewiesen.\n`;
        contextWithPhotos += `WENN er eine andere Frage stellt (Einteilung, Stunden) → normal antworten, Fotos warten weiter.\n`;
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
      } catch (iterErr: any) {
        console.error("Msg processing failed:", iterErr?.stack || iterErr);
        try {
          const fb = "Entschuldigung, da ist gerade was schiefgelaufen. Bitte probier's in einem Moment nochmal.";
          await sendWhatsApp(phone, fb);
          await saveMsg(phone, "outgoing", `[FEHLER] ${fb}`);
        } catch (fe) { console.error("Fallback also failed:", fe); }
      }
    }

    // ── Batch-Antwort für caption-lose Fotos ──
    // Egal ob 1 oder 10 Fotos — genau EINE smarte Nachricht mit Projekt-
    // Vorschlägen. Atomarer DB-Lock (try_claim_photo_prompt) verhindert,
    // dass bei parallel eintreffenden Webhook-Calls alle gleichzeitig einen
    // Prompt senden (Race-Condition-Fix).
    for (const [phone, count] of batchPhotoCount.entries()) {
      const ctx = batchEmp.get(phone);
      if (!ctx) continue;
      const { emp, userId } = ctx;

      // ATOMIC CLAIM: nur die erste parallele Instanz kriegt true zurück,
      // alle anderen false. TTL 90s — ab da darf eine neue Welle wieder
      // einen Prompt triggern, auch wenn der User nicht geantwortet hat.
      // Normalerweise wird der Lock im foto_hochladen explizit freigegeben.
      const { data: claimed } = await (supabase.rpc as any)(
        "try_claim_photo_prompt",
        { p_user_id: userId, p_ttl_seconds: 90 }
      );
      if (!claimed) {
        console.log(`Prompt claim denied (already prompted, still waiting for reply) user=${userId}`);
        continue;
      }

      // Pause, damit parallel laufende Webhook-Instanzen ihre
      // pending_photo-Inserts abschließen können. Bei 5-6 Fotos können
      // die über mehrere Sekunden reinlaufen — darum 3s.
      await new Promise((r) => setTimeout(r, 3000));

      // Zusätzlicher Safety-Net-Spam-Schutz: letzte outgoing-Nachricht <60s?
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

      // Keine Zahl im Text — die kann bei parallelen Webhook-Calls
      // unter-oder übertrieben sein. Die echte Zählung passiert erst
      // beim foto_hochladen, wenn der User das Projekt genannt hat.
      const heading = totalCount > 1 ? "📸 Fotos erhalten" : "📸 Foto erhalten";
      const question = totalCount > 1
        ? "👉 *Auf welches Projekt sollen die Fotos?*"
        : "👉 *Auf welches Projekt soll das Foto?*";

      let reply = `${heading}\n\n${question}\n\n`;
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
        projList.slice(0, 10).forEach((p: any, i: number) => {
          reply += `${i + 1}. ${p.name}\n`;
        });
      } else {
        reply += "Keine aktiven Projekte gefunden.";
      }
      reply += totalCount > 1
        ? "\n➡️ Antworte kurz mit *Nummer* oder *Projektname* — alle aktuellen Fotos werden ins gleiche Projekt geladen."
        : "\n➡️ Antworte kurz mit *Nummer* oder *Projektname*.";

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

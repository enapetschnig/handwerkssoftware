import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const openaiKey = Deno.env.get("OPENAI_API_KEY")!;
const WAPI_TOKEN = Deno.env.get("WAPI_TOKEN")!;
const WAPI_BASE = "https://gate.whapi.cloud";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.sent === false || body?.error) {
    const msg = body?.error?.message || body?.message || `HTTP ${res.status}`;
    throw new Error(`WAPI: ${msg}`);
  }
  return body;
}

function formatPhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)\+]/g, "");
  if (cleaned.startsWith("0")) cleaned = `43${cleaned.slice(1)}`;
  return cleaned;
}

async function getSetting(key: string, fallback: string): Promise<string> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return data?.value || fallback;
}

// Working hours per day (same as webhook)
function getDailyTarget(): number {
  const day = new Date().getDay();
  if (day === 0 || day === 6) return 0;
  if (day >= 1 && day <= 4) return 8.5;
  if (day === 5) return 5.0;
  return 0;
}

async function getAllActiveProjects(): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase
    .from("projects")
    .select("id, name")
    .not("status", "eq", "Abgeschlossen")
    .order("name");
  return (data as any[]) || [];
}

function formatProjectList(
  projects: { id: string; name: string }[],
  todayIds: Set<string>
): string {
  if (!projects.length) return "_Aktuell keine Projekte angelegt._";
  const todays = projects.filter((p) => todayIds.has(p.id));
  const others = projects.filter((p) => !todayIds.has(p.id));

  let out = "";
  if (todays.length) {
    out += "*Heute eingeteilt:*\n";
    todays.forEach((p, i) => { out += `${i + 1}. ${p.name}\n`; });
    if (others.length) {
      out += "\n*Andere aktive Projekte:*\n";
      others.slice(0, 10).forEach((p, i) => {
        out += `${todays.length + i + 1}. ${p.name}\n`;
      });
    }
  } else {
    projects.slice(0, 10).forEach((p, i) => { out += `${i + 1}. ${p.name}\n`; });
  }
  return out.trimEnd();
}

const DEFAULT_MORNING_TEMPLATE = `Guten Morgen {name}! ☀️

{einteilung_block}Tagessoll: *{tagessoll}h* ({wochentag})

*Projekte:*
{projekte}

Stunden schreiben = Nummer + Stunden, z.B. _"1 8h Montage"_`;

const DEFAULT_EVENING_OPEN_TEMPLATE = `Hey {name}! 👋

Du hast heute noch *{rest}h* offen ({stunden_heute}/{tagessoll}h gebucht).

*Auf welches Projekt?*
{projekte}

Antwort z.B.: _"1 {rest}h Kabel verlegt"_`;

const DEFAULT_EVENING_DONE_TEMPLATE = `Hey {name}! Deine Stunden für heute sind komplett ({stunden_heute}h) ✓ Schönen Feierabend! 🍺`;

function renderTemplate(tpl: string, vars: Record<string, string | number>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
  }
  return out;
}

async function generateReminderMessage(
  name: string,
  scheduleInfo: string,
  todayHours: number,
  isEvening: boolean,
  projectList: string
): Promise<string> {
  const dailyTarget = getDailyTarget();
  const remaining = Math.max(0, dailyTarget - todayHours);

  const dayNames = [
    "Sonntag", "Montag", "Dienstag", "Mittwoch",
    "Donnerstag", "Freitag", "Samstag",
  ];
  const dayName = dayNames[new Date().getDay()];

  const einteilungBlock = scheduleInfo
    ? `📋 *Deine Einteilung heute:*\n${scheduleInfo}\n\n`
    : `Heute keine Einteilung in der Plantafel.\n\n`;

  const vars = {
    name,
    wochentag: dayName,
    tagessoll: dailyTarget,
    stunden_heute: todayHours,
    rest: remaining,
    einteilung: scheduleInfo || "Heute keine Einteilung in der Plantafel.",
    einteilung_block: einteilungBlock,
    projekte: projectList,
  };

  if (isEvening) {
    if (remaining > 0) {
      const tpl = (await getSetting("whatsapp_evening_template", "")) || DEFAULT_EVENING_OPEN_TEMPLATE;
      return renderTemplate(tpl, vars);
    }
    const tpl = (await getSetting("whatsapp_evening_done_template", "")) || DEFAULT_EVENING_DONE_TEMPLATE;
    return renderTemplate(tpl, vars);
  }

  const tpl = (await getSetting("whatsapp_morning_template", "")) || DEFAULT_MORNING_TEMPLATE;
  return renderTemplate(tpl, vars);
}

Deno.serve(async (req: Request): Promise<Response> => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: Service-Role-Key, Cron-Secrets ODER Admin-JWT (für den "Jetzt senden"-Button)
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("CRON_SECRET");
  const dbCronSecret = await getSetting("cron_webhook_secret", "");

  let isAuthorized =
    (serviceKey && token === serviceKey) ||
    (cronSecret && token === cronSecret) ||
    (dbCronSecret && token === dbCronSecret);

  if (!isAuthorized && token) {
    // Admin-JWT-Pfad: User-Token validieren, Admin-Rolle prüfen
    const { data: { user: caller } } = await supabase.auth.getUser(token);
    if (caller) {
      const { data: roleRow } = await supabase
        .from("user_roles").select("role").eq("user_id", caller.id).maybeSingle();
      if (roleRow?.role === "administrator") isAuthorized = true;
    }
  }

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    let reminderType = "auto";
    let mode: "auto" | "force" = "auto";
    let preview = false;
    let previewUserId: string | null = null;
    try {
      const body = await req.json();
      reminderType = body?.type || "auto";
      if (body?.mode === "force") mode = "force";
      if (body?.preview === true) preview = true;
      if (body?.user_id) previewUserId = String(body.user_id);
    } catch { /* no body */ }

    // Vorschau-Modus: generiert die Nachricht ohne zu senden
    if (preview) {
      const isEvening = reminderType === "evening";
      const today = new Date().toISOString().split("T")[0];
      // Beispiel-Mitarbeiter: übergebener user_id oder Platzhalter
      let name = "Max";
      let scheduleInfo = "";
      let todayHours = 0;
      const allProjects = await getAllActiveProjects();
      const todayProjectIds = new Set<string>();
      if (previewUserId) {
        const { data: emp } = await supabase
          .from("employees")
          .select("vorname, user_id")
          .eq("user_id", previewUserId)
          .maybeSingle();
        if (emp?.vorname) name = emp.vorname;
        const { data: einsaetze } = await supabase
          .from("einsaetze")
          .select("name, adresse, start_time, end_time, ganztaegig, beschreibung, project_id, projects(id, name)")
          .eq("user_id", previewUserId)
          .lte("start_date", today)
          .gte("end_date", today);
        if (einsaetze?.length) {
          scheduleInfo = einsaetze.map((e: any) => {
            if (e.projects?.id) todayProjectIds.add(e.projects.id);
            const n = e.projects?.name || e.name || "(ohne Projekt)";
            const z = e.ganztaegig ? "ganztags" : (e.start_time && e.end_time ? `${e.start_time.slice(0,5)}–${e.end_time.slice(0,5)}` : "");
            return `• ${n}${z ? ` (${z})` : ""}${e.adresse ? `\n  📍 ${e.adresse}` : ""}`;
          }).join("\n");
        }
        const { data: entries } = await supabase.from("time_entries")
          .select("stunden").eq("user_id", previewUserId).eq("datum", today);
        todayHours = (entries || []).reduce((s: number, e: any) => s + (e.stunden || 0), 0);
      }
      const projectList = formatProjectList(allProjects, todayProjectIds);
      const message = await generateReminderMessage(name, scheduleInfo, todayHours, isEvening, projectList);
      return new Response(
        JSON.stringify({ preview: true, type: isEvening ? "evening" : "morning", message }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Europe/Vienna Zeit berechnen (pg_cron läuft in UTC)
    const viennaFmt = new Intl.DateTimeFormat("de-AT", {
      timeZone: "Europe/Vienna",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
      weekday: "short",
    });
    const parts = viennaFmt.formatToParts(new Date()).reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
    const vienna = {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      hour: parseInt(parts.hour, 10),
      minute: parseInt(parts.minute, 10),
      weekday: parts.weekday?.toLowerCase().slice(0, 2) || "",
    };

    // Feiertags-Check: an AT-Feiertagen keine Reminders
    const { data: holiday } = await supabase
      .from("austrian_holidays")
      .select("bezeichnung")
      .eq("datum", vienna.date)
      .maybeSingle();
    if (holiday && mode !== "force") {
      return new Response(
        JSON.stringify({ message: `Feiertag: ${(holiday as any).bezeichnung} — keine Reminders` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cron-Modus: entscheiden ob Morgen oder Abend anhand der konfigurierten Zeiten
    const morningTimeStr = await getSetting("whatsapp_morning_time", "07:00");
    const eveningTimeStr = await getSetting("whatsapp_reminder_time", "17:00");
    const parseHHMM = (s: string) => {
      const [h, m] = s.split(":").map((x) => parseInt(x, 10));
      return { h: h || 0, m: m || 0 };
    };
    const mt = parseHHMM(morningTimeStr);
    const et = parseHHMM(eveningTimeStr);
    const nowMin = vienna.hour * 60 + vienna.minute;
    const morningMin = mt.h * 60 + mt.m;
    const eveningMin = et.h * 60 + et.m;
    // Slot-Window ±15 Min (passend zum Cron-Intervall)
    const inMorningWindow = Math.abs(nowMin - morningMin) <= 15;
    const inEveningWindow = Math.abs(nowMin - eveningMin) <= 15;

    let isEvening: boolean;
    if (reminderType === "morning") isEvening = false;
    else if (reminderType === "evening") isEvening = true;
    else if (mode === "force") isEvening = vienna.hour >= 14;
    else {
      // Cron-Auto: sende nur wenn Zeit-Fenster gerade passt
      if (inEveningWindow) isEvening = true;
      else if (inMorningWindow) isEvening = false;
      else {
        return new Response(
          JSON.stringify({ message: `Kein Sende-Fenster gerade (${parts.hour}:${parts.minute})` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const enabled = isEvening
      ? await getSetting("whatsapp_reminder_enabled", "true")
      : await getSetting("whatsapp_morning_enabled", "true");

    if (enabled !== "true") {
      return new Response(
        JSON.stringify({ message: "Reminders disabled" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const allowedDays = await getSetting("whatsapp_reminder_days", "mo,di,mi,do,fr");
    if (!allowedDays.includes(vienna.weekday)) {
      return new Response(
        JSON.stringify({ message: `${vienna.weekday} nicht in erlaubten Tagen` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const today = vienna.date;

    // Nur an aktive Mitarbeiter mit freigeschaltetem WhatsApp UND aktivem Profil senden
    // (entspricht exakt der Liste in den WhatsApp-Admin-Einstellungen)
    const { data: employees } = await (supabase.from("employees" as never) as any)
      .select("id, vorname, nachname, telefon, user_id, whatsapp_last_morning_date, whatsapp_last_evening_date, profiles:user_id!inner(is_active)")
      .eq("whatsapp_aktiv", true)
      .eq("aktiv", true)
      .eq("profiles.is_active", true)
      .not("telefon", "is", null);

    if (!employees?.length) {
      return new Response(
        JSON.stringify({ message: "No employees" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // For evening: skip employees who already reached their daily target
    const dailyTarget = getDailyTarget();
    let usersWithEnoughHours = new Set<string>();
    if (isEvening) {
      const { data: entries } = await supabase
        .from("time_entries")
        .select("user_id, stunden")
        .eq("datum", today);

      const hoursByUser: Record<string, number> = {};
      (entries || []).forEach((e: any) => {
        hoursByUser[e.user_id] = (hoursByUser[e.user_id] || 0) + e.stunden;
      });
      Object.entries(hoursByUser).forEach(([uid, h]) => {
        if (h >= dailyTarget - 0.5) usersWithEnoughHours.add(uid);
      });
    }

    // Alle aktiven Projekte einmal laden — pro Mitarbeiter wird die Liste
    // mit den heute eingeteilten Projekten oben sortiert.
    const allProjects = await getAllActiveProjects();

    let sentCount = 0;
    const results: any[] = [];

    for (const emp of employees) {
      if (!emp.telefon || !emp.user_id) continue;
      if (isEvening && usersWithEnoughHours.has(emp.user_id)) {
        results.push({ name: `${emp.vorname} ${emp.nachname}`, sent: false, reason: "hours_ok" });
        continue;
      }

      // Dedup: wenn heute schon gesendet wurde (gleicher Typ), überspringen
      // (außer mode=force → manueller Admin-Trigger ignoriert Dedup)
      if (mode !== "force") {
        const lastSentField = isEvening ? "whatsapp_last_evening_date" : "whatsapp_last_morning_date";
        const lastSent = (emp as any)[lastSentField];
        if (lastSent === today) {
          results.push({ name: `${emp.vorname} ${emp.nachname}`, sent: false, reason: "already_sent_today" });
          continue;
        }
      }

      try {
        const { data: todayEntries } = await supabase
          .from("time_entries")
          .select("stunden")
          .eq("user_id", emp.user_id)
          .eq("datum", today);

        const todayHours = (todayEntries || []).reduce(
          (sum: number, e: any) => sum + (e.stunden || 0), 0
        );

        let scheduleInfo = "";
        const todayProjectIds = new Set<string>();
        // Einsätze aus der Plantafel (einsaetze-Tabelle) für heute holen
        const { data: einsaetze } = await supabase
          .from("einsaetze")
          .select("name, adresse, start_time, end_time, ganztaegig, beschreibung, project_id, projects(id, name)")
          .eq("user_id", emp.user_id)
          .lte("start_date", today)
          .gte("end_date", today)
          .order("start_time");

        if (einsaetze?.length) {
          scheduleInfo = einsaetze
            .map((e: any) => {
              const projektName = e.projects?.name || e.name || "(ohne Projekt)";
              if (e.projects?.id) todayProjectIds.add(e.projects.id);
              else if (e.project_id) todayProjectIds.add(e.project_id);
              const zeit = e.ganztaegig
                ? "ganztags"
                : (e.start_time && e.end_time)
                  ? `${(e.start_time || "").slice(0, 5)}–${(e.end_time || "").slice(0, 5)}`
                  : "";
              let line = `• ${projektName}`;
              if (zeit) line += ` (${zeit})`;
              if (e.adresse) line += `\n  📍 ${e.adresse}`;
              if (e.beschreibung) line += `\n  ℹ️ ${e.beschreibung}`;
              return line;
            })
            .join("\n");
        }

        const projectList = formatProjectList(allProjects, todayProjectIds);

        const message = await generateReminderMessage(
          emp.vorname,
          scheduleInfo,
          todayHours,
          isEvening,
          projectList
        );

        const waPhone = formatPhone(emp.telefon);
        await sendWhatsApp(waPhone, message);

        await supabase.from("whatsapp_messages").insert({
          phone: waPhone,
          direction: "outgoing",
          message_body: message,
          employee_id: emp.id,
          user_id: emp.user_id,
          processed: true,
        });

        // Dedup-Marker setzen
        const dedupField = isEvening ? "whatsapp_last_evening_date" : "whatsapp_last_morning_date";
        await supabase.from("employees")
          .update({ [dedupField]: today })
          .eq("id", emp.id);

        sentCount++;
        results.push({ name: `${emp.vorname} ${emp.nachname}`, sent: true });
      } catch (err: any) {
        console.error(`Failed for ${emp.vorname}:`, err);
        results.push({ name: `${emp.vorname} ${emp.nachname}`, sent: false, reason: err.message });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, type: isEvening ? "evening" : "morning", sentCount, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Reminder error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

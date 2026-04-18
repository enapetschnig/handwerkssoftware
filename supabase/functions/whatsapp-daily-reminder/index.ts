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
  return res.json();
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

async function getProjectList(): Promise<string> {
  const { data: projects } = await supabase
    .from("projects")
    .select("name")
    .eq("status", "In Arbeit")
    .order("name");

  if (!projects?.length) return "";
  return projects.map((p: any, i: number) => `${i + 1}. ${p.name}`).join("\n");
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

  if (isEvening && remaining > 0) {
    // Evening reminder: direct, with project list ready to go
    let msg = `Hey ${name}! 👋\n\n`;
    msg += `Du hast heute noch *${remaining}h* offen (${todayHours > 0 ? `${todayHours}/${dailyTarget}h gebucht` : `${dailyTarget}h Tagessoll`}).\n\n`;
    msg += `*Auf welches Projekt?*\n${projectList}\n\n`;
    msg += `Antwort z.B.: _"1 ${remaining}h Kabel verlegt"_`;
    return msg;
  }

  if (isEvening && remaining <= 0) {
    // Already done for the day
    return `Hey ${name}! Deine Stunden für heute sind komplett (${todayHours}h) ✓ Schönen Feierabend! 🍺`;
  }

  // Morning message
  let msg = `Guten Morgen ${name}! ☀️\n\n`;
  if (scheduleInfo) {
    msg += `📋 *Deine Einteilung heute:*\n${scheduleInfo}\n\n`;
  } else {
    msg += `Heute keine Einteilung in der Plantafel.\n\n`;
  }
  msg += `Tagessoll: *${dailyTarget}h* (${dayName})\n\n`;
  msg += `*Projekte:*\n${projectList}\n\n`;
  msg += `Stunden schreiben = Nummer + Stunden, z.B. _"1 8h Montage"_`;
  return msg;
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

  // Auth: Service-Role-Key, CRON_SECRET (env) oder cron_webhook_secret (app_settings)
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("CRON_SECRET");
  const dbCronSecret = await getSetting("cron_webhook_secret", "");
  const isAuthorized =
    (serviceKey && token === serviceKey) ||
    (cronSecret && token === cronSecret) ||
    (dbCronSecret && token === dbCronSecret);
  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    let reminderType = "auto";
    let mode: "auto" | "force" = "auto";
    try {
      const body = await req.json();
      reminderType = body?.type || "auto";
      if (body?.mode === "force") mode = "force";
    } catch { /* no body */ }

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

    // Only send to admin-verified WhatsApp numbers
    const { data: employees } = await supabase
      .from("employees")
      .select("id, vorname, nachname, telefon, user_id, whatsapp_last_morning_date, whatsapp_last_evening_date")
      .eq("whatsapp_aktiv", true)
      .not("telefon", "is", null)
      .not("user_id", "is", null);

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

    // Load project list once for all employees
    const projectList = await getProjectList();

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
        // Einsätze aus der Plantafel (einsaetze-Tabelle) für heute holen
        const { data: einsaetze } = await supabase
          .from("einsaetze")
          .select("name, adresse, start_time, end_time, ganztaegig, beschreibung, projects(name)")
          .eq("user_id", emp.user_id)
          .lte("start_date", today)
          .gte("end_date", today)
          .order("start_time");

        if (einsaetze?.length) {
          scheduleInfo = einsaetze
            .map((e: any) => {
              const projektName = e.projects?.name || e.name || "(ohne Projekt)";
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

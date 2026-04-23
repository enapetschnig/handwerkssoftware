import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getCalendarIdForProject,
  isNotFoundError,
  KATEGORIE_VALUES,
} from "../_shared/calendar-category.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Legacy single-calendar fallback (für alten worker_assignments-Pfad).
// Die einsaetze-Pfade nutzen stattdessen das kategorie-basierte Routing.
async function getLegacyCalendarId(): Promise<string> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "google_calendar_id").maybeSingle();
  return data?.value || "";
}

// ─── Google Auth (JWT → Access Token) ────────────────────

async function getGoogleAccessToken(): Promise<string> {
  const keyJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
  if (!keyJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY not configured");

  let creds;
  try {
    creds = JSON.parse(keyJson);
  } catch {
    creds = JSON.parse(keyJson.replace(/\\n/g, "\n").replace(/\\"/g, '"'));
  }

  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: creds.client_email,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const enc = (obj: any) => btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsignedToken = `${enc(header)}.${enc(payload)}`;

  const keyData = creds.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  const binaryKey = Uint8Array.from(atob(keyData), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", binaryKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(unsignedToken)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const jwt = `${unsignedToken}.${sigB64}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(`Google auth failed: ${JSON.stringify(tokenData)}`);
  return tokenData.access_token;
}

// ─── Google Calendar CRUD ────────────────────────────────

async function googleCreateEvent(
  accessToken: string,
  calendarId: string,
  payload: Record<string, any>,
): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    const err: any = new Error(`Create event failed: ${data.error?.message || res.status}`);
    err.status = res.status;
    throw err;
  }
  return data.id;
}

async function googleUpdateEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  payload: Record<string, any>,
): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    const err: any = new Error(`Update event failed: ${data.error?.message || res.status}`);
    err.status = res.status;
    throw err;
  }
  return data.id;
}

async function googleDeleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  // 200/204 = ok, 410 = bereits gelöscht → auch ok
  if (!res.ok && res.status !== 410) {
    const data = await res.json().catch(() => ({}));
    const err: any = new Error(`Delete event failed: ${data.error?.message || res.status}`);
    err.status = res.status;
    throw err;
  }
}

// ─── Einsatz-Payload Builder ─────────────────────────────

function buildEinsatzEventPayload(
  einsatz: any,
  projectName: string,
  workerName: string,
): Record<string, any> {
  const tz = "Europe/Vienna";
  const isMultiDay = einsatz.start_date !== einsatz.end_date;
  const descParts = [
    einsatz.beschreibung || "",
    einsatz.adresse ? `Adresse: ${einsatz.adresse}` : "",
    `Mitarbeiter: ${workerName}`,
  ].filter(Boolean);

  const payload: Record<string, any> = {
    summary: `${workerName} → ${projectName}`,
    description: descParts.join("\n") + "\n[montipro-plantafel]",
  };

  if (einsatz.ganztaegig || isMultiDay) {
    // All-day: Google braucht end exklusiv (Start 01.05 bis Ende 02.05 = ein Tag).
    const endDate = new Date(einsatz.end_date + "T12:00:00");
    endDate.setDate(endDate.getDate() + 1);
    payload.start = { date: einsatz.start_date };
    payload.end = { date: endDate.toISOString().split("T")[0] };
  } else {
    payload.start = {
      dateTime: `${einsatz.start_date}T${einsatz.start_time || "07:00"}:00`,
      timeZone: tz,
    };
    payload.end = {
      dateTime: `${einsatz.end_date}T${einsatz.end_time || "16:00"}:00`,
      timeZone: tz,
    };
  }

  return payload;
}

/**
 * Syncen EINES Einsatzes in den zur Projekt-Kategorie gehörigen
 * Google-Kalender. Implementiert die „Create-before-Delete"-Reihenfolge
 * aus dem Plan: erst neues Event anlegen, Write-Back, dann altes Event
 * im Altkalender aufräumen. So entsteht nie ein „weder noch"-Zustand.
 */
async function syncOneEinsatz(accessToken: string, einsatzId: string): Promise<{
  ok: true; mode: "update" | "replaced" | "noop"; google_event_id?: string; google_calendar_id?: string;
} | { ok: false; error: string }> {
  const { data: einsatz } = await supabase
    .from("einsaetze")
    .select("*")
    .eq("id", einsatzId)
    .maybeSingle();

  if (!einsatz) return { ok: false, error: "Einsatz not found" };

  // Projekt + Worker laden
  let projectName = "Projekt";
  if (einsatz.project_id) {
    const { data: p } = await supabase.from("projects")
      .select("name").eq("id", einsatz.project_id).maybeSingle();
    if (p) projectName = p.name;
  }
  const { data: profile } = await supabase.from("profiles")
    .select("vorname, nachname").eq("id", einsatz.user_id).maybeSingle();
  const workerName = profile ? `${profile.vorname} ${profile.nachname}` : "Mitarbeiter";

  // Zielkalender via Kategorie-Helper (Fallback: Default)
  const targetCalId = await getCalendarIdForProject(supabase, einsatz.project_id);
  if (!targetCalId) {
    return { ok: false, error: "Kein Ziel-Kalender (weder Kategorie- noch Default-ID konfiguriert)" };
  }

  const oldCalId: string | null = einsatz.google_calendar_id || null;
  const oldEventId: string | null = einsatz.google_event_id || null;
  const payload = buildEinsatzEventPayload(einsatz, projectName, workerName);

  // Fall A: gleicher Kalender, bestehendes Event → Update
  if (oldCalId && oldEventId && oldCalId === targetCalId) {
    try {
      await googleUpdateEvent(accessToken, targetCalId, oldEventId, payload);
      return { ok: true, mode: "update", google_event_id: oldEventId, google_calendar_id: targetCalId };
    } catch (err) {
      if (!isNotFoundError(err)) {
        console.error("Update failed (non-404):", err);
        return { ok: false, error: (err as Error).message };
      }
      console.warn(`Event ${oldEventId} in ${targetCalId} manuell gelöscht — Fallback auf Create.`);
      // fällt durch zu Fall B
    }
  }

  // Fall B: neu oder Kalender-Wechsel → create-first
  const newEventId = await googleCreateEvent(accessToken, targetCalId, payload);

  // Write-Back (Trigger überspringt reinen Meta-Write)
  await supabase.from("einsaetze").update({
    google_event_id: newEventId,
    google_calendar_id: targetCalId,
  }).eq("id", einsatzId);

  // Alten Event aufräumen (falls vorhanden und anderer Kalender)
  if (oldCalId && oldEventId && (oldCalId !== targetCalId || oldEventId !== newEventId)) {
    try {
      await googleDeleteEvent(accessToken, oldCalId, oldEventId);
    } catch (err) {
      if (isNotFoundError(err)) {
        // Schon weg — ok
      } else {
        console.error(`Konnte altes Event ${oldEventId} in ${oldCalId} nicht löschen:`, err);
        // bewusst kein throw — Haupt-Operation (neues Event) ist erfolgreich
      }
    }
  }

  return { ok: true, mode: "replaced", google_event_id: newEventId, google_calendar_id: targetCalId };
}

// ─── Legacy worker_assignments CRUD (unverändert) ────────
// Nutzt weiterhin getLegacyCalendarId() — kein Kategorie-Routing.

async function legacyCreateOrUpdateEvent(
  accessToken: string,
  assignment: any,
  projectName: string,
  workerName: string,
  existingEventId?: string,
): Promise<string> {
  const startDateTime = `${assignment.datum}T${assignment.start_time || "07:00"}:00`;
  const endDateTime = `${assignment.datum}T${assignment.end_time || "16:00"}:00`;

  const event = {
    summary: `${workerName} → ${projectName}`,
    description: (assignment.notizen || "") + "\n[montipro-plantafel]",
    start: { dateTime: startDateTime, timeZone: "Europe/Vienna" },
    end: { dateTime: endDateTime, timeZone: "Europe/Vienna" },
    transparency: "opaque",
  };

  const calId = await getLegacyCalendarId();
  if (!calId) throw new Error("Legacy google_calendar_id not configured");
  const url = existingEventId
    ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${existingEventId}`
    : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`;

  const res = await fetch(url, {
    method: existingEventId ? "PUT" : "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("Google Calendar error (legacy):", data);
    throw new Error(`Calendar API error: ${data.error?.message || res.status}`);
  }
  return data.id;
}

async function legacyDeleteEvent(accessToken: string, eventId: string) {
  const calId = await getLegacyCalendarId();
  if (!calId) return;
  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${eventId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
  );
}

// ─── Main handler ────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: cron_webhook_secret (DB-Trigger), Service-Role-Key ODER Admin/Vorarbeiter-JWT
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const { data: secretRow } = await supabase
      .from("app_settings").select("value").eq("key", "cron_webhook_secret").maybeSingle();
    const dbCronSecret = secretRow?.value as string | undefined;

    let isAuthorized =
      (serviceKey && token === serviceKey) ||
      (dbCronSecret && token === dbCronSecret);

    if (!isAuthorized && token) {
      const { data: { user: caller } } = await supabase.auth.getUser(token);
      if (caller) {
        const { data: roleRow } = await supabase
          .from("user_roles").select("role").eq("user_id", caller.id).maybeSingle();
        if (roleRow?.role === "administrator" || roleRow?.role === "vorarbeiter") {
          isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action, assignment_id, einsatz_id } = body;
    const payloadGoogleEventId: string | undefined = body.google_event_id;
    const payloadGoogleCalendarId: string | undefined = body.google_calendar_id;

    if (!action) {
      return new Response(JSON.stringify({ error: "action required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getGoogleAccessToken();

    // ─── Einsatz-Pfade (neu, kategorie-basiert) ───

    if (action === "sync_einsatz" && einsatz_id) {
      const result = await syncOneEinsatz(accessToken, einsatz_id);
      return new Response(JSON.stringify(result), {
        status: (result as any).ok ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete_einsatz") {
      // google_event_id + google_calendar_id kommen aus dem DB-Trigger-
      // Payload (DELETE), oder werden aus der Einsatz-Row gelesen (bei
      // manuellem Admin-Aufruf — solange die Zeile noch existiert).
      let gid = payloadGoogleEventId;
      let gcal = payloadGoogleCalendarId;
      if ((!gid || !gcal) && einsatz_id) {
        const { data: einsatz } = await supabase
          .from("einsaetze")
          .select("google_event_id, google_calendar_id")
          .eq("id", einsatz_id).maybeSingle();
        gid = gid || einsatz?.google_event_id || undefined;
        gcal = gcal || einsatz?.google_calendar_id || undefined;
      }
      if (gid && gcal) {
        try { await googleDeleteEvent(accessToken, gcal, gid); }
        catch (e) {
          if (!isNotFoundError(e)) console.error("Google delete failed:", e);
        }
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Bulk-Resync aller Einsätze (vom Admin-UI getriggert)
    if (action === "sync_all_einsaetze") {
      const { data: allEinsaetze } = await supabase
        .from("einsaetze")
        .select("id")
        .order("start_date", { ascending: false })
        .limit(2000);

      let ok = 0, fail = 0;
      for (const row of (allEinsaetze as any[]) || []) {
        const result = await syncOneEinsatz(accessToken, row.id);
        if ((result as any).ok) ok++; else fail++;
      }
      return new Response(JSON.stringify({ ok: true, synced: ok, failed: fail }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Legacy worker_assignments-Pfade (unverändert) ───

    if (action === "delete" && assignment_id) {
      const { data: assignment } = await supabase
        .from("worker_assignments").select("google_event_id").eq("id", assignment_id).maybeSingle();
      if (assignment?.google_event_id) {
        try { await legacyDeleteEvent(accessToken, assignment.google_event_id); }
        catch (e) { console.error("Delete event failed (may already be gone):", e); }
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "sync" && assignment_id) {
      const { data: assignment } = await supabase
        .from("worker_assignments").select("*").eq("id", assignment_id).maybeSingle();
      if (!assignment) {
        return new Response(JSON.stringify({ error: "Assignment not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      let projectName = "Projekt";
      if (assignment.project_id) {
        const { data: project } = await supabase
          .from("projects").select("name").eq("id", assignment.project_id).maybeSingle();
        if (project) projectName = project.name;
      }
      const { data: profile } = await supabase
        .from("profiles").select("vorname, nachname").eq("id", assignment.user_id).maybeSingle();
      const workerName = profile ? `${profile.vorname} ${profile.nachname}` : "Mitarbeiter";

      const gid = await legacyCreateOrUpdateEvent(
        accessToken, assignment, projectName, workerName,
        assignment.google_event_id || undefined
      );
      await supabase.from("worker_assignments").update({ google_event_id: gid }).eq("id", assignment.id);

      return new Response(JSON.stringify({ ok: true, google_event_id: gid }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "sync_all") {
      const from = body.start_date || new Date().toISOString().split("T")[0];
      const to = body.end_date || from;

      const { data: allAssignments } = await supabase
        .from("worker_assignments").select("*, projects(name)")
        .gte("datum", from).lte("datum", to);

      if (!allAssignments?.length) {
        return new Response(JSON.stringify({ ok: true, synced: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userIds = [...new Set(allAssignments.map((a: any) => a.user_id))];
      const { data: profiles } = await supabase
        .from("profiles").select("id, vorname, nachname").in("id", userIds);
      const profileMap: Record<string, string> = {};
      (profiles || []).forEach((p: any) => { profileMap[p.id] = `${p.vorname} ${p.nachname}`; });

      let synced = 0;
      for (const a of allAssignments) {
        try {
          const gid = await legacyCreateOrUpdateEvent(
            accessToken, a,
            (a as any).projects?.name || "Projekt",
            profileMap[a.user_id] || "Mitarbeiter",
            a.google_event_id || undefined
          );
          await supabase.from("worker_assignments").update({ google_event_id: gid }).eq("id", a.id);
          synced++;
        } catch (e) { console.error(`Sync failed for ${a.id}:`, e); }
      }
      return new Response(JSON.stringify({ ok: true, synced }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "cleanup_all") {
      // Cleanup im Legacy-Kalender (worker_assignments) — unverändert.
      // Für Multi-Kalender-Cleanup siehe google-calendar-sync:cleanup_multi.
      const calId = await getLegacyCalendarId();
      if (!calId) {
        return new Response(JSON.stringify({ error: "No legacy calendar ID configured" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const params = new URLSearchParams({
        singleEvents: "true", maxResults: "2500", timeMin: "2025-01-01T00:00:00Z",
      });
      const listRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const listData = await listRes.json();
      const allEvents = listData.items || [];
      let deleted = 0;
      for (const ev of allEvents) {
        if (ev.description?.includes("[montipro-plantafel]")) {
          try { await legacyDeleteEvent(accessToken, ev.id); deleted++; }
          catch (e) { console.error(`Failed to delete ${ev.id}:`, e); }
        }
      }
      await supabase.from("worker_assignments").update({ google_event_id: null }).neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("calendar_events").delete().like("title", "%→%");
      return new Response(JSON.stringify({ ok: true, deleted }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Export: bekannte Kategorie-Werte für UI-Konsistenz-Check
    if (action === "ping") {
      return new Response(JSON.stringify({ ok: true, kategorien: KATEGORIE_VALUES }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Sync error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

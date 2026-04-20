import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Calendar ID loaded from app_settings (fallback to empty string)
async function getCalendarId(): Promise<string> {
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

async function createOrUpdateEvent(
  accessToken: string,
  assignment: any,
  projectName: string,
  workerName: string,
  existingEventId?: string
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

  const calId = await getCalendarId();
  const url = existingEventId
    ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${existingEventId}`
    : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`;

  const res = await fetch(url, {
    method: existingEventId ? "PUT" : "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error("Google Calendar error:", data);
    throw new Error(`Calendar API error: ${data.error?.message || res.status}`);
  }

  return data.id;
}

async function deleteEvent(accessToken: string, eventId: string) {
  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(await getCalendarId())}/events/${eventId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
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

    if (!action) {
      return new Response(JSON.stringify({ error: "action required (sync/delete)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getGoogleAccessToken();

    if (action === "delete" && assignment_id) {
      // Find the google_event_id stored on the assignment
      const { data: assignment } = await supabase
        .from("worker_assignments")
        .select("google_event_id")
        .eq("id", assignment_id)
        .maybeSingle();

      if (assignment?.google_event_id) {
        try {
          await deleteEvent(accessToken, assignment.google_event_id);
        } catch (e) {
          console.error("Delete event failed (may already be gone):", e);
        }
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "sync" && assignment_id) {
      // Fetch assignment (without join for reliability)
      const { data: assignment, error: assignErr } = await supabase
        .from("worker_assignments")
        .select("*")
        .eq("id", assignment_id)
        .maybeSingle();

      if (assignErr) {
        console.error("Assignment query error:", assignErr);
        return new Response(JSON.stringify({ error: "Assignment query failed", details: assignErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!assignment) {
        console.error("Assignment not found for id:", assignment_id);
        return new Response(JSON.stringify({ error: "Assignment not found", id: assignment_id }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get project name separately
      let projectName = "Projekt";
      if (assignment.project_id) {
        const { data: project } = await supabase
          .from("projects")
          .select("name")
          .eq("id", assignment.project_id)
          .maybeSingle();
        if (project) projectName = project.name;
      }

      // Get worker name
      const { data: profile } = await supabase
        .from("profiles")
        .select("vorname, nachname")
        .eq("id", assignment.user_id)
        .maybeSingle();

      const workerName = profile ? `${profile.vorname} ${profile.nachname}` : "Mitarbeiter";

      const googleEventId = await createOrUpdateEvent(
        accessToken,
        assignment,
        projectName,
        workerName,
        assignment.google_event_id || undefined
      );

      // Store the Google Event ID on the assignment
      await supabase
        .from("worker_assignments")
        .update({ google_event_id: googleEventId })
        .eq("id", assignment.id);

      return new Response(JSON.stringify({ ok: true, google_event_id: googleEventId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Bulk sync: sync ALL assignments for a date range
    if (action === "sync_all") {
      const { start_date, end_date } = await req.json().catch(() => ({}));
      const from = start_date || new Date().toISOString().split("T")[0];
      const to = end_date || from;

      const { data: allAssignments } = await supabase
        .from("worker_assignments")
        .select("*, projects(name)")
        .gte("datum", from)
        .lte("datum", to);

      if (!allAssignments?.length) {
        return new Response(JSON.stringify({ ok: true, synced: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get all profiles
      const userIds = [...new Set(allAssignments.map((a: any) => a.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, vorname, nachname")
        .in("id", userIds);

      const profileMap: Record<string, string> = {};
      (profiles || []).forEach((p: any) => {
        profileMap[p.id] = `${p.vorname} ${p.nachname}`;
      });

      let synced = 0;
      for (const a of allAssignments) {
        try {
          const gid = await createOrUpdateEvent(
            accessToken,
            a,
            (a as any).projects?.name || "Projekt",
            profileMap[a.user_id] || "Mitarbeiter",
            a.google_event_id || undefined
          );

          await supabase
            .from("worker_assignments")
            .update({ google_event_id: gid })
            .eq("id", a.id);

          synced++;
        } catch (e) {
          console.error(`Sync failed for ${a.id}:`, e);
        }
      }

      return new Response(JSON.stringify({ ok: true, synced }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Einsatz sync (date-range deployments) ───
    if (action === "sync_einsatz" && einsatz_id) {
      const { data: einsatz } = await supabase
        .from("einsaetze")
        .select("*")
        .eq("id", einsatz_id)
        .maybeSingle();

      if (!einsatz) {
        return new Response(JSON.stringify({ error: "Einsatz not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let projectName = "Projekt";
      if (einsatz.project_id) {
        const { data: project } = await supabase.from("projects").select("name").eq("id", einsatz.project_id).maybeSingle();
        if (project) projectName = project.name;
      }

      const { data: profile } = await supabase.from("profiles").select("vorname, nachname").eq("id", einsatz.user_id).maybeSingle();
      const workerName = profile ? `${profile.vorname} ${profile.nachname}` : "Mitarbeiter";

      const calId = await getCalendarId();
      const isMultiDay = einsatz.start_date !== einsatz.end_date;

      // Build event
      const event: Record<string, any> = {
        summary: `${workerName} → ${projectName}`,
        description: (einsatz.beschreibung || "") + (einsatz.adresse ? `\nAdresse: ${einsatz.adresse}` : "") + "\n[montipro-plantafel]",
      };

      if (einsatz.ganztaegig || isMultiDay) {
        // All-day event (end date is exclusive in Google Calendar API)
        const endDate = new Date(einsatz.end_date + "T12:00:00");
        endDate.setDate(endDate.getDate() + 1);
        event.start = { date: einsatz.start_date };
        event.end = { date: endDate.toISOString().split("T")[0] };
      } else {
        event.start = { dateTime: `${einsatz.start_date}T${einsatz.start_time || "07:00"}:00`, timeZone: "Europe/Vienna" };
        event.end = { dateTime: `${einsatz.end_date}T${einsatz.end_time || "16:00"}:00`, timeZone: "Europe/Vienna" };
      }

      const existingEventId = einsatz.google_event_id || undefined;
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
        console.error("Google Calendar error:", data);
        return new Response(JSON.stringify({ error: data.error?.message || "Calendar API error" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase.from("einsaetze").update({ google_event_id: data.id }).eq("id", einsatz.id);

      return new Response(JSON.stringify({ ok: true, google_event_id: data.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete_einsatz") {
      // google_event_id kann mitgegeben werden (falls die einsaetze-Zeile schon
      // gelöscht ist, z. B. wenn der DB-Trigger nach DELETE aufruft). Fallback:
      // aus der DB lesen, solange sie noch existiert.
      let gid = payloadGoogleEventId;
      if (!gid && einsatz_id) {
        const { data: einsatz } = await supabase
          .from("einsaetze").select("google_event_id").eq("id", einsatz_id).maybeSingle();
        gid = einsatz?.google_event_id || undefined;
      }
      if (gid) {
        try { await deleteEvent(accessToken, gid); } catch (e) { console.error("Google delete failed:", e); }
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cleanup: delete ALL [montipro-plantafel] events from Google Calendar
    if (action === "cleanup_all") {
      const calId = await getCalendarId();
      if (!calId) {
        return new Response(JSON.stringify({ error: "No calendar ID configured" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Fetch all events from Google Calendar
      const params = new URLSearchParams({
        singleEvents: "true",
        maxResults: "2500",
        timeMin: "2025-01-01T00:00:00Z",
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
          try {
            await deleteEvent(accessToken, ev.id);
            deleted++;
          } catch (e) {
            console.error(`Failed to delete ${ev.id}:`, e);
          }
        }
      }

      // Also clear google_event_id from all worker_assignments
      await supabase.from("worker_assignments").update({ google_event_id: null }).neq("id", "00000000-0000-0000-0000-000000000000");

      // Delete imported plantafel calendar_events
      await supabase.from("calendar_events").delete().like("title", "%→%");

      return new Response(JSON.stringify({ ok: true, deleted }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Sync error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

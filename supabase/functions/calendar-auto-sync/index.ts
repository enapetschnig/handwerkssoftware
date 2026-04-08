import { createClient } from "npm:@supabase/supabase-js@2";

// ─── Calendar Auto-Sync (Cron Job) ─────────────────────────
// This function runs as a scheduled cron job (no user auth required).
// It uses the service role key to perform a full bidirectional sync
// between Google Calendar and the local calendar_events table.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type CalendarType = 'allgemein' | 'kleinigkeiten' | 'baustellen';

// ─── Google Auth (JWT -> Access Token) ──────────────────────

async function getGoogleAccessToken(serviceAccountKey: string): Promise<string> {
  if (!serviceAccountKey || serviceAccountKey.trim() === '') {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not configured');
  }

  let credentials;
  try {
    const trimmed = serviceAccountKey.trim();
    try {
      credentials = JSON.parse(trimmed);
    } catch {
      if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
        const unquoted = trimmed.slice(1, -1);
        credentials = JSON.parse(unquoted.replace(/\\n/g, "\n").replace(/\\"/g, '"'));
      } else {
        credentials = JSON.parse(trimmed.replace(/\\n/g, "\n").replace(/\\"/g, '"'));
      }
    }
  } catch (e) {
    throw new Error(`Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY: ${e}`);
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Service account key missing client_email or private_key');
  }

  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const privateKeyPem = credentials.private_key;
  const pemContents = privateKeyPem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\n/g, "");

  const binaryKey = Uint8Array.from(atob(pemContents), (c: string) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    encoder.encode(unsignedToken)
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const jwt = `${unsignedToken}.${signatureB64}`;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok) {
    throw new Error(`Failed to get access token: ${JSON.stringify(tokenData)}`);
  }

  return tokenData.access_token;
}

// ─── Helpers ────────────────────────────────────────────────

function addOneDay(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00Z");
  date.setDate(date.getDate() + 1);
  return date.toISOString().split("T")[0];
}

function subtractOneDay(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00Z");
  date.setDate(date.getDate() - 1);
  return date.toISOString().split("T")[0];
}

async function getCalendarIdForType(supabase: any, calendarType: CalendarType): Promise<string | null> {
  const settingKey = `google_calendar_id_${calendarType}`;
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", settingKey)
    .maybeSingle();
  return data?.value || null;
}

async function getAllCalendarIds(supabase: any): Promise<{ type: CalendarType; id: string }[]> {
  const types: CalendarType[] = ['allgemein', 'kleinigkeiten', 'baustellen'];
  const calendars: { type: CalendarType; id: string }[] = [];
  for (const type of types) {
    const id = await getCalendarIdForType(supabase, type);
    if (id && id.trim() !== '') {
      calendars.push({ type, id });
    }
  }
  return calendars;
}

async function fetchEventsFromGoogle(
  accessToken: string,
  calendarId: string,
  timeMin?: string,
  timeMax?: string
): Promise<any[]> {
  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "2500",
  });

  params.append("timeMin", timeMin || "2025-01-01T00:00:00Z");
  if (timeMax) params.append("timeMax", timeMax);

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await response.json();

  if (!response.ok) {
    console.error(`Failed to fetch from calendar ${calendarId}:`, data);
    return [];
  }

  return data.items || [];
}

async function syncEventToGoogle(
  accessToken: string,
  calendarId: string,
  event: { title: string; description?: string | null; start_date: string; end_date?: string | null; all_day?: boolean; start_time?: string | null; end_time?: string | null; mitarbeiter?: string[] | null },
  existingGoogleEventId?: string
): Promise<string> {
  const googleEvent = {
    summary: event.title,
    description: event.description || `Mitarbeiter: ${(event.mitarbeiter || []).join(", ")}`,
    start: event.all_day
      ? { date: event.start_date }
      : { dateTime: `${event.start_date}T${event.start_time || "08:00"}:00`, timeZone: "Europe/Vienna" },
    end: event.all_day
      ? { date: addOneDay(event.end_date || event.start_date) }
      : { dateTime: `${event.end_date || event.start_date}T${event.end_time || "17:00"}:00`, timeZone: "Europe/Vienna" },
  };

  const url = existingGoogleEventId
    ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${existingGoogleEventId}`
    : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

  const response = await fetch(url, {
    method: existingGoogleEventId ? "PUT" : "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(googleEvent),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Failed to sync event: ${JSON.stringify(data)}`);
  }
  return data.id;
}

// ─── Main Handler ───────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Use service role key - no user auth required for cron jobs
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const serviceAccountKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
    if (!serviceAccountKey) {
      return new Response(
        JSON.stringify({ error: "Google Service Account not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = await getGoogleAccessToken(serviceAccountKey);
    const calendars = await getAllCalendarIds(supabase);

    if (calendars.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No calendars configured, nothing to sync." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[calendar-auto-sync] Starting sync with ${calendars.length} calendar(s)`);

    // ── Step 1+2: Fetch from Google and upsert locally ──
    let totalSynced = 0;
    const allGoogleEventIds = new Set<string>();

    for (const calendar of calendars) {
      const googleEvents = await fetchEventsFromGoogle(accessToken, calendar.id);

      for (const gEvent of googleEvents) {
        allGoogleEventIds.add(gEvent.id);

        const isAllDay = !!gEvent.start?.date;
        const startDate = gEvent.start?.date || gEvent.start?.dateTime?.split("T")[0];
        let endDate = gEvent.end?.date || gEvent.end?.dateTime?.split("T")[0];
        const startTime = !isAllDay ? gEvent.start?.dateTime?.match(/T(\d{2}:\d{2})/)?.[1] || null : null;
        const endTime = !isAllDay ? gEvent.end?.dateTime?.match(/T(\d{2}:\d{2})/)?.[1] || null : null;

        if (isAllDay && endDate) endDate = subtractOneDay(endDate);
        if (!startDate) continue;

        // Skip events created by Plantafel (managed via worker_assignments)
        if (gEvent.description?.includes("[montipro-plantafel]")) continue;

        const { error } = await supabase.from("calendar_events").upsert({
          google_event_id: gEvent.id,
          title: gEvent.summary || "Unbenannter Termin",
          start_date: startDate,
          end_date: endDate,
          all_day: isAllDay,
          start_time: startTime,
          end_time: endTime,
          description: gEvent.description,
          synced_at: new Date().toISOString(),
          project_id: `google-${gEvent.id}`,
          calendar_type: calendar.type,
        }, { onConflict: "google_event_id" });

        if (!error) totalSynced++;
        else console.error(`Failed to upsert event ${gEvent.id}:`, error.message);
      }
    }

    // ── Step 3: Delete orphaned local events ──
    const { data: localGoogleEvents } = await supabase
      .from("calendar_events")
      .select("id, google_event_id, project_id")
      .like("project_id", "google-%");

    let deletedOrphans = 0;
    for (const localEvent of localGoogleEvents || []) {
      if (localEvent.google_event_id && !allGoogleEventIds.has(localEvent.google_event_id)) {
        await supabase.from("calendar_events").delete().eq("id", localEvent.id);
        deletedOrphans++;
      }
    }

    // ── Step 4: Push unpushed local events to Google ──
    const { data: unpushedEvents } = await supabase
      .from("calendar_events")
      .select("*")
      .is("google_event_id", null);

    let pushedToGoogle = 0;
    for (const localEvent of unpushedEvents || []) {
      const calType: CalendarType = (localEvent.calendar_type as CalendarType) || 'allgemein';
      const calId = await getCalendarIdForType(supabase, calType);
      if (!calId) continue;

      try {
        const gEventId = await syncEventToGoogle(accessToken, calId, {
          title: localEvent.title,
          start_date: localEvent.start_date,
          end_date: localEvent.end_date,
          all_day: localEvent.all_day,
          start_time: localEvent.start_time,
          end_time: localEvent.end_time,
          description: localEvent.description,
        });

        await supabase.from("calendar_events").update({
          google_event_id: gEventId,
          synced_at: new Date().toISOString(),
        }).eq("id", localEvent.id);

        pushedToGoogle++;
      } catch (e) {
        console.error(`Failed to push local event ${localEvent.id} to Google:`, e);
      }
    }

    const result = {
      success: true,
      synced: totalSynced,
      deletedOrphans,
      pushedToGoogle,
      calendarsChecked: calendars.length,
      timestamp: new Date().toISOString(),
    };

    console.log(`[calendar-auto-sync] Done:`, result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[calendar-auto-sync] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

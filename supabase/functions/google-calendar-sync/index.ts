import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

type CalendarType = 'allgemein' | 'kleinigkeiten' | 'baustellen';

interface CalendarEvent {
  id?: string;
  project_id: string;
  google_event_id?: string;
  title: string;
  start_date: string;
  end_date?: string;
  all_day?: boolean;
  start_time?: string;
  end_time?: string;
  description?: string;
  mitarbeiter?: string[];
  calendar_type?: CalendarType;
}

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

  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

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

// Get calendar ID for a specific type from app_settings
async function getCalendarIdForType(supabase: any, calendarType: CalendarType): Promise<string | null> {
  const settingKey = `google_calendar_id_${calendarType}`;
  
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", settingKey)
    .maybeSingle();
  
  return data?.value || null;
}

// Get all configured calendar IDs
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

async function syncEventToGoogle(
  accessToken: string,
  calendarId: string,
  event: CalendarEvent,
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

async function deleteEventFromGoogle(
  accessToken: string,
  calendarId: string,
  googleEventId: string
): Promise<void> {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${googleEventId}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok && response.status !== 404 && response.status !== 410) {
    const errorText = await response.text();
    let errorDetails = errorText;
    try {
      if (errorText) {
        errorDetails = JSON.stringify(JSON.parse(errorText));
      }
    } catch {
      // Keep as text if not valid JSON
    }
    throw new Error(`Failed to delete event: ${errorDetails}`);
  }
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

  if (!timeMin) {
    params.append("timeMin", "2025-01-01T00:00:00Z");
  } else {
    params.append("timeMin", timeMin);
  }

  if (timeMax) params.append("timeMax", timeMax);

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await response.json();

  if (!response.ok) {
    console.error(`Failed to fetch from calendar ${calendarId}:`, data);
    return []; // Return empty array instead of throwing to continue with other calendars
  }

  return data.items || [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getUser(token);

    if (claimsError || !claimsData?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceAccountKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
    
    if (!serviceAccountKey) {
      return new Response(
        JSON.stringify({ error: "Google Service Account not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = await getGoogleAccessToken(serviceAccountKey);

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    console.log(`Processing action: ${action}`);

    // SYNC: Create/Update event in Google Calendar
    if (req.method === "POST" && action === "sync") {
      const event: CalendarEvent = await req.json();
      const calendarType = event.calendar_type || 'allgemein';
      
      const calendarId = await getCalendarIdForType(supabase, calendarType);
      
      if (!calendarId) {
        return new Response(
          JSON.stringify({ error: `Calendar ID for type "${calendarType}" not configured` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      console.log(`Syncing event to ${calendarType} calendar: ${calendarId.substring(0, 20)}...`);

      const { data: existingEvent } = await supabase
        .from("calendar_events")
        .select("*")
        .eq("project_id", event.project_id)
        .maybeSingle();

      const googleEventId = await syncEventToGoogle(
        accessToken,
        calendarId,
        event,
        existingEvent?.google_event_id
      );

      const { data: dbEvent, error: dbError } = await supabase
        .from("calendar_events")
        .upsert({
          id: existingEvent?.id,
          project_id: event.project_id,
          google_event_id: googleEventId,
          title: event.title,
          start_date: event.start_date,
          end_date: event.end_date,
          all_day: event.all_day ?? true,
          start_time: event.start_time || null,
          end_time: event.end_time || null,
          description: event.description,
          mitarbeiter: event.mitarbeiter,
          calendar_type: calendarType,
          synced_at: new Date().toISOString(),
        }, { onConflict: "id" })
        .select()
        .single();

      if (dbError) {
        throw new Error(`Database error: ${dbError.message}`);
      }

      return new Response(
        JSON.stringify({ success: true, event: dbEvent, googleEventId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // DELETE: Remove event from Google Calendar
    if (req.method === "DELETE" && action === "delete") {
      const { project_id } = await req.json();

      const { data: existingEvent } = await supabase
        .from("calendar_events")
        .select("*")
        .eq("project_id", project_id)
        .maybeSingle();

      if (existingEvent?.google_event_id) {
        // Get the calendar ID for this event's type
        const calendarType = existingEvent.calendar_type || 'allgemein';
        const calendarId = await getCalendarIdForType(supabase, calendarType);
        
        if (calendarId) {
          await deleteEventFromGoogle(accessToken, calendarId, existingEvent.google_event_id);
        }
      }

      await supabase
        .from("calendar_events")
        .delete()
        .eq("project_id", project_id);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // FETCH: Get events from ALL configured Google Calendars
    if (req.method === "GET" && action === "fetch") {
      const timeMin = url.searchParams.get("timeMin");
      const timeMax = url.searchParams.get("timeMax");

      const calendars = await getAllCalendarIds(supabase);
      
      if (calendars.length === 0) {
        return new Response(
          JSON.stringify({ error: "No calendars configured. Please add calendar IDs in settings." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`Fetching events from ${calendars.length} calendar(s)`);

      let totalSynced = 0;
      const allGoogleEventIds = new Set<string>();

      // Fetch from all calendars
      for (const calendar of calendars) {
        console.log(`Fetching from ${calendar.type} calendar: ${calendar.id.substring(0, 20)}...`);
        
        const googleEvents = await fetchEventsFromGoogle(
          accessToken,
          calendar.id,
          timeMin || undefined,
          timeMax || undefined
        );

        console.log(`Found ${googleEvents.length} events from ${calendar.type} calendar`);

        for (const gEvent of googleEvents) {
          allGoogleEventIds.add(gEvent.id);
          
          const isAllDay = !!gEvent.start?.date;
          const startDate = gEvent.start?.date || gEvent.start?.dateTime?.split("T")[0];
          let endDate = gEvent.end?.date || gEvent.end?.dateTime?.split("T")[0];

          // Extract times from dateTime fields (e.g. "2025-06-15T09:30:00+02:00" -> "09:30")
          const startTime = !isAllDay ? gEvent.start?.dateTime?.match(/T(\d{2}:\d{2})/)?.[1] || null : null;
          const endTime = !isAllDay ? gEvent.end?.dateTime?.match(/T(\d{2}:\d{2})/)?.[1] || null : null;

          if (isAllDay && endDate) {
            endDate = subtractOneDay(endDate);
          }

          if (!startDate) continue;

          const { error } = await supabase
            .from("calendar_events")
            .upsert({
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

          if (error) {
            console.error(`Failed to upsert event ${gEvent.id}:`, error.message);
          } else {
            totalSynced++;
          }
        }
      }

      console.log(`Total synced: ${totalSynced} events`);

      // Cleanup: Delete local google-* events that no longer exist in any Google Calendar
      const { data: localGoogleEvents } = await supabase
        .from("calendar_events")
        .select("id, google_event_id")
        .like("project_id", "google-%");

      let deletedCount = 0;
      for (const localEvent of localGoogleEvents || []) {
        if (localEvent.google_event_id && !allGoogleEventIds.has(localEvent.google_event_id)) {
          await supabase
            .from("calendar_events")
            .delete()
            .eq("id", localEvent.id);
          console.log(`Deleted orphaned event: ${localEvent.google_event_id}`);
          deletedCount++;
        }
      }

      if (deletedCount > 0) {
        console.log(`Cleaned up ${deletedCount} orphaned events`);
      }

      const { data: dbEvents, error: dbError } = await supabase
        .from("calendar_events")
        .select("*")
        .order("start_date", { ascending: true });

      if (dbError) {
        throw new Error(`Database error: ${dbError.message}`);
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          events: dbEvents, 
          synced: totalSynced, 
          deleted: deletedCount,
          calendarsChecked: calendars.length 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action", receivedAction: action }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

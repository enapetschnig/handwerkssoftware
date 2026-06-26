// Edge-Function: Whapi-Channel-Health prüfen, bei Auth-Verlust Email
// senden. Aufgerufen alle 6h via pg_cron (Migration 20260625100000).
//
// Lebenszyklus:
//   1. GET https://gate.whapi.cloud/health mit WAPI_TOKEN
//   2. Schreibe Snapshot in whatsapp_channel_health-Tabelle
//   3. Wenn Status != "READY" (Code != 0):
//      a) Schaue letzten Eintrag: war der ebenfalls non-READY und
//         alert_sent=true? → nicht erneut alerten (Spam-Schutz).
//      b) Sonst: Email an EMAIL_DEFAULT_REPLY_TO bzw. bks@handwerkapp.at
//   4. Wenn READY: einfach Eintrag schreiben, kein Alert.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WAPI_TOKEN = Deno.env.get("WAPI_TOKEN") || "";
const WAPI_BASE = "https://gate.whapi.cloud";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "bks@handwerkapp.at";
// Alert-Empfänger: Default in Reihenfolge — Override per app_settings
// 'whatsapp_channel_alert_recipient', dann EMAIL_DEFAULT_REPLY_TO, dann
// die From-Adresse.
const FALLBACK_ALERT_TO = Deno.env.get("EMAIL_DEFAULT_REPLY_TO") || "bks@handwerkapp.at";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface WhapiHealth {
  status?: { code?: number; text?: string };
  channel_id?: string;
  device_id?: number;
  user?: { id?: string };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: Service-Role-Key oder cron_webhook_secret aus app_settings
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const cronSecret = await getSetting("cron_webhook_secret", "");
  const isAuthorized =
    token === supabaseServiceKey ||
    (cronSecret && token === cronSecret);
  if (!isAuthorized) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  if (!WAPI_TOKEN) {
    return jsonResponse({ error: "WAPI_TOKEN nicht konfiguriert" }, 500);
  }

  // 1. Whapi-Health abfragen
  let health: WhapiHealth = {};
  try {
    const res = await fetch(`${WAPI_BASE}/health`, {
      headers: { Authorization: `Bearer ${WAPI_TOKEN}` },
    });
    health = await res.json().catch(() => ({}));
  } catch (err) {
    console.error("Whapi health fetch fehlgeschlagen:", err);
    health = { status: { code: -1, text: "FETCH_ERROR" } };
  }

  const statusCode = health.status?.code ?? -1;
  const statusText = health.status?.text || "UNKNOWN";
  const channelId = health.channel_id || null;
  const hasLinkedUser = !!health.user?.id;

  // Whapi-Status-Codes:
  //   0 / READY     → Channel komplett bereit, sendet sofort
  //   4 / AUTH      → Authentifiziert, MIT verknüpftem user.id = healthy.
  //                   AUTH ohne user.id = wartet auf Pairing → nicht healthy.
  //   2 / LOADING, 3 / QR, 5 / CONFLICT, … → nicht healthy
  const isHealthy =
    statusCode === 0 ||
    statusText === "READY" ||
    ((statusCode === 4 || statusText === "AUTH") && hasLinkedUser);

  // 2. Spam-Schutz: prüfe ob die laufende Outage-Serie schon gemeldet
  // wurde. Wir suchen den letzten Eintrag mit alert_sent=true und prüfen,
  // ob seither GAR KEIN healthy-Zwischenstand stand. Das verhindert,
  // dass mehrere non-healthy Snapshots in Folge jeweils erneut alarmieren
  // (Bug-Vorgänger: prüfte nur direkten Vorgänger, der konnte alert_sent=
  // false haben → fälschlich als "noch nicht gewarnt" interpretiert).
  const { data: recentRows } = await supabase
    .from("whatsapp_channel_health")
    .select("status_code, status_text, alert_sent, user_id")
    .order("checked_at", { ascending: false })
    .limit(20);
  const recent = (recentRows || []) as Array<{
    status_code: number; status_text: string; alert_sent: boolean; user_id: string | null;
  }>;

  let outageAlreadyAlerted = false;
  for (const row of recent) {
    // Konsistent mit isHealthy oben: AUTH zählt nur dann als healthy, wenn
    // ein User verknüpft ist. AUTH ohne user_id = wartet auf Pairing.
    const rowHasUser = !!row.user_id;
    const rowHealthy = row.status_code === 0 ||
      row.status_text === "READY" ||
      ((row.status_code === 4 || row.status_text === "AUTH") && rowHasUser);
    if (rowHealthy) break; // Recovery dazwischen → neue Outage darf wieder alarmieren
    if (row.alert_sent && row.status_text === statusText) {
      outageAlreadyAlerted = true;
      break;
    }
  }

  // 3. Snapshot schreiben
  const shouldAlert = !isHealthy && !outageAlreadyAlerted;
  const last = recent[0];
  const previouslyAlertedSameStatus = outageAlreadyAlerted;
  let alertEmailLogId: string | null = null;

  if (shouldAlert) {
    alertEmailLogId = await sendAlert(statusText, statusCode, channelId, last?.status_text || null);
  }

  await supabase.from("whatsapp_channel_health").insert({
    status_code: statusCode,
    status_text: statusText,
    channel_id: channelId,
    device_id: health.device_id ?? null,
    user_id: health.user?.id ?? null,
    alert_sent: shouldAlert,
    alert_email_log_id: alertEmailLogId,
    raw_response: health,
  });

  return jsonResponse({
    ok: true,
    healthy: isHealthy,
    status_code: statusCode,
    status_text: statusText,
    alert_sent: shouldAlert,
    previously_alerted: previouslyAlertedSameStatus,
  });
});

async function sendAlert(
  statusText: string,
  statusCode: number,
  channelId: string | null,
  previousStatus: string | null,
): Promise<string | null> {
  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY fehlt — kann nicht alerten");
    return null;
  }

  // Letzten erfolgreichen Send-Zeitpunkt holen für Kontext
  const { data: lastSendRows } = await supabase
    .from("whatsapp_messages")
    .select("created_at")
    .eq("direction", "outgoing")
    .order("created_at", { ascending: false })
    .limit(1);
  const lastSend = lastSendRows?.[0]?.created_at;
  const lastSendFmt = lastSend
    ? new Date(lastSend).toLocaleString("de-AT", { timeZone: "Europe/Vienna" })
    : "unbekannt";

  // Empfaenger ermitteln — app_settings hat Vorrang
  const recipient = (await getSetting("whatsapp_channel_alert_recipient", "")) || FALLBACK_ALERT_TO;

  const subject = "⚠️ WhatsApp-Channel braucht Reauthentifizierung";
  const bodyHtml = `
<p>Hi,</p>
<p>der Whapi-Channel ist nicht mehr authentifiziert — keine
WhatsApp-Reminder gehen raus.</p>
<table style="border-collapse:collapse;margin:12px 0;font-family:monospace;font-size:13px;">
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Aktueller Status:</td><td><strong>${statusText}</strong> (Code ${statusCode})</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Vorheriger Status:</td><td>${previousStatus || "(noch keiner)"}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Channel-ID:</td><td>${channelId || "?"}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Letzter erfolgreicher Send:</td><td>${lastSendFmt}</td></tr>
</table>
<p><strong>Was zu tun ist:</strong></p>
<ol>
  <li>Whapi-Dashboard öffnen: <a href="https://panel.whapi.cloud/">https://panel.whapi.cloud/</a></li>
  <li>BKS-Channel wählen → QR-Code anzeigen</li>
  <li>Mit dem BKS-WhatsApp scannen (Geräte verknüpfen)</li>
  <li>Test-Send aus dem Dashboard — wenn er ankommt, läuft alles</li>
</ol>
<p>Beim nächsten Cron-Tick (15min später) werden die Reminder automatisch wieder rausgehen.</p>
<p style="color:#888;font-size:11px;margin-top:18px;">
Diese Mail kommt vom Monti.pro-Auto-Monitoring. Wir alarmieren nur
einmal pro Outage — nicht alle 6h. Sobald der Channel wieder READY ist,
wirst du beim nächsten Auth-Verlust erneut benachrichtigt.
</p>
`;

  try {
    // Email-Log-Eintrag vorab (für Audit-Trail)
    const { data: logRow } = await supabase
      .from("email_log")
      .insert({
        invoice_id: null,
        to_address: recipient,
        reply_to: recipient,
        subject,
        body_html: bodyHtml,
        provider: "resend",
        status: "queued",
        sent_by: null,
      })
      .select("id")
      .single();
    const logId = (logRow as { id?: string } | null)?.id ?? null;

    // Resend-Call
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [recipient],
        subject,
        html: bodyHtml,
        reply_to: recipient,
      }),
    });
    const resBody = await res.json().catch(() => ({}));

    if (res.ok && logId) {
      const providerMessageId = (resBody as { id?: string }).id || null;
      await supabase
        .from("email_log")
        .update({ status: "sent", provider_message_id: providerMessageId })
        .eq("id", logId);
    } else if (logId) {
      const errMsg = (resBody as { message?: string }).message || `HTTP ${res.status}`;
      await supabase
        .from("email_log")
        .update({ status: "failed", error_message: errMsg })
        .eq("id", logId);
    }

    return logId;
  } catch (err) {
    console.error("Alert-Email fehlgeschlagen:", err);
    return null;
  }
}

async function getSetting(key: string, fallback: string): Promise<string> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return (data as { value?: string } | null)?.value || fallback;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

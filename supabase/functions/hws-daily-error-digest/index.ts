import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WAPI_TOKEN = Deno.env.get("WAPI_TOKEN");
const WAPI_BASE = "https://gate.whapi.cloud";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "hws" } });

async function getSetting(key: string): Promise<string | null> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

function formatPhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)\+]/g, "");
  if (cleaned.startsWith("0")) cleaned = `43${cleaned.slice(1)}`;
  return cleaned;
}

async function sendWhatsApp(to: string, message: string) {
  if (!WAPI_TOKEN) return;
  const recipient = to.includes("@") ? to : `${to}@s.whatsapp.net`;
  try {
    await fetch(`${WAPI_BASE}/messages/text`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WAPI_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: recipient, body: message }),
    });
  } catch (e) {
    console.error("WAPI send failed:", e);
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth: Service-Role oder cron_webhook_secret
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = await getSetting("cron_webhook_secret");
  if (!(serviceKey && token === serviceKey) && !(cronSecret && token === cronSecret)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Fehler aus whatsapp_messages mit [FEHLER]-Prefix in den letzten 24h
    const { data: errorMsgs } = await supabase
      .from("whatsapp_messages")
      .select("phone, message_body, created_at")
      .eq("direction", "outgoing")
      .ilike("message_body", "[FEHLER]%")
      .gte("created_at", since)
      .order("created_at", { ascending: false });

    const errorCount = (errorMsgs || []).length;

    // Admin-Digest-Empfänger: alle Admins mit whatsapp_aktiv=true
    const { data: adminProfiles } = await supabase
      .from("profiles").select("id").eq("is_active", true);
    const adminIds: string[] = [];
    for (const p of (adminProfiles as any[]) || []) {
      const { data: role } = await supabase
        .from("user_roles").select("role").eq("user_id", p.id).maybeSingle();
      if (role?.role === "administrator") adminIds.push(p.id);
    }

    if (errorCount < 5) {
      // Kein Alarm nötig
      return new Response(JSON.stringify({ ok: true, sent: 0, errors: errorCount }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: admins } = await (supabase.from("employees" as never) as any)
      .select("user_id, telefon, vorname")
      .eq("aktiv", true)
      .eq("whatsapp_aktiv", true)
      .in("user_id", adminIds)
      .not("telefon", "is", null);

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dateLabel = yesterday.toLocaleDateString("de-AT");

    const sample = (errorMsgs || []).slice(0, 3).map((e: any) => {
      const phoneShort = e.phone?.slice(0, 5) + "****" + e.phone?.slice(-3);
      const body = String(e.message_body).replace("[FEHLER] ", "").slice(0, 80);
      return `• ${phoneShort}: ${body}`;
    }).join("\n");

    const digest = `⚠️ *Bot-Fehler-Digest* (24h / ${dateLabel})

${errorCount} Fehler-Antworten an Mitarbeiter erkannt.

Letzte Beispiele:
${sample}

Bitte in den Supabase-Function-Logs (whatsapp-webhook) prüfen.`;

    let sent = 0;
    for (const a of ((admins as any[]) || [])) {
      if (!a.telefon) continue;
      await sendWhatsApp(formatPhone(a.telefon), digest);
      sent++;
    }

    return new Response(JSON.stringify({ ok: true, errors: errorCount, sent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("digest error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

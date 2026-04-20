import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WAPI_TOKEN = Deno.env.get("WAPI_TOKEN");
const WAPI_BASE = "https://gate.whapi.cloud";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

function formatPhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)\+]/g, "");
  if (cleaned.startsWith("0")) cleaned = `43${cleaned.slice(1)}`;
  return cleaned;
}

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let pw = "";
  for (let i = 0; i < 8; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

async function sendWhatsApp(to: string, message: string) {
  if (!WAPI_TOKEN) throw new Error("WAPI_TOKEN nicht konfiguriert");
  const recipient = to.includes("@") ? to : `${to}@s.whatsapp.net`;
  const res = await fetch(`${WAPI_BASE}/messages/text`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WAPI_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to: recipient, body: message }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.sent === false || body?.error) {
    throw new Error(`WAPI: ${body?.error?.message || body?.message || `HTTP ${res.status}`}`);
  }
  return body;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Aus Sicherheitsgründen immer dieselbe generische Antwort, damit Angreifer
  // keine User-Existenz ausforschen können.
  const vague = (extra?: Record<string, unknown>) =>
    new Response(JSON.stringify({
      ok: true,
      message: "Falls der Benutzername existiert und per WhatsApp erreichbar ist, wurde ein neues Passwort geschickt.",
      ...extra,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { username } = await req.json();
    if (!username || typeof username !== "string") {
      return new Response(JSON.stringify({ error: "Benutzername fehlt" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanUsername = username.toLowerCase().trim();

    // Rate-Limit: max. 1 Reset pro Benutzername pro Stunde
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentResets } = await supabase
      .from("whatsapp_messages")
      .select("id")
      .eq("message_type", "password_reset")
      .eq("message_body", cleanUsername)
      .gte("created_at", oneHourAgo)
      .limit(1);
    if (recentResets && recentResets.length > 0) {
      console.log("Rate-limit hit for username:", cleanUsername);
      return vague();
    }

    // User finden
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, vorname")
      .eq("username", cleanUsername)
      .eq("is_active", true)
      .maybeSingle();

    if (!profile) {
      // Auch Log, aber neutrale Antwort
      await supabase.from("whatsapp_messages").insert({
        phone: "n/a", direction: "incoming",
        message_body: cleanUsername, message_type: "password_reset",
        processed: true,
      });
      return vague();
    }

    // Employees-Datensatz + Telefon holen, whatsapp_aktiv prüfen
    const { data: emp } = await (supabase.from("employees" as never) as any)
      .select("telefon, whatsapp_aktiv, vorname")
      .eq("user_id", profile.id)
      .maybeSingle();

    if (!emp?.telefon || !emp?.whatsapp_aktiv) {
      console.log("User has no whatsapp setup:", cleanUsername);
      return vague();
    }

    // Neues temporäres Passwort + Auth-User updaten
    const tempPassword = generatePassword();
    const { error: authErr } = await supabase.auth.admin.updateUserById(profile.id, {
      password: tempPassword,
    });
    if (authErr) {
      console.error("Password update failed:", authErr);
      return vague();
    }

    // must_change_password=true → zwingt beim nächsten Login zur Änderung
    await supabase.from("profiles")
      .update({ must_change_password: true })
      .eq("id", profile.id);

    // WhatsApp-Nachricht schicken
    const vorname = profile.vorname || emp.vorname || "";
    const msg = `Hallo ${vorname}! 🔐

Du hast ein neues Passwort angefordert. Hier sind deine Zugangsdaten:

👤 Benutzer: *${cleanUsername}*
🔑 Passwort: *${tempPassword}*

Beim nächsten Login musst du das Passwort ändern.

Falls du das nicht selbst angefordert hast, melde dich bitte im Büro.`;

    const waPhone = formatPhone(emp.telefon);
    try {
      await sendWhatsApp(waPhone, msg);
    } catch (e: any) {
      console.error("WhatsApp send failed:", e.message);
      return vague();
    }

    // Rate-Limit-Marker + Audit-Log
    await supabase.from("whatsapp_messages").insert({
      phone: waPhone, direction: "outgoing",
      message_body: cleanUsername, message_type: "password_reset",
      employee_id: null, user_id: profile.id, processed: true,
    });

    return vague({ delivered: true });
  } catch (err: any) {
    console.error("forgot-password error:", err);
    return vague();
  }
});

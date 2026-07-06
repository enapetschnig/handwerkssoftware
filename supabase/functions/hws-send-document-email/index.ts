// Edge-Function: Email-Versand von Belegen über Resend
// Eingang vom Client:
//   - invoice_id (für Audit)
//   - to (Empfänger), cc (optional), reply_to (optional, sonst Default)
//   - subject, body_html
//   - pdf_base64 (vom Client generiert) + pdf_filename
// Ausgang:
//   { ok: true, log_id, provider_message_id } bei Erfolg
//   { ok: false, error } bei Fehler — UND es wird ein email_log-Eintrag
//   mit status='failed' geschrieben

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "bks@handwerkapp.at";
const EMAIL_DEFAULT_REPLY_TO = Deno.env.get("EMAIL_DEFAULT_REPLY_TO") || "montage@monti.pro";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SendBody {
  invoice_id?: string | null;
  to: string;
  cc?: string[];
  reply_to?: string;
  subject: string;
  body_html: string;
  pdf_base64?: string | null;
  pdf_filename?: string | null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: User-JWT validieren (nur eingeloggte Admin/Vorarbeiter dürfen senden)
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return new Response(
      JSON.stringify({ ok: false, error: "Unauthorized: kein Token" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabaseAuth = createClient(supabaseUrl, supabaseServiceKey, { db: { schema: "hws" } });
  const { data: { user: caller }, error: authErr } = await supabaseAuth.auth.getUser(token);
  if (authErr || !caller) {
    return new Response(
      JSON.stringify({ ok: false, error: "Unauthorized: ungültiges Token" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const { data: roleRow } = await supabaseAuth
    .from("user_roles")
    .select("role")
    .eq("user_id", caller.id)
    .maybeSingle();
  const role = (roleRow as { role?: string } | null)?.role;
  if (role !== "administrator" && role !== "vorarbeiter") {
    return new Response(
      JSON.stringify({ ok: false, error: "Nur Admin/Vorarbeiter dürfen Emails versenden." }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Body parsen
  let body: SendBody;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "Ungültiger Request-Body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Minimale Validierung
  if (!body.to || !body.to.includes("@")) {
    return new Response(
      JSON.stringify({ ok: false, error: "Empfänger-Email fehlt oder ungültig" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  if (!body.subject?.trim()) {
    return new Response(
      JSON.stringify({ ok: false, error: "Betreff fehlt" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  if (!body.body_html?.trim()) {
    return new Response(
      JSON.stringify({ ok: false, error: "Body fehlt" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  if (!RESEND_API_KEY) {
    return new Response(
      JSON.stringify({ ok: false, error: "RESEND_API_KEY nicht konfiguriert" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const replyTo = body.reply_to?.trim() || EMAIL_DEFAULT_REPLY_TO;

  // Vorab einen email_log-Eintrag (queued) anlegen — damit auch bei
  // späterem Crash der Audit-Trail steht
  const insertPayload = {
    invoice_id: body.invoice_id || null,
    to_address: body.to,
    cc_addresses: body.cc && body.cc.length > 0 ? body.cc : null,
    reply_to: replyTo,
    subject: body.subject,
    body_html: body.body_html,
    attachment_filename: body.pdf_filename || null,
    provider: "resend",
    status: "queued",
    sent_by: caller.id,
  };
  const { data: logRow, error: logErr } = await supabaseAuth
    .from("email_log")
    .insert(insertPayload)
    .select("id")
    .single();
  if (logErr) {
    console.error("email_log insert failed:", logErr);
    return new Response(
      JSON.stringify({ ok: false, error: `Audit-Log konnte nicht erstellt werden: ${logErr.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const logId = (logRow as { id: string }).id;

  // Resend-Payload bauen
  const resendPayload: Record<string, unknown> = {
    from: RESEND_FROM_EMAIL,
    to: [body.to],
    subject: body.subject,
    html: body.body_html,
    reply_to: replyTo,
  };
  if (body.cc && body.cc.length > 0) {
    resendPayload.cc = body.cc;
  }
  if (body.pdf_base64 && body.pdf_filename) {
    resendPayload.attachments = [
      {
        filename: body.pdf_filename,
        content: body.pdf_base64,
      },
    ];
  }

  // Resend aufrufen
  let providerMessageId: string | null = null;
  let resendErrorMsg: string | null = null;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendPayload),
    });
    const resBody = await res.json().catch(() => ({}));
    if (!res.ok) {
      resendErrorMsg = (resBody as { message?: string; name?: string }).message
        || (resBody as { name?: string }).name
        || `HTTP ${res.status}`;
    } else {
      providerMessageId = (resBody as { id?: string }).id || null;
    }
  } catch (err) {
    resendErrorMsg = (err as Error).message || "Unbekannter Fehler beim Resend-Aufruf";
  }

  // email_log aktualisieren
  if (resendErrorMsg) {
    await supabaseAuth
      .from("email_log")
      .update({ status: "failed", error_message: resendErrorMsg })
      .eq("id", logId);
    return new Response(
      JSON.stringify({ ok: false, error: resendErrorMsg, log_id: logId }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  await supabaseAuth
    .from("email_log")
    .update({ status: "sent", provider_message_id: providerMessageId })
    .eq("id", logId);

  return new Response(
    JSON.stringify({ ok: true, log_id: logId, provider_message_id: providerMessageId }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

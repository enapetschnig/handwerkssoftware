import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const WAPI_TOKEN = Deno.env.get("WAPI_TOKEN")!;
const WAPI_BASE = "https://gate.whapi.cloud";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

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

function buildOnboardingMessage(
  vorname: string,
  projectList: string,
  creds?: { username?: string; password?: string; appUrl?: string }
): string {
  const credsBlock = creds?.username && creds?.password
    ? `\n🔐 *Deine Zugangsdaten zur App:*\n${creds.appUrl ? `🌐 ${creds.appUrl}\n` : ""}👤 Benutzer: *${creds.username}*\n🔑 Passwort: *${creds.password}*\n_Beim ersten Login musst du das Passwort ändern._\n`
    : "";

  return `Hey ${vorname}! 👋 Ich bin der *BKS Assistent*.

Willkommen bei *BKS BauKomplettService*!
${credsBlock}
Ab jetzt kannst du deine Stunden einfach hier per WhatsApp schreiben – kein Zettel, keine App nötig.

*So geht's:*
Ich zeig dir die Projekte, du antwortest mit Nummer + Stunden. Fertig. ✓

${projectList}

*Beispiel:* Antwort _"1 8h Kabel verlegt"_ → bucht 8h auf Projekt 1

📸 *Foto?* Einfach schicken mit Projektname als Beschreibung
🎤 *Sprachnachricht?* Geht auch – ich versteh dich
📋 *Einteilung?* Frag _"Wo muss ich hin?"_

Das war's schon – probier's gleich aus! 🚀`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
    } = await supabase.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (role?.role !== "administrator") {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { employee_id, username, password, app_url } = await req.json();
    if (!employee_id) {
      return new Response(
        JSON.stringify({ error: "employee_id required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get employee data
    const { data: emp } = await supabase
      .from("employees")
      .select("id, vorname, nachname, telefon, user_id, whatsapp_aktiv")
      .eq("id", employee_id)
      .maybeSingle();

    if (!emp) {
      return new Response(
        JSON.stringify({ error: "Employee not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!emp.telefon) {
      return new Response(
        JSON.stringify({ error: "Keine Telefonnummer hinterlegt" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Nur die für diesen User sichtbaren Projekte anzeigen.
    // Zentrale Quelle: RPC list_accessible_project_ids_for_user.
    // Admin/Vorarbeiter: alle; Mitarbeiter: nur seine zugewiesenen.
    let accessibleProjects: { name: string }[] = [];
    if (emp.user_id) {
      const { data: accData, error: accErr } = await supabase.rpc(
        "list_accessible_project_ids_for_user",
        { p_user_id: emp.user_id, p_only_active: true },
      );
      if (accErr) console.error("RPC list_accessible_project_ids_for_user:", accErr);
      accessibleProjects = ((accData as any[]) || []).map((p: any) => ({ name: p.name }));
    }

    let projectList = "*Deine Projekte:*\n";
    if (accessibleProjects.length > 0) {
      accessibleProjects.forEach((p, i) => {
        projectList += `${i + 1}. ${p.name}\n`;
      });
    } else {
      projectList += "_Noch keine Projekte zugewiesen — Admin weist dir Projekte zu._\n";
    }

    const waPhone = formatPhone(emp.telefon);
    const message = buildOnboardingMessage(emp.vorname, projectList, {
      username,
      password,
      appUrl: app_url,
    });

    if (!WAPI_TOKEN) {
      return new Response(JSON.stringify({ error: "WAPI_TOKEN nicht konfiguriert" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send onboarding message
    try {
      await sendWhatsApp(waPhone, message);
    } catch (sendErr: any) {
      console.error("WAPI send failed:", sendErr);
      return new Response(JSON.stringify({
        error: sendErr.message || "WhatsApp konnte nicht gesendet werden",
        phone: waPhone,
      }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Log the message
    await supabase.from("whatsapp_messages").insert({
      phone: waPhone,
      direction: "outgoing",
      message_body: message,
      employee_id: emp.id,
      user_id: emp.user_id,
      processed: true,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        sent_to: `${emp.vorname} ${emp.nachname}`,
        phone: waPhone,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Onboarding error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

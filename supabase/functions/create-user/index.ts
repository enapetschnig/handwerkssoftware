import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller } } = await supabase.auth.getUser(token);
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check caller is admin
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .maybeSingle();

    if (roleData?.role !== "administrator") {
      return new Response(JSON.stringify({ error: "Nur Administratoren können Benutzer erstellen" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      username, password, rolle,
      vorname, nachname, telefon, email,
      adresse, plz, ort,
      geburtsdatum, sv_nummer, eintrittsdatum, stundenlohn,
    } = await req.json();

    if (!username || !password || !vorname || !nachname) {
      return new Response(JSON.stringify({ error: "Benutzername, Passwort, Vor- und Nachname sind Pflicht" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check username uniqueness
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", username.toLowerCase().trim())
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ error: "Benutzername bereits vergeben" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create auth user with internal email
    const internalEmail = `${username.toLowerCase().trim()}@app.monti.pro`;
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: internalEmail,
      password,
      email_confirm: true, // skip email verification
      user_metadata: {
        vorname,
        nachname,
        username: username.toLowerCase().trim(),
      },
    });

    if (authError) {
      console.error("Auth error:", authError);
      return new Response(JSON.stringify({ error: authError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = authData.user.id;

    // Update profile with all data
    await supabase.from("profiles").update({
      vorname,
      nachname,
      username: username.toLowerCase().trim(),
      must_change_password: true,
      is_active: true,
      telefon: telefon || null,
      email: email || null,
      adresse: adresse || null,
      plz: plz || null,
      ort: ort || null,
      geburtsdatum: geburtsdatum || null,
      sv_nummer: sv_nummer || null,
      eintrittsdatum: eintrittsdatum || null,
      stundenlohn: stundenlohn ? parseFloat(stundenlohn) : null,
    }).eq("id", userId);

    // Set role
    const userRole = rolle || "mitarbeiter";
    await supabase.from("user_roles").upsert({
      user_id: userId,
      role: userRole,
    }, { onConflict: "user_id" });

    return new Response(JSON.stringify({
      success: true,
      user_id: userId,
      username: username.toLowerCase().trim(),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Create user error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

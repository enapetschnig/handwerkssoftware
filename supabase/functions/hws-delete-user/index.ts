// User-Delete mit Daten-Erhaltung.
//
// Ablauf (Migration 20260615120000):
//   1. Admin-JWT validieren.
//   2. Snapshot in deleted_users_archive anlegen — Stammdaten aus
//      employees + profiles + auth.users sichern.
//   3. Auf historischen Tabellen (time_entries, employees, einsaetze,
//      documents, reports) den Bezug zur Archiv-ID setzen, BEVOR der
//      User geloescht wird. Die FKs sind via Migration auf
//      ON DELETE SET NULL — die user_id wird also nach dem Auth-Delete
//      sowieso null. Die archived_user_id-Spalte sorgt dafuer, dass
//      wir den Bezug trotzdem behalten.
//   4. *_by-Spalten (approved_by, sent_by, ...) genullen — wie zuvor.
//   5. user_roles loeschen (die haben CASCADE).
//   6. auth.admin.deleteUser — CASCADE entfernt profiles, sessions,
//      user_roles, mfa-Faktoren etc. Aber:
//        - time_entries.user_id wird durch SET NULL auf null gesetzt,
//          archived_user_id zeigt auf den Snapshot
//        - employees.user_id, documents.user_id, einsaetze.user_id,
//          reports.user_id ebenfalls SET NULL mit Archiv-Bezug

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey, { db: { schema: "hws" } });

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── Admin-Check ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller } } = await supabase.auth.getUser(token);
    if (!caller) return jsonResponse({ error: "Unauthorized" }, 401);

    const { data: roleData } = await supabase
      .from("user_roles").select("role").eq("user_id", caller.id).maybeSingle();
    if (roleData?.role !== "administrator") {
      return jsonResponse({ error: "Nur Administratoren" }, 403);
    }

    const { user_id, notiz } = await req.json();
    if (!user_id) return jsonResponse({ error: "user_id erforderlich" }, 400);
    if (user_id === caller.id) {
      return jsonResponse({ error: "Du kannst dich nicht selbst löschen" }, 400);
    }

    // ── 1. Stammdaten lesen ──
    const [employeeRes, profileRes, authRes, roleRes] = await Promise.all([
      supabase.from("employees").select("*").eq("user_id", user_id).maybeSingle(),
      supabase.from("profiles").select("*").eq("id", user_id).maybeSingle(),
      supabase.auth.admin.getUserById(user_id),
      supabase.from("user_roles").select("role").eq("user_id", user_id).maybeSingle(),
    ]);
    const employee = employeeRes.data as Record<string, unknown> | null;
    const profile = profileRes.data as Record<string, unknown> | null;
    const authUser = authRes.data?.user;
    const role = (roleRes.data as { role?: string } | null)?.role || null;

    const pick = (...vals: unknown[]) =>
      vals.find((v) => v !== null && v !== undefined && v !== "") as string | null;

    // ── 2. Archiv-Snapshot anlegen ──
    const archivePayload = {
      original_user_id: user_id,
      email: pick(authUser?.email, profile?.email, authUser?.user_metadata?.email),
      vorname: pick(employee?.vorname, profile?.vorname, authUser?.user_metadata?.vorname),
      nachname: pick(employee?.nachname, profile?.nachname, authUser?.user_metadata?.nachname),
      username: pick(profile?.username, authUser?.user_metadata?.username),
      telefon: pick(employee?.telefon, profile?.telefon),
      adresse: pick(profile?.adresse),
      plz: pick(profile?.plz),
      ort: pick(profile?.ort),
      land: pick(profile?.land),
      austritt_datum: employee?.austritt_datum || null,
      rolle: role,
      employee_snapshot: employee,
      profile_snapshot: profile,
      auth_meta_snapshot: authUser ? {
        email: authUser.email,
        phone: authUser.phone,
        created_at: authUser.created_at,
        user_metadata: authUser.user_metadata,
        app_metadata: authUser.app_metadata,
      } : null,
      deleted_by: caller.id,
      notiz: notiz || null,
    };

    const { data: archiveRow, error: archiveErr } = await supabase
      .from("deleted_users_archive")
      .insert(archivePayload)
      .select("id")
      .single();
    if (archiveErr) {
      console.error("Archive-Snapshot fehlgeschlagen:", archiveErr);
      return jsonResponse({
        error: `Archiv-Snapshot fehlgeschlagen: ${archiveErr.message}. Loeschung abgebrochen.`,
      }, 500);
    }
    const archiveId = (archiveRow as { id: string }).id;

    // ── 3. archived_user_id auf historischen Tabellen setzen ──
    // Diese muessen VOR dem auth-Delete passieren — danach ist user_id
    // bereits via SET NULL auf NULL und unsere WHERE-Klausel findet nichts mehr.
    const archiveBindings: Array<[string, string]> = [
      ["time_entries", "user_id"],
      ["employees", "user_id"],
      ["documents", "user_id"],
      ["einsaetze", "user_id"],
      ["reports", "user_id"],
    ];
    const bindCounts: Record<string, number> = {};
    for (const [tab, col] of archiveBindings) {
      const { error, count } = await (supabase.from(tab as never) as any)
        .update({ archived_user_id: archiveId }, { count: "exact" })
        .eq(col, user_id);
      if (error) {
        console.error(`archive-bind ${tab}.${col} fehlgeschlagen:`, error.message);
      }
      bindCounts[tab] = count ?? 0;
    }

    // ── 4. *_by-Spalten genullen (analog zur alten Implementation) ──
    const nullifyRefs: Array<[string, string]> = [
      ["projects", "user_id"],
      ["projects", "erfasst_von"],
      ["time_entries", "approved_by"],
      ["time_entries", "nachgetragen_von"],
      ["invitation_logs", "gesendet_von"],
      ["whatsapp_messages", "user_id"],
      ["contact_history", "erstellt_von"],
      ["bautagesberichte", "erstellt_von"],
      ["bautagesbericht_photos", "user_id"],
      ["ersttermin_interessent", "erstellt_von"],
      ["ersttermin_interessent_photos", "user_id"],
      ["ersttermin_projekt", "erstellt_von"],
      ["besprechungsprotokolle", "erstellt_von"],
      ["teams", "created_by"],
      ["board_projects", "created_by"],
      ["einsaetze", "created_by"],
      ["audit_log", "user_id"],
    ];
    for (const [tab, col] of nullifyRefs) {
      const { error } = await (supabase.from(tab as never) as any)
        .update({ [col]: null })
        .eq(col, user_id);
      if (error) console.error(`nullify ${tab}.${col} failed: ${error.message}`);
    }

    // ── 5. user_roles loeschen (CASCADE wuerde es eh tun, aber explizit) ──
    await supabase.from("user_roles").delete().eq("user_id", user_id);

    // ── 6. Auth-User loeschen ──
    // CASCADE entfernt jetzt profiles, sessions, mfa-Faktoren etc.
    // Die geschuetzten Tabellen (time_entries, employees, documents,
    // einsaetze, reports) haben SET NULL — Daten bleiben mit Archiv-Bezug.
    const { error: authErr } = await supabase.auth.admin.deleteUser(user_id);
    if (authErr) {
      console.error("Auth delete error:", authErr);
      return jsonResponse({
        error: `Auth-User-Delete fehlgeschlagen: ${authErr.message}. Archiv-Eintrag ${archiveId} wurde angelegt, Bindings wurden gesetzt — Mitarbeiter ist im UI verschwunden, Daten sind aber gesichert.`,
      }, 500);
    }

    return jsonResponse({
      success: true,
      archive_id: archiveId,
      preserved: bindCounts,
      summary: `${(archivePayload.vorname || "") + " " + (archivePayload.nachname || "")} archiviert (${Object.values(bindCounts).reduce((a, b) => a + b, 0)} historische Eintraege bewahrt).`,
    });
  } catch (err: unknown) {
    const msg = (err as Error).message || String(err);
    console.error("delete-user error:", msg);
    return jsonResponse({ error: msg }, 500);
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

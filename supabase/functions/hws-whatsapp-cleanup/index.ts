import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "hws" } });

async function getSetting(key: string): Promise<string | null> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth: Service-Role-Key oder cron_webhook_secret (vom pg_cron)
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const dbCronSecret = await getSetting("cron_webhook_secret");
  if (!(serviceKey && token === serviceKey) && !(dbCronSecret && token === dbCronSecret)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let task = "temp_storage";
  try {
    const body = await req.json();
    if (body?.task) task = String(body.task);
  } catch { /* empty body ok */ }

  try {
    if (task === "temp_storage") {
      // WhatsApp temp-Bilder: alles unter project-photos/whatsapp-temp/** mit
      // last_modified älter als 24h.
      const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
      const deleted: string[] = [];
      let scanned = 0;

      // Erstens: alle Phone-Unterordner auflisten
      const { data: phoneDirs, error: listErr } = await supabase.storage
        .from("project-photos")
        .list("whatsapp-temp", { limit: 1000 });
      if (listErr) {
        console.error("List whatsapp-temp failed:", listErr);
        return new Response(JSON.stringify({ error: listErr.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      for (const dir of phoneDirs || []) {
        // Nur "Ordner" (die Telefon-Unterpfade haben kein metadata)
        const phoneDir = dir.name;
        const { data: files } = await supabase.storage
          .from("project-photos")
          .list(`whatsapp-temp/${phoneDir}`, { limit: 1000 });
        if (!files) continue;

        for (const f of files) {
          scanned++;
          const updated = f.updated_at ? new Date(f.updated_at).getTime() : 0;
          if (updated && updated < cutoffMs) {
            deleted.push(`whatsapp-temp/${phoneDir}/${f.name}`);
          }
        }
      }

      if (deleted.length > 0) {
        const { error: delErr } = await supabase.storage
          .from("project-photos")
          .remove(deleted);
        if (delErr) {
          console.error("Remove failed:", delErr);
          return new Response(JSON.stringify({ error: delErr.message, scanned, deleted: 0 }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      return new Response(JSON.stringify({ ok: true, scanned, deleted: deleted.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown task: ${task}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("cleanup error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Voice message -> structured Angebot (offer).
// Whisper (de) transcription + GPT JSON extraction. No DB access; the client
// performs the insert using the existing offer-creation path.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

const VALID_UNITS = "Stk., m², m³, lfm, kg, h, Std., Tag, Sack, Eimer, Pkg., Pauschal";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { audioBase64, knownCustomers }: {
      audioBase64: string;
      knownCustomers?: string[];
    } = await req.json();

    if (!audioBase64) {
      return new Response(JSON.stringify({ error: "Audio data required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // 1) Whisper transcription (German)
    const audioBytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    const form = new FormData();
    form.append("file", new Blob([audioBytes], { type: "audio/webm" }), "audio.webm");
    form.append("model", "whisper-1");
    form.append("language", "de");

    const whisper = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });
    if (!whisper.ok) {
      const err = await whisper.text();
      return new Response(JSON.stringify({ error: "Transkription fehlgeschlagen", details: err }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }
    const { text: transcript } = await whisper.json();
    if (!transcript || transcript.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Keine Sprache erkannt", transcript: "" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // 2) GPT extraction -> Angebot JSON
    const customerContext = knownCustomers && knownCustomers.length
      ? `\nBekannte Kunden (ordne den gesprochenen Namen dem passendsten zu, sonst neuer Kunde):\n${knownCustomers.slice(0, 200).join(", ")}`
      : "";

    const systemPrompt = `Du bist ein Assistent, der aus einer gesprochenen deutschen Nachricht ein ANGEBOT für einen Elektro-/Handwerksbetrieb erstellt.
Der Benutzer diktiert Kunde, Arbeiten und Materialien, teils mit Mengen und Preisen.

Regeln:
1. Extrahiere den Kundennamen falls genannt (Feld "customer"), sonst leer lassen.
2. Erzeuge eine Position pro genannter Leistung/Material.
3. "quantity": genannte Menge, sonst 1. "unit": passende Einheit aus: ${VALID_UNITS} (Standard "Stk.", für Arbeitszeit "h", für Pauschalen "Pauschal").
4. "unitPrice": genannter Netto-Einzelpreis in Euro; wenn KEIN Preis genannt wird, 0.
5. "title": kurzer Betreff des Angebots (z.B. "Elektroinstallation Neubau"). "notes": sonstige Hinweise/Anmerkungen, sonst leer.
6. Rechne Zahlwörter in Zahlen um ("zweihundert" -> 200).${customerContext}

Antworte NUR mit validem JSON in exakt dieser Form:
{"customer":"","title":"","notes":"","positions":[{"description":"","quantity":1,"unit":"Stk.","unitPrice":0}]}
Wenn nichts erkennbar ist: {"customer":"","title":"","notes":"","positions":[]}`;

    const chat = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.1,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: transcript },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!chat.ok) {
      const err = await chat.text();
      return new Response(JSON.stringify({ error: "KI-Verarbeitung fehlgeschlagen", transcript, details: err }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }
    const chatData = await chat.json();
    const content = chatData.choices?.[0]?.message?.content || "{}";
    let offer: { customer: string; title: string; notes: string; positions: unknown[] };
    try {
      const p = JSON.parse(content);
      offer = {
        customer: typeof p.customer === "string" ? p.customer : "",
        title: typeof p.title === "string" ? p.title : "",
        notes: typeof p.notes === "string" ? p.notes : "",
        positions: Array.isArray(p.positions) ? p.positions : [],
      };
    } catch {
      offer = { customer: "", title: "", notes: "", positions: [] };
    }

    return new Response(JSON.stringify({ transcript, offer }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
});

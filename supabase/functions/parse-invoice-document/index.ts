// Parse incoming invoice (image) via OpenAI GPT-4 Vision
// Input: { imageBase64: "data:image/jpeg;base64,..." }
// Output: structured invoice data

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

const SYSTEM_PROMPT = `Du bist ein Experte für österreichische Eingangsrechnungen und Belege.
Extrahiere aus dem Rechnungsbild folgende Felder und gib sie als reines JSON zurück (keine Markdown-Code-Blöcke):

{
  "lieferant": string (Firmenname des Rechnungsstellers),
  "rechnungsnummer": string | null,
  "rechnungsdatum": string im Format "YYYY-MM-DD" | null,
  "faellig_am": string im Format "YYYY-MM-DD" | null,
  "betrag_brutto": number (Bruttobetrag in Euro, Dezimalpunkt statt Komma),
  "betrag_netto": number | null,
  "ust_satz": 0 | 10 | 13 | 20 (Österreich: 0/10/13/20%),
  "kategorie": "material" | "fremdleistung" | "werkzeug" | "miete" | "treibstoff" | "buero" | "sonstiges",
  "notizen": string | null (Kurze Zusammenfassung der Positionen)
}

Regeln:
- Wenn du ein Feld nicht erkennst, setze es auf null
- Deutsche Zahlenformatierung: "1.234,56" → 1234.56
- USt-Satz nur aus {0, 10, 13, 20}. Bei unklaren Fällen: 20
- Kategorie intelligent raten anhand der Positionen
- Keine Erklärungen, nur das JSON`;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: "OPENAI_API_KEY nicht konfiguriert" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Auth-Check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { imageBase64 } = await req.json();
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return new Response(JSON.stringify({ error: "imageBase64 required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sicherstellen dass es eine Data-URL ist
    const dataUrl = imageBase64.startsWith("data:")
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // günstiger als gpt-4o, reicht für OCR
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extrahiere die Rechnungsdaten aus diesem Bild:" },
              { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 1000,
      }),
    });

    if (!openaiResponse.ok) {
      const errText = await openaiResponse.text();
      console.error("OpenAI error:", errText);
      return new Response(JSON.stringify({ error: "OpenAI-Fehler", details: errText.slice(0, 300) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const openaiData = await openaiResponse.json();
    const content = openaiData.choices?.[0]?.message?.content;
    if (!content) {
      return new Response(JSON.stringify({ error: "Keine Antwort von OpenAI" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // JSON aus Content extrahieren (falls in Markdown-Blöcken)
    let jsonText = content.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) jsonText = jsonMatch[1];

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return new Response(JSON.stringify({ error: "Antwort konnte nicht geparst werden", raw: content.slice(0, 300) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validation: erwartete Felder vorhanden
    if (typeof parsed !== "object" || parsed === null) {
      return new Response(JSON.stringify({ error: "Ungültige AI-Antwort" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, data: parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Parse error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

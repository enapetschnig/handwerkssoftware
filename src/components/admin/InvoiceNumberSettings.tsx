import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Hash, Save, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface NumberConfig {
  prefix: string;
  format: string;
  start_nummer: string;
  stellen: string;
}

function generatePreview(cfg: NumberConfig): string {
  const yy = String(new Date().getFullYear()).slice(-2);
  const yyyy = String(new Date().getFullYear());
  const num = parseInt(cfg.start_nummer) || 1;
  const st = parseInt(cfg.stellen) || 3;
  const padded = String(num).padStart(st, "0");

  let result = cfg.format || "{PREFIX}{YY}{NNN}";
  result = result.replace("{PREFIX}", cfg.prefix || "");
  result = result.replace("{YYYY}", yyyy);
  result = result.replace("{YY}", yy);
  result = result.replace("{NNN}", padded);
  result = result.replace("{N}", String(num));
  return result;
}

export function InvoiceNumberSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [rechnung, setRechnung] = useState<NumberConfig>({
    prefix: "", format: "{YY}{NNN}", start_nummer: "1", stellen: "3",
  });
  const [angebot, setAngebot] = useState<NumberConfig>({
    prefix: "AN", format: "{PREFIX}{YY}{NNN}", start_nummer: "1", stellen: "3",
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", [
        "rechnung_prefix", "rechnung_format", "rechnung_start_nummer", "rechnung_stellen",
        "angebot_prefix", "angebot_format", "angebot_start_nummer", "angebot_stellen",
      ]);

    if (data) {
      const map: Record<string, string> = {};
      data.forEach((r: any) => { map[r.key] = r.value; });

      setRechnung({
        prefix: map["rechnung_prefix"] || "",
        format: map["rechnung_format"] || "{YY}{NNN}",
        start_nummer: map["rechnung_start_nummer"] || "1",
        stellen: map["rechnung_stellen"] || "3",
      });
      setAngebot({
        prefix: map["angebot_prefix"] || "AN",
        format: map["angebot_format"] || "{PREFIX}{YY}{NNN}",
        start_nummer: map["angebot_start_nummer"] || "1",
        stellen: map["angebot_stellen"] || "3",
      });
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    const settings = [
      { key: "rechnung_prefix", value: rechnung.prefix },
      { key: "rechnung_format", value: rechnung.format },
      { key: "rechnung_start_nummer", value: rechnung.start_nummer },
      { key: "rechnung_stellen", value: rechnung.stellen },
      { key: "angebot_prefix", value: angebot.prefix },
      { key: "angebot_format", value: angebot.format },
      { key: "angebot_start_nummer", value: angebot.start_nummer },
      { key: "angebot_stellen", value: angebot.stellen },
    ];

    for (const s of settings) {
      await supabase.from("app_settings").upsert({ key: s.key, value: s.value }, { onConflict: "key" });
    }

    toast({ title: "Nummernkreise gespeichert" });
    setSaving(false);
  };

  const renderConfig = (label: string, cfg: NumberConfig, setCfg: (c: NumberConfig) => void, example: string) => (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">{label}</span>
        <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded">
          Vorschau: {generatePreview(cfg)}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <Label className="text-xs">Prefix</Label>
          <Input value={cfg.prefix} onChange={e => setCfg({ ...cfg, prefix: e.target.value })} placeholder="z.B. AN, RE" />
        </div>
        <div>
          <Label className="text-xs">Startnummer</Label>
          <Input type="number" min={1} value={cfg.start_nummer} onChange={e => setCfg({ ...cfg, start_nummer: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Stellen</Label>
          <Input type="number" min={2} max={6} value={cfg.stellen} onChange={e => setCfg({ ...cfg, stellen: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Format</Label>
          <Input value={cfg.format} onChange={e => setCfg({ ...cfg, format: e.target.value })} placeholder="{PREFIX}{YY}{NNN}" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{example}</p>
    </div>
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Hash className="h-5 w-5" />
          Nummernkreise
        </CardTitle>
        <CardDescription>
          Rechnungs- und Angebotsnummern konfigurieren. Platzhalter: {"{PREFIX}"}, {"{YY}"}/{"{YYYY}"}, {"{NNN}"} (mit Nullen) oder {"{N}"} (ohne).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {renderConfig(
          "Rechnungen",
          rechnung,
          setRechnung,
          "z.B. 26001 → Jahr 26, Nummer 001"
        )}
        {renderConfig(
          "Angebote",
          angebot,
          setAngebot,
          "z.B. AN26001 → Prefix AN, Jahr 26, Nummer 001"
        )}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Speichern...</> : <><Save className="h-4 w-4 mr-2" /> Speichern</>}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

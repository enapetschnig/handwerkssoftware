// Admin → Plantafel-Default-Farben: 5-10 Lieblings-Farben, die im
// AddProjectToBoardDialog oberhalb der Standard-Palette als
// "Bevorzugt" erscheinen. Speichert als JSON-Array in
// app_settings.plantafel_default_colors.
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Save, Trash2, Palette } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

export function PlantafelDefaultColors() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [colors, setColors] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await supabase
          .from("app_settings")
          .select("value")
          .eq("key", "plantafel_default_colors")
          .maybeSingle();
        if (cancelled) return;
        const raw = (data as { value?: string } | null)?.value;
        let next: string[] = [];
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              next = parsed.filter((c): c is string => typeof c === "string" && isHex(c));
            }
          } catch { /* tolerant */ }
        }
        setColors(next);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const addColor = () => {
    if (colors.length >= 10) {
      toast({ title: "Maximum erreicht", description: "Mehr als 10 Lieblings-Farben sind nicht sinnvoll." });
      return;
    }
    setColors([...colors, "#A7C7E7"]);
  };

  const updateColor = (idx: number, value: string) => {
    setColors(colors.map((c, i) => i === idx ? value : c));
  };

  const removeColor = (idx: number) => {
    setColors(colors.filter((_, i) => i !== idx));
  };

  const save = async () => {
    setSaving(true);
    try {
      const cleaned = colors.filter(isHex);
      const { error } = await supabase
        .from("app_settings")
        .upsert({ key: "plantafel_default_colors", value: JSON.stringify(cleaned) }, { onConflict: "key" });
      if (error) throw error;
      setColors(cleaned);
      toast({ title: "Lieblings-Farben gespeichert", description: `${cleaned.length} Farben aktiv` });
    } catch (err) {
      toast({ variant: "destructive", title: "Speichern fehlgeschlagen", description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-6"><Loader2 className="animate-spin" /></div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-5 w-5" /> Plantafel-Lieblings-Farben
        </CardTitle>
        <CardDescription>
          Diese Farben erscheinen im "Projekt hinzufügen"-Dialog der Plantafel als bevorzugte
          Auswahl oberhalb der Standard-Palette. Die erste Farbe ist Default.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {colors.length === 0 && (
          <p className="text-sm text-muted-foreground italic">
            Noch keine Lieblings-Farben definiert — Plantafel nutzt die Standard-Palette.
          </p>
        )}
        {colors.map((c, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <div
              className="w-10 h-10 rounded border shrink-0"
              style={{ backgroundColor: isHex(c) ? c : "#cccccc" }}
            />
            <Input
              type="color"
              value={isHex(c) ? c : "#A7C7E7"}
              onChange={(e) => updateColor(idx, e.target.value)}
              className="w-16 h-10 p-1 cursor-pointer"
            />
            <Input
              type="text"
              value={c}
              onChange={(e) => updateColor(idx, e.target.value)}
              placeholder="#RRGGBB"
              className="font-mono w-32"
            />
            <Label className="text-xs text-muted-foreground flex-1">
              Position {idx + 1}{idx === 0 ? " (Default)" : ""}
            </Label>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removeColor(idx)}
              className="text-red-500 hover:text-red-700"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={addColor} disabled={colors.length >= 10}>
            <Plus className="h-4 w-4 mr-2" /> Farbe hinzufügen
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Speichern
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

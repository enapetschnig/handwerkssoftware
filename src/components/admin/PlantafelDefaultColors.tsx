// Admin → Plantafel-Default-Farben: 5-10 Lieblings-Farben, die im
// AddProjectToBoardDialog oberhalb der Standard-Palette als
// "Bevorzugt" erscheinen. Speichert als JSON-Array {bg, text} in
// app_settings.plantafel_default_colors. text = "" → Auto-Kontrast.
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Save, Trash2, Palette } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { autoContrastText } from "@/components/schedule/scheduleUtils";

const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

type FavColor = { bg: string; text: string };

export function PlantafelDefaultColors() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [colors, setColors] = useState<FavColor[]>([]);

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
        let next: FavColor[] = [];
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              next = parsed
                .map((item: any): FavColor | null => {
                  // Altformat: reiner Hex-String → Textfarbe leer (Auto).
                  if (typeof item === "string" && isHex(item)) return { bg: item, text: "" };
                  if (item && typeof item === "object" && isHex(item.bg)) {
                    return { bg: item.bg, text: isHex(item.text) ? item.text : "" };
                  }
                  return null;
                })
                .filter((c): c is FavColor => c !== null);
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
    setColors([...colors, { bg: "#A7C7E7", text: "" }]);
  };

  const updateColor = (idx: number, field: keyof FavColor, value: string) => {
    setColors(colors.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  };

  const removeColor = (idx: number) => {
    setColors(colors.filter((_, i) => i !== idx));
  };

  const save = async () => {
    setSaving(true);
    try {
      const cleaned = colors
        .filter((c) => isHex(c.bg))
        .map((c) => ({ bg: c.bg, text: isHex(c.text) ? c.text : "" }));
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
          Auswahl oberhalb der Standard-Palette. Die erste Farbe ist Default. Lässt du die
          Textfarbe leer, wird sie automatisch passend (schwarz/weiß) zum Hintergrund gewählt.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {colors.length === 0 && (
          <p className="text-sm text-muted-foreground italic">
            Noch keine Lieblings-Farben definiert — Plantafel nutzt die Standard-Palette.
          </p>
        )}
        {colors.map((c, idx) => {
          const effectiveText = isHex(c.text) ? c.text : autoContrastText(c.bg);
          return (
            <div key={idx} className="flex flex-wrap items-center gap-2">
              {/* Vorschau: Text auf Hintergrund */}
              <div
                className="w-16 h-10 rounded border shrink-0 flex items-center justify-center text-xs font-semibold"
                style={{ backgroundColor: isHex(c.bg) ? c.bg : "#cccccc", color: effectiveText }}
              >
                Text
              </div>
              {/* Hintergrund */}
              <div className="flex items-center gap-1">
                <Label className="text-xs text-muted-foreground">Hintergrund</Label>
                <Input
                  type="color"
                  value={isHex(c.bg) ? c.bg : "#A7C7E7"}
                  onChange={(e) => updateColor(idx, "bg", e.target.value)}
                  className="w-12 h-10 p-1 cursor-pointer"
                />
              </div>
              {/* Text */}
              <div className="flex items-center gap-1">
                <Label className="text-xs text-muted-foreground">Text</Label>
                <Input
                  type="color"
                  value={isHex(c.text) ? c.text : effectiveText}
                  onChange={(e) => updateColor(idx, "text", e.target.value)}
                  className="w-12 h-10 p-1 cursor-pointer"
                />
                {isHex(c.text) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7 px-2 text-muted-foreground"
                    onClick={() => updateColor(idx, "text", "")}
                    title="Auf automatische Schriftfarbe zurücksetzen"
                  >
                    Auto
                  </Button>
                ) : (
                  <span className="text-[10px] text-muted-foreground w-8">auto</span>
                )}
              </div>
              <Label className="text-xs text-muted-foreground flex-1 min-w-[80px]">
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
          );
        })}
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

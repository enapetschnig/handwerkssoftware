import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Hash, Save, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface NumberRange {
  id: string;
  label: string;
  typ: string;
  prefix: string;
  format_pattern: string;
  start_number: number;
  current_number: number;
  stellen: number;
  year_format: "YY" | "YYYY";
}

function generatePreview(range: NumberRange): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const yyyy = String(now.getFullYear());
  const nextNum = Math.max(range.current_number, range.start_number) + 1;
  const paddedN = String(nextNum).padStart(range.stellen, "0");

  let result = range.format_pattern;
  result = result.replace("{PREFIX}", range.prefix);
  result = result.replace("{YYYY}", yyyy);
  result = result.replace("{YY}", yy);
  // Replace {NNN} style (padded) and {N} (raw number)
  result = result.replace(/\{N+\}/g, paddedN);
  result = result.replace("{N}", String(nextNum));

  return result;
}

export function NumberRangeSettings() {
  const { toast } = useToast();
  const [ranges, setRanges] = useState<NumberRange[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadRanges();
  }, []);

  const loadRanges = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("number_ranges" as never)
      .select("*")
      .order("label");

    if (error) {
      toast({ title: "Fehler beim Laden", description: error.message, variant: "destructive" });
    } else {
      setRanges((data ?? []) as NumberRange[]);
    }
    setLoading(false);
  };

  const updateRange = (index: number, field: keyof NumberRange, value: string | number) => {
    setRanges((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleSave = async () => {
    setSaving(true);

    const promises = ranges.map((range) =>
      supabase
        .from("number_ranges" as never)
        .update({
          prefix: range.prefix,
          format_pattern: range.format_pattern,
          start_number: range.start_number,
          stellen: range.stellen,
          year_format: range.year_format,
        } as never)
        .eq("id", range.id)
    );

    const results = await Promise.all(promises);
    const errors = results.filter((r) => r.error);

    if (errors.length > 0) {
      toast({
        title: "Fehler beim Speichern",
        description: errors[0].error?.message ?? "Unbekannter Fehler",
        variant: "destructive",
      });
    } else {
      toast({ title: "Nummernkreise gespeichert" });
      loadRanges();
    }
    setSaving(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Hash className="h-5 w-5" />
          Nummernkreise
        </CardTitle>
        <CardDescription>
          Konfigurieren Sie die Nummernformate für alle Dokumenttypen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : ranges.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Keine Nummernkreise konfiguriert.
          </p>
        ) : (
          <>
            <div className="space-y-6">
              {ranges.map((range, idx) => (
                <div
                  key={range.id}
                  className="grid gap-4 rounded-lg border p-4"
                >
                  {/* Row header */}
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{range.label}</span>
                    <span className="text-xs text-muted-foreground">
                      Aktuell: {range.current_number}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Prefix</Label>
                      <Input
                        value={range.prefix}
                        onChange={(e) => updateRange(idx, "prefix", e.target.value)}
                        placeholder="z.B. AN"
                      />
                    </div>

                    <div className="grid gap-1.5">
                      <Label className="text-xs">Format</Label>
                      <Input
                        value={range.format_pattern}
                        onChange={(e) => updateRange(idx, "format_pattern", e.target.value)}
                        placeholder="{PREFIX}{YY}{NNN}"
                      />
                    </div>

                    <div className="grid gap-1.5">
                      <Label className="text-xs">Startnummer</Label>
                      <Input
                        type="number"
                        min={1}
                        value={range.start_number}
                        onChange={(e) => updateRange(idx, "start_number", parseInt(e.target.value, 10) || 1)}
                      />
                    </div>

                    <div className="grid gap-1.5">
                      <Label className="text-xs">Stellen (2-6)</Label>
                      <Input
                        type="number"
                        min={2}
                        max={6}
                        value={range.stellen}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (v >= 2 && v <= 6) updateRange(idx, "stellen", v);
                        }}
                      />
                    </div>

                    <div className="grid gap-1.5">
                      <Label className="text-xs">Jahresformat</Label>
                      <Select
                        value={range.year_format}
                        onValueChange={(val) => updateRange(idx, "year_format", val)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="YY">YY (z.B. 26)</SelectItem>
                          <SelectItem value="YYYY">YYYY (z.B. 2026)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Preview */}
                  <div className="text-xs text-muted-foreground">
                    Vorschau nächste Nummer:{" "}
                    <span className="font-mono font-medium text-foreground">
                      {generatePreview(range)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Format help */}
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium">Platzhalter im Format:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li><code className="font-mono">{"{PREFIX}"}</code> - Prefix (z.B. AN, RE)</li>
                <li><code className="font-mono">{"{YY}"}</code> - Jahr zweistellig (z.B. 26)</li>
                <li><code className="font-mono">{"{YYYY}"}</code> - Jahr vierstellig (z.B. 2026)</li>
                <li><code className="font-mono">{"{NNN}"}</code> - Laufende Nummer mit konfigurierten Stellen</li>
                <li><code className="font-mono">{"{N}"}</code> - Laufende Nummer ohne Nullen</li>
              </ul>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Speichern...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Speichern
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

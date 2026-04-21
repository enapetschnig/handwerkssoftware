import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Search, Calculator } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface SetComponent {
  /** Row-ID in invoice_template_components, nur gesetzt wenn bereits persistiert. */
  id?: string;
  component_template_id: string;
  component_name: string;
  component_einheit: string;
  component_netto_preis: number;
  menge: number;
  sort_order: number;
}

interface MaterialOption {
  id: string;
  name: string;
  kurzbezeichnung: string | null;
  einheit: string;
  netto_preis: number;
  produktgruppe: string | null;
}

interface MaterialSetEditorProps {
  components: SetComponent[];
  onChange: (components: SetComponent[]) => void;
  onRecalcPrice?: (netto: number) => void;
}

/**
 * Editor für Material-Sets (Stücklisten).
 * Zeigt die Komponenten einer Stückliste als editierbare Liste, erlaubt
 * Hinzufügen aus dem Katalog (gefiltert auf ist_set=false — keine
 * Verschachtelung), Menge ändern, Entfernen. Berechnet die Gesamt-
 * Nettokosten des Sets live.
 */
export function MaterialSetEditor({ components, onChange, onRecalcPrice }: MaterialSetEditorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [options, setOptions] = useState<MaterialOption[]>([]);
  const [pickerSearch, setPickerSearch] = useState("");

  const loadOptions = async () => {
    const { data } = await supabase
      .from("invoice_templates")
      .select("id, name, kurzbezeichnung, einheit, einzelpreis, kategorie, ist_set")
      .eq("ist_set", false)
      .order("kategorie")
      .order("name")
      .limit(5000);
    setOptions(((data as any[]) || []).map(d => ({
      id: d.id,
      name: d.name,
      kurzbezeichnung: d.kurzbezeichnung ?? null,
      einheit: d.einheit || "Stk.",
      netto_preis: Number(d.einzelpreis) || 0,
      produktgruppe: d.kategorie || "Allgemein",
    })));
  };

  useEffect(() => {
    if (pickerOpen) {
      loadOptions();
      setPickerSearch("");
    }
  }, [pickerOpen]);

  const addComponent = (opt: MaterialOption) => {
    if (components.some(c => c.component_template_id === opt.id)) return;
    const nextSort = components.length > 0 ? Math.max(...components.map(c => c.sort_order)) + 1 : 0;
    onChange([
      ...components,
      {
        component_template_id: opt.id,
        component_name: opt.kurzbezeichnung || opt.name,
        component_einheit: opt.einheit,
        component_netto_preis: opt.netto_preis,
        menge: 1,
        sort_order: nextSort,
      },
    ]);
  };

  const updateMenge = (componentTemplateId: string, menge: number) => {
    onChange(components.map(c => c.component_template_id === componentTemplateId ? { ...c, menge } : c));
  };

  const removeComponent = (componentTemplateId: string) => {
    onChange(components.filter(c => c.component_template_id !== componentTemplateId));
  };

  const netto = useMemo(
    () => components.reduce((s, c) => s + (Number(c.component_netto_preis) || 0) * (Number(c.menge) || 0), 0),
    [components],
  );

  const s = pickerSearch.trim().toLowerCase();
  const filtered = options.filter(o => {
    if (!s) return true;
    return (o.kurzbezeichnung || "").toLowerCase().includes(s)
      || o.name.toLowerCase().includes(s)
      || (o.produktgruppe || "").toLowerCase().includes(s);
  });

  const alreadyPicked = new Set(components.map(c => c.component_template_id));

  return (
    <div className="border rounded-lg p-3 bg-muted/20 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Komponenten der Stückliste</p>
          <p className="text-xs text-muted-foreground">
            Mengen beziehen sich auf <b>1 Einheit</b> dieses Sets (z. B. 1 m²).
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-1 shrink-0" onClick={() => setPickerOpen(true)}>
          <Plus className="w-4 h-4" /> Komponente
        </Button>
      </div>

      {components.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-3 text-center">
          Noch keine Komponenten. Lege z. B. für "1 m² Unterkonstruktion"
          5 lfm Aluminium + 6 Stehlager + Gummipads + Schrauben hinzu.
        </p>
      ) : (
        <div className="space-y-1.5">
          {components.map((c) => {
            const zwischen = (Number(c.component_netto_preis) || 0) * (Number(c.menge) || 0);
            return (
              <div key={c.component_template_id} className="grid grid-cols-[1fr_80px_60px_80px_30px] gap-2 items-center text-sm">
                <div className="truncate">
                  <span className="font-medium">{c.component_name}</span>
                </div>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={c.menge}
                  onChange={(e) => updateMenge(c.component_template_id, Number(e.target.value) || 0)}
                  className="h-8 text-right"
                />
                <span className="text-xs text-muted-foreground">{c.component_einheit}</span>
                <span className="text-xs font-mono text-right">
                  € {zwischen.toFixed(2)}
                </span>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => removeComponent(c.component_template_id)}>
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
              </div>
            );
          })}
          <div className="flex items-center justify-between border-t pt-2 mt-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">Σ Kalkulation</Badge>
              {onRecalcPrice && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1"
                  onClick={() => onRecalcPrice(Math.round(netto * 100) / 100)}
                >
                  <Calculator className="w-3.5 h-3.5" />
                  Preis übernehmen
                </Button>
              )}
            </div>
            <span className="font-mono font-bold">€ {netto.toFixed(2)} netto</span>
          </div>
        </div>
      )}

      {/* Komponenten-Picker */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Komponente hinzufügen</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
              placeholder="Material suchen..."
              className="pl-9"
              autoFocus
            />
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 -mx-1">
            {filtered.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-6">Nichts gefunden</p>
            ) : (
              <div className="space-y-0.5 px-1">
                {filtered.map(o => {
                  const disabled = alreadyPicked.has(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => { addComponent(o); setPickerOpen(false); }}
                      className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                        disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-accent"
                      }`}
                    >
                      <div className="flex-1 truncate">
                        <span className="font-medium">{o.kurzbezeichnung || o.name}</span>
                        <span className="text-xs text-muted-foreground ml-1">· {o.produktgruppe}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{o.einheit}</span>
                      <span className="text-xs font-mono text-right w-16">€ {o.netto_preis.toFixed(2)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

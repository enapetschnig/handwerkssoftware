import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Package, ArrowLeft, Truck } from "lucide-react";

interface LieferscheinOption {
  id: string;
  name: string | null;
  datum: string | null;
  projectName: string | null;
  materialCount: number;
}

interface MaterialSummary {
  material: string;
  einheit: string;
  verbraucht: number;
  selected: boolean;
  einzelpreis: number;
  lieferscheinName: string;
}

interface ImportedItem {
  beschreibung: string;
  menge: number;
  einheit: string;
  einzelpreis: number;
}

interface ImportLieferscheinDialogProps {
  open: boolean;
  onClose: () => void;
  projectId?: string | null;
  onImport: (items: ImportedItem[]) => void;
}

export function ImportLieferscheinDialog({ open, onClose, projectId, onImport }: ImportLieferscheinDialogProps) {
  const [lieferscheine, setLieferscheine] = useState<LieferscheinOption[]>([]);
  const [selectedLsIds, setSelectedLsIds] = useState<Set<string>>(new Set());
  const [materials, setMaterials] = useState<MaterialSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"select" | "materials">(projectId ? "materials" : "select");

  useEffect(() => {
    if (open) {
      if (projectId) {
        // Direct mode: skip to materials for this project
        setStep("materials");
        setSelectedLsIds(new Set());
        fetchMaterialsForProject(projectId);
      } else {
        // Browse mode: show all Lieferscheine
        setStep("select");
        setSelectedLsIds(new Set());
        setMaterials([]);
        fetchLieferscheine();
      }
    }
  }, [open, projectId]);

  const fetchLieferscheine = async () => {
    setLoading(true);
    // Load all Lieferscheine with their projects
    const { data: lsData } = await supabase
      .from("lieferscheine")
      .select("id, name, datum, project_id")
      .order("datum", { ascending: false });

    if (!lsData || lsData.length === 0) {
      setLieferscheine([]);
      setLoading(false);
      return;
    }

    // Load project names
    const projectIds = [...new Set(lsData.map(l => l.project_id).filter(Boolean))] as string[];
    const projectMap = new Map<string, string>();
    if (projectIds.length > 0) {
      const { data: projects } = await supabase.from("projects").select("id, name").in("id", projectIds);
      projects?.forEach(p => projectMap.set(p.id, p.name));
    }

    // Count materials per Lieferschein
    const lsIds = lsData.map(l => l.id);
    const { data: entries } = await supabase
      .from("material_entries")
      .select("lieferschein_id, typ")
      .in("lieferschein_id", lsIds);

    const countMap = new Map<string, number>();
    entries?.forEach(e => {
      if (e.typ === "entnahme") countMap.set(e.lieferschein_id!, (countMap.get(e.lieferschein_id!) || 0) + 1);
    });

    setLieferscheine(lsData
      .filter(ls => (countMap.get(ls.id) || 0) > 0) // Only show LS with materials
      .map(ls => ({
        id: ls.id,
        name: ls.name,
        datum: ls.datum,
        projectName: ls.project_id ? projectMap.get(ls.project_id) || null : null,
        materialCount: countMap.get(ls.id) || 0,
      }))
    );
    setLoading(false);
  };

  const fetchMaterialsForProject = async (pid: string) => {
    setLoading(true);
    const { data: lsData } = await supabase.from("lieferscheine").select("id, name").eq("project_id", pid);
    if (!lsData || lsData.length === 0) { setMaterials([]); setLoading(false); return; }
    await fetchMaterialsForLieferscheine(lsData.map(l => l.id), new Map(lsData.map(l => [l.id, l.name || "Lieferschein"])));
  };

  const fetchMaterialsForSelected = async () => {
    if (selectedLsIds.size === 0) return;
    setLoading(true);
    const ids = Array.from(selectedLsIds);
    const lsNameMap = new Map<string, string>();
    lieferscheine.forEach(ls => { if (ids.includes(ls.id)) lsNameMap.set(ls.id, ls.name || ls.projectName || "Lieferschein"); });
    await fetchMaterialsForLieferscheine(ids, lsNameMap);
    setStep("materials");
  };

  const fetchMaterialsForLieferscheine = async (lsIds: string[], lsNameMap: Map<string, string>) => {
    const { data: entries } = await supabase
      .from("material_entries")
      .select("material, menge, einheit, typ, lieferschein_id, einzelpreis")
      .in("lieferschein_id", lsIds);

    if (!entries || entries.length === 0) { setMaterials([]); setLoading(false); return; }

    const map = new Map<string, { material: string; einheit: string; entnommen: number; zurueck: number; lsName: string; einzelpreis: number }>();
    entries.forEach(e => {
      const key = `${e.lieferschein_id}::${e.material.toLowerCase().trim()}`;
      if (!map.has(key)) {
        map.set(key, {
          material: e.material,
          einheit: e.einheit || "Stk.",
          entnommen: 0, zurueck: 0,
          lsName: lsNameMap.get(e.lieferschein_id!) || "Lieferschein",
          einzelpreis: Number(e.einzelpreis) || 0,
        });
      }
      const s = map.get(key)!;
      const menge = parseFloat(e.menge || "0") || 0;
      if (e.typ === "entnahme") s.entnommen += menge;
      else if (e.typ === "rueckgabe") s.zurueck += menge;
      if (Number(e.einzelpreis) > 0 && s.einzelpreis === 0) s.einzelpreis = Number(e.einzelpreis);
    });

    setMaterials(
      Array.from(map.values())
        .map(s => ({
          material: s.material,
          einheit: s.einheit,
          verbraucht: Math.round((s.entnommen - s.zurueck) * 100) / 100,
          selected: s.entnommen - s.zurueck > 0,
          einzelpreis: s.einzelpreis,
          lieferscheinName: s.lsName,
        }))
        .filter(s => s.verbraucht > 0)
        .sort((a, b) => a.material.localeCompare(b.material))
    );
    setLoading(false);
  };

  const toggleLs = (id: string) => {
    setSelectedLsIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggle = (idx: number) => {
    setMaterials(prev => prev.map((m, i) => i === idx ? { ...m, selected: !m.selected } : m));
  };

  const updatePrice = (idx: number, val: number) => {
    setMaterials(prev => prev.map((m, i) => i === idx ? { ...m, einzelpreis: val } : m));
  };

  const handleImport = () => {
    const items: ImportedItem[] = materials
      .filter(m => m.selected)
      .map(m => ({ beschreibung: m.material, menge: m.verbraucht, einheit: m.einheit, einzelpreis: m.einzelpreis }));
    onImport(items);
  };

  const selected = materials.filter(m => m.selected);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            Material aus Lieferscheinen importieren
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Select Lieferscheine (only in browse mode) */}
        {step === "select" && (
          <>
            {loading ? (
              <p className="text-center py-8 text-muted-foreground">Lädt Lieferscheine...</p>
            ) : lieferscheine.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">Keine Lieferscheine mit Material gefunden.</p>
            ) : (
              <div className="space-y-2">
                {lieferscheine.map(ls => (
                  <div
                    key={ls.id}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedLsIds.has(ls.id) ? "bg-primary/5 border-primary/30" : "hover:bg-muted/50"}`}
                    onClick={() => toggleLs(ls.id)}
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox checked={selectedLsIds.has(ls.id)} onCheckedChange={() => toggleLs(ls.id)} />
                      <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{ls.name || ls.projectName || "Lieferschein"}</p>
                        <p className="text-xs text-muted-foreground">
                          {ls.datum && new Date(ls.datum).toLocaleDateString("de-AT")}
                          {ls.projectName && <Badge variant="outline" className="ml-2 text-xs">{ls.projectName}</Badge>}
                          <span className="ml-2">{ls.materialCount} Entnahmen</span>
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>Abbrechen</Button>
              <Button onClick={fetchMaterialsForSelected} disabled={selectedLsIds.size === 0} className="gap-2">
                <Package className="w-4 h-4" />
                {selectedLsIds.size > 0 ? `${selectedLsIds.size} Lieferschein${selectedLsIds.size > 1 ? "e" : ""} laden` : "Auswählen"}
              </Button>
            </div>
          </>
        )}

        {/* Step 2: Materials */}
        {step === "materials" && (
          <>
            {!projectId && (
              <Button variant="ghost" size="sm" className="gap-1 w-fit" onClick={() => { setStep("select"); setMaterials([]); }}>
                <ArrowLeft className="h-3.5 w-3.5" /> Zurück zur Auswahl
              </Button>
            )}

            {loading ? (
              <p className="text-center py-8 text-muted-foreground">Lädt Material...</p>
            ) : materials.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">
                Kein verbrauchtes Material gefunden.
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  {materials.map((m, idx) => (
                    <div key={idx} className={`p-3 rounded-lg border ${m.selected ? "bg-primary/5 border-primary/30" : "bg-muted/30"}`}>
                      <div className="flex items-center gap-3">
                        <Checkbox checked={m.selected} onCheckedChange={() => toggle(idx)} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">{m.material}</p>
                          <p className="text-xs text-muted-foreground">
                            {m.verbraucht} {m.einheit} verbraucht
                            <Badge variant="outline" className="ml-2 text-xs">{m.lieferscheinName}</Badge>
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-[10px] text-muted-foreground">€ pro {m.einheit}</span>
                          <Input
                            type="number"
                            value={m.einzelpreis}
                            onChange={(e) => updatePrice(idx, Number(e.target.value))}
                            className="w-24 text-right"
                            min={0} step={0.01} placeholder="0.00"
                          />
                        </div>
                        <p className="text-sm font-medium w-24 text-right">
                          € {(m.verbraucht * m.einzelpreis).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-2 border-t text-sm">
                  <span className="text-muted-foreground">{selected.length} Materialien ausgewählt</span>
                  <span className="font-bold">
                    Gesamt: € {selected.reduce((s, m) => s + m.verbraucht * m.einzelpreis, 0).toFixed(2)}
                  </span>
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>Abbrechen</Button>
              <Button onClick={handleImport} disabled={selected.length === 0} className="gap-2">
                <Package className="w-4 h-4" />
                {selected.length > 0 ? `${selected.length} Positionen importieren` : "Importieren"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

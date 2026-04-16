import { useState, useEffect } from "react";
import { Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BOARD_COLORS } from "./scheduleTypes";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableProjects: { id: string; name: string; geplanter_start?: string | null; geplantes_ende?: string | null }[];
  onSave: (projectId: string, color: string, startDate: string, endDate: string, beschreibung: string) => Promise<void>;
}

export function AddProjectToBoardDialog({ open, onOpenChange, availableProjects, onSave }: Props) {
  const [projectId, setProjectId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [beschreibung, setBeschreibung] = useState("");
  const [color, setColor] = useState(BOARD_COLORS[0]);
  const [customColor, setCustomColor] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setProjectId("");
      setStartDate("");
      setEndDate("");
      setBeschreibung("");
      setColor(BOARD_COLORS[0]);
      setCustomColor("");
    }
  }, [open]);

  useEffect(() => {
    if (projectId) {
      const proj = availableProjects.find(p => p.id === projectId);
      if (proj?.geplanter_start) setStartDate(proj.geplanter_start);
      if (proj?.geplantes_ende) setEndDate(proj.geplantes_ende);
    }
  }, [projectId, availableProjects]);

  const handleSave = async () => {
    if (!projectId || !startDate || !endDate) return;
    setSaving(true);
    try {
      await onSave(projectId, color, startDate, endDate, beschreibung);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Projekt hinzufügen</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>Projektname *</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue placeholder="Suche ..." /></SelectTrigger>
              <SelectContent>
                {availableProjects.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Start *</Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label>Ende *</Label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Beschreibung</Label>
            <Textarea value={beschreibung} onChange={e => setBeschreibung(e.target.value)} placeholder="Projektbeschreibung hinzufügen ..." rows={2} />
          </div>

          <div>
            <Label>Farbe</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {BOARD_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  className="w-8 h-8 rounded-lg border-2 transition-all flex items-center justify-center"
                  style={{
                    backgroundColor: c,
                    borderColor: color === c ? "#333" : "transparent",
                  }}
                  onClick={() => { setColor(c); setCustomColor(""); }}
                >
                  {color === c && <Check className="h-4 w-4 text-gray-700" />}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Input
                type="color"
                value={customColor || color}
                onChange={e => { setCustomColor(e.target.value); setColor(e.target.value); }}
                className="w-10 h-8 p-0.5 cursor-pointer"
              />
              <span className="text-xs text-muted-foreground">Eigene Farbe</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button onClick={handleSave} disabled={!projectId || !startDate || !endDate || saving}>
            {saving ? "Speichern..." : "Speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

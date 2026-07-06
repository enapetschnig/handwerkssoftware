import { useState, useEffect } from "react";
import { Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { Fremdfirma } from "./scheduleTypes";

export interface FremdfirmaFormData {
  firmenname: string;
  adresse: string;
  plz: string;
  ort: string;
  telefon: string;
  ansprechpartner: string;
  notizen: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editFirma?: Fremdfirma | null;
  onSave: (data: FremdfirmaFormData, id?: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

const EMPTY: FremdfirmaFormData = {
  firmenname: "", adresse: "", plz: "", ort: "", telefon: "", ansprechpartner: "", notizen: "",
};

/**
 * Anlegen/Bearbeiten einer Fremdfirma. Bewusst nur die wichtigsten
 * Firmendaten — keine SV-Nummer o.ä., da es kein Mitarbeiter ist.
 */
export function CreateFremdfirmaDialog({ open, onOpenChange, editFirma, onSave, onDelete }: Props) {
  const [form, setForm] = useState<FremdfirmaFormData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isEditing = !!editFirma;

  useEffect(() => {
    if (!open) return;
    if (editFirma) {
      setForm({
        firmenname: editFirma.firmenname ?? "",
        adresse: editFirma.adresse ?? "",
        plz: editFirma.plz ?? "",
        ort: editFirma.ort ?? "",
        telefon: editFirma.telefon ?? "",
        ansprechpartner: editFirma.ansprechpartner ?? "",
        notizen: editFirma.notizen ?? "",
      });
    } else {
      setForm(EMPTY);
    }
  }, [open, editFirma]);

  const set = (k: keyof FremdfirmaFormData, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSave() {
    if (saving || !form.firmenname.trim()) return;
    setSaving(true);
    try {
      await onSave(form, editFirma?.id);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editFirma || !onDelete) return;
    setDeleting(true);
    try {
      await onDelete(editFirma.id);
      onOpenChange(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {isEditing ? "Fremdfirma bearbeiten" : "Neue Fremdfirma"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Firmenname <span className="text-red-500">*</span>
            </Label>
            <Input value={form.firmenname} onChange={(e) => set("firmenname", e.target.value)} placeholder="z.B. Mustermann Bau GmbH" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Adresse</Label>
            <Input value={form.adresse} onChange={(e) => set("adresse", e.target.value)} placeholder="Straße und Hausnummer" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">PLZ</Label>
              <Input value={form.plz} onChange={(e) => set("plz", e.target.value)} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Ort</Label>
              <Input value={form.ort} onChange={(e) => set("ort", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Telefon</Label>
            <Input value={form.telefon} onChange={(e) => set("telefon", e.target.value)} placeholder="+43 ..." />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Ansprechpartner</Label>
            <Input value={form.ansprechpartner} onChange={(e) => set("ansprechpartner", e.target.value)} placeholder="Optional..." />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Notizen</Label>
            <Textarea value={form.notizen} onChange={(e) => set("notizen", e.target.value)} placeholder="Optional..." rows={2} className="resize-none" />
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          {isEditing && onDelete ? (
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting} className="gap-1.5">
              <Trash2 className="h-3.5 w-3.5" />
              {deleting ? "Löschen..." : "Löschen"}
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Abbrechen</Button>
            <Button size="sm" disabled={!form.firmenname.trim() || saving} onClick={handleSave}>
              {saving ? "Speichern..." : isEditing ? "Speichern" : "Erstellen"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

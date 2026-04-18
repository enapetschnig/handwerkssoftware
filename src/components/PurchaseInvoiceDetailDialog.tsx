import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExternalLink, Save, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const KATEGORIEN = [
  { value: "material", label: "Material" },
  { value: "fremdleistung", label: "Fremdleistung" },
  { value: "werkzeug", label: "Werkzeug / Maschinen" },
  { value: "miete", label: "Miete / Leasing" },
  { value: "treibstoff", label: "Treibstoff / KFZ" },
  { value: "buero", label: "Büro / Verwaltung" },
  { value: "sonstiges", label: "Sonstiges" },
];

interface Props {
  invoiceId: string | null;
  onClose: () => void;
  onUpdated: () => void;
}

export function PurchaseInvoiceDetailDialog({ invoiceId, onClose, onUpdated }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!invoiceId) { setForm(null); setFileUrl(null); return; }
    loadData();
  }, [invoiceId]);

  useEffect(() => {
    let cancelled = false;
    if (!form?.pdf_path) { setFileUrl(null); return; }
    supabase.storage.from("purchase-invoices").createSignedUrl(form.pdf_path, 300).then(({ data }) => {
      if (!cancelled) setFileUrl(data?.signedUrl || null);
    });
    return () => { cancelled = true; };
  }, [form?.pdf_path]);

  const loadData = async () => {
    if (!invoiceId) return;
    setLoading(true);
    const [{ data: inv }, { data: projs }] = await Promise.all([
      supabase.from("purchase_invoices").select("*").eq("id", invoiceId).single(),
      supabase.from("projects").select("id, name").order("name"),
    ]);
    if (inv) setForm(inv);
    if (projs) setProjects(projs);
    setLoading(false);
  };

  const update = (field: string, value: any) => setForm((prev: any) => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    const { error } = await supabase.from("purchase_invoices").update({
      lieferant: form.lieferant,
      rechnungsnummer: form.rechnungsnummer || null,
      rechnungsdatum: form.rechnungsdatum || null,
      faellig_am: form.faellig_am || null,
      bezahlt_am: form.bezahlt_am || null,
      betrag_brutto: parseFloat(form.betrag_brutto),
      betrag_netto: form.betrag_netto !== null ? parseFloat(form.betrag_netto) : null,
      ust_satz: form.ust_satz !== null ? parseFloat(form.ust_satz) : null,
      kategorie: form.kategorie,
      project_id: form.project_id || null,
      status: form.status,
      zahlungsart: form.zahlungsart || null,
      notizen: form.notizen || null,
      updated_at: new Date().toISOString(),
    }).eq("id", form.id);

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      toast({ title: "Gespeichert" });
      onUpdated();
      onClose();
    }
    setSaving(false);
  };

  const openFile = async () => {
    if (!form?.pdf_path) return;
    const { data } = await supabase.storage.from("purchase-invoices").createSignedUrl(form.pdf_path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  if (!invoiceId) return null;

  return (
    <Dialog open={!!invoiceId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Eingangsrechnung bearbeiten</DialogTitle>
        </DialogHeader>

        {loading || !form ? (
          <div className="py-10 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {form.pdf_path && fileUrl && (
              <div className="space-y-2">
                <div className="rounded-lg border overflow-hidden bg-muted/20">
                  {form.mime_type === "application/pdf" || (form.file_name || "").toLowerCase().endsWith(".pdf") ? (
                    <iframe
                      src={fileUrl}
                      title={form.file_name || "Rechnung"}
                      className="w-full h-[420px] bg-white"
                    />
                  ) : (
                    <img
                      src={fileUrl}
                      alt={form.file_name || "Rechnung"}
                      className="w-full max-h-[420px] object-contain bg-white"
                    />
                  )}
                </div>
                <Button variant="outline" onClick={openFile} className="w-full gap-2">
                  <ExternalLink className="h-4 w-4" />
                  In neuem Tab öffnen
                </Button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Lieferant *</Label>
                <Input value={form.lieferant || ""} onChange={e => update("lieferant", e.target.value)} />
              </div>
              <div>
                <Label>Rechnungsnummer</Label>
                <Input value={form.rechnungsnummer || ""} onChange={e => update("rechnungsnummer", e.target.value)} />
              </div>
              <div>
                <Label>Rechnungsdatum</Label>
                <Input type="date" value={form.rechnungsdatum || ""} onChange={e => update("rechnungsdatum", e.target.value)} />
              </div>
              <div>
                <Label>Betrag Brutto * (€)</Label>
                <Input type="number" step="0.01" value={form.betrag_brutto || ""} onChange={e => update("betrag_brutto", e.target.value)} />
              </div>
              <div>
                <Label>Betrag Netto (€)</Label>
                <Input type="number" step="0.01" value={form.betrag_netto || ""} onChange={e => update("betrag_netto", e.target.value)} />
              </div>
              <div>
                <Label>USt-Satz (%)</Label>
                <Select value={String(form.ust_satz || 20)} onValueChange={v => update("ust_satz", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">0%</SelectItem>
                    <SelectItem value="10">10%</SelectItem>
                    <SelectItem value="13">13%</SelectItem>
                    <SelectItem value="20">20%</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Kategorie</Label>
                <Select value={form.kategorie || "sonstiges"} onValueChange={v => update("kategorie", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {KATEGORIEN.map(k => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Projekt</Label>
                <Select value={form.project_id || "none"} onValueChange={v => update("project_id", v === "none" ? null : v)}>
                  <SelectTrigger><SelectValue placeholder="Kein Projekt" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Kein Projekt</SelectItem>
                    {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status || "offen"} onValueChange={v => update("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="offen">Offen</SelectItem>
                    <SelectItem value="bezahlt">Bezahlt</SelectItem>
                    <SelectItem value="abgelehnt">Abgelehnt</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Fällig am</Label>
                <Input type="date" value={form.faellig_am || ""} onChange={e => update("faellig_am", e.target.value)} />
              </div>
              <div>
                <Label>Bezahlt am</Label>
                <Input type="date" value={form.bezahlt_am || ""} onChange={e => update("bezahlt_am", e.target.value)} />
              </div>
              <div>
                <Label>Zahlungsart</Label>
                <Select value={form.zahlungsart || "ueberweisung"} onValueChange={v => update("zahlungsart", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ueberweisung">Überweisung</SelectItem>
                    <SelectItem value="bar">Bar</SelectItem>
                    <SelectItem value="karte">Karte</SelectItem>
                    <SelectItem value="lastschrift">Lastschrift</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Notizen</Label>
                <Textarea value={form.notizen || ""} onChange={e => update("notizen", e.target.value)} rows={3} />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button onClick={handleSave} disabled={saving || !form}>
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Speichert...</> : <><Save className="h-4 w-4 mr-2" /> Speichern</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

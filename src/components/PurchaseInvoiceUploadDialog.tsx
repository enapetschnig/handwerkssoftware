import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, X, FileText, Image as ImageIcon, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => void;
  prefillProjectId?: string | null;
  initialFile?: File | null;
}

const KATEGORIEN = [
  { value: "material", label: "Material" },
  { value: "fremdleistung", label: "Fremdleistung" },
  { value: "werkzeug", label: "Werkzeug / Maschinen" },
  { value: "miete", label: "Miete / Leasing" },
  { value: "treibstoff", label: "Treibstoff / KFZ" },
  { value: "buero", label: "Büro / Verwaltung" },
  { value: "sonstiges", label: "Sonstiges" },
];

export function PurchaseInvoiceUploadDialog({ open, onOpenChange, onUploaded, prefillProjectId, initialFile }: Props) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (files.length === 0) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(files[0]);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [files]);

  const [form, setForm] = useState({
    lieferant: "",
    rechnungsnummer: "",
    rechnungsdatum: new Date().toISOString().split("T")[0],
    faellig_am: "",
    betrag_brutto: "",
    betrag_netto: "",
    ust_satz: "20",
    kategorie: "material",
    project_id: "",
    zahlungsart: "ueberweisung",
    status: "offen",
    notizen: "",
  });

  useEffect(() => {
    if (open) {
      setFiles([]);
      setForm({
        lieferant: "",
        rechnungsnummer: "",
        rechnungsdatum: new Date().toISOString().split("T")[0],
        faellig_am: "",
        betrag_brutto: "",
        betrag_netto: "",
        ust_satz: "20",
        kategorie: "material",
        project_id: prefillProjectId || "",
        zahlungsart: "ueberweisung",
        status: "offen",
        notizen: "",
      });
      // Load projects
      supabase.from("projects").select("id, name").not("status", "eq", "Abgeschlossen").order("name").then(({ data }) => {
        if (data) setProjects(data);
      });
      // Wenn per Kamera-Button geöffnet → Datei direkt übernehmen + scannen
      if (initialFile) {
        setFiles([initialFile]);
        void scanFileWithAi(initialFile);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefillProjectId, initialFile]);

  const update = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  // Calculate netto from brutto on ust change
  const calcNetto = (brutto: string, ust: string) => {
    const b = parseFloat(brutto);
    const u = parseFloat(ust);
    if (!isNaN(b) && !isNaN(u)) {
      return (b / (1 + u / 100)).toFixed(2);
    }
    return "";
  };

  const handleFiles = (newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles).filter(f => {
      const ok = f.type === "application/pdf" || f.type.startsWith("image/");
      if (!ok) toast({ variant: "destructive", title: "Nicht unterstützt", description: `${f.name}: nur PDF, JPG, PNG` });
      return ok;
    });
    setFiles(prev => [...prev, ...arr]);
    // Automatischer KI-Scan auf die erste hochgeladene Datei — Brutto + andere
    // Felder werden direkt extrahiert, damit der User nichts tippen muss.
    if (arr.length > 0) {
      void scanFileWithAi(arr[0]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  };

  // KI-Scan: Rechnungsdaten aus einer Datei extrahieren und Form vorausfüllen.
  // Funktioniert mit Bildern (direkt) UND PDFs (1. Seite → JPEG-Rendering).
  const scanFileWithAi = async (file: File) => {
    setScanning(true);
    try {
      let dataUrl: string;

      if (file.type === "application/pdf") {
        // PDF → erste Seite als JPEG rendern (GPT-4 Vision akzeptiert nur Bilder)
        const { pdfFirstPageToJpegDataUrl } = await import("@/lib/pdfToImage");
        dataUrl = await pdfFirstPageToJpegDataUrl(file);
      } else if (file.type.startsWith("image/")) {
        dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
      } else {
        setScanning(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("parse-invoice-document", {
        body: { imageBase64: dataUrl },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      const parsed = data?.data;
      if (!parsed) throw new Error("Keine Daten erkannt");

      // Form vorausfüllen — KI-Werte haben Vorrang (überschreiben leere Defaults),
      // bestehende manuelle Eingabe bleibt nur dann, wenn KI nichts findet.
      setForm(prev => ({
        ...prev,
        lieferant: parsed.lieferant || prev.lieferant,
        rechnungsnummer: parsed.rechnungsnummer || prev.rechnungsnummer,
        rechnungsdatum: parsed.rechnungsdatum || prev.rechnungsdatum,
        faellig_am: parsed.faellig_am || prev.faellig_am,
        betrag_brutto: parsed.betrag_brutto ? String(parsed.betrag_brutto) : prev.betrag_brutto,
        betrag_netto: parsed.betrag_netto ? String(parsed.betrag_netto) : prev.betrag_netto,
        ust_satz: parsed.ust_satz ? String(parsed.ust_satz) : prev.ust_satz,
        kategorie: parsed.kategorie || prev.kategorie,
        notizen: parsed.notizen || prev.notizen,
      }));

      toast({
        title: "KI-Scan erfolgreich",
        description: parsed.betrag_brutto
          ? `Brutto € ${Number(parsed.betrag_brutto).toFixed(2)} · Bitte prüfen`
          : "Daten wurden übernommen — bitte prüfen",
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "KI-Scan fehlgeschlagen", description: err.message });
    } finally {
      setScanning(false);
    }
  };

  const handleSave = async () => {
    if (files.length === 0) {
      toast({ variant: "destructive", title: "Datei fehlt", description: "Bitte mindestens eine Datei hochladen" });
      return;
    }
    if (!form.lieferant.trim()) {
      toast({ variant: "destructive", title: "Lieferant fehlt", description: "Bitte Lieferant eingeben" });
      return;
    }
    if (!form.betrag_brutto || parseFloat(form.betrag_brutto) <= 0) {
      toast({ variant: "destructive", title: "Betrag fehlt", description: "Bitte Bruttobetrag eingeben" });
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      for (const file of files) {
        // 1. Create DB entry
        const brutto = parseFloat(form.betrag_brutto);
        const ust = parseFloat(form.ust_satz);
        const netto = form.betrag_netto
          ? parseFloat(form.betrag_netto)
          : (brutto / (1 + ust / 100));

        const { data: inv, error } = await supabase
          .from("purchase_invoices")
          .insert({
            created_by: user.id,
            project_id: form.project_id || null,
            lieferant: form.lieferant.trim(),
            rechnungsnummer: form.rechnungsnummer.trim() || null,
            rechnungsdatum: form.rechnungsdatum || null,
            faellig_am: form.faellig_am || null,
            betrag_brutto: brutto,
            betrag_netto: parseFloat(netto.toFixed(2)),
            ust_satz: ust,
            kategorie: form.kategorie,
            zahlungsart: form.zahlungsart || null,
            status: form.status,
            notizen: form.notizen.trim() || null,
            file_name: file.name,
            mime_type: file.type,
          })
          .select("id")
          .single();

        if (error) throw new Error(error.message);

        // 2. Upload file — sanitize filename (keep extension, replace special chars)
        const safeName = file.name
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")           // remove diacritics
          .replace(/[^a-zA-Z0-9._-]/g, "_")          // replace anything else with _
          .replace(/_+/g, "_")                        // collapse multiple _
          .replace(/^_+|_+$/g, "");                   // trim leading/trailing _
        const finalName = safeName || `file_${Date.now()}.pdf`;
        const path = `${inv.id}/${finalName}`;
        const { error: upErr } = await supabase.storage
          .from("purchase-invoices")
          .upload(path, file, { upsert: true });

        if (upErr) {
          // Rollback: lösche leeres DB-Record bei Upload-Fehler
          await supabase.from("purchase_invoices").delete().eq("id", inv.id);
          throw new Error(upErr.message);
        }

        // 3. Update pdf_path + original filename
        await supabase.from("purchase_invoices").update({ pdf_path: path, file_name: file.name }).eq("id", inv.id);
      }

      toast({ title: "Gespeichert", description: `${files.length} ${files.length === 1 ? "Rechnung" : "Rechnungen"} hochgeladen` });
      onUploaded();
      onOpenChange(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Fehler", description: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Eingangsrechnung hochladen
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Dropzone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30"
            }`}
          >
            <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm font-medium">Datei hier ablegen oder klicken</p>
            <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG · Mehrfachauswahl möglich</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/*"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="space-y-1.5">
              {files.map((f, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-muted/50 rounded-md px-3 py-2 text-sm">
                  {f.type === "application/pdf"
                    ? <FileText className="h-4 w-4 text-red-500 shrink-0" />
                    : <ImageIcon className="h-4 w-4 text-blue-500 shrink-0" />
                  }
                  <span className="flex-1 truncate">{f.name}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {(f.size / 1024).toFixed(0)} KB
                  </span>
                  <button
                    type="button"
                    className="p-0.5 rounded hover:bg-muted"
                    onClick={(e) => { e.stopPropagation(); removeFile(idx); }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Live-Preview der ersten Datei */}
          {previewUrl && files[0] && (
            <div className="rounded-lg border overflow-hidden bg-muted/20">
              {files[0].type === "application/pdf" ? (
                <iframe
                  src={previewUrl}
                  title={files[0].name}
                  className="w-full h-[420px] bg-white"
                />
              ) : files[0].type.startsWith("image/") ? (
                <img
                  src={previewUrl}
                  alt={files[0].name}
                  className="w-full max-h-[420px] object-contain bg-white"
                />
              ) : null}
            </div>
          )}

          {/* KI-Scan läuft automatisch beim Upload — Indikator + erneutes Scannen */}
          {files.length > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => scanFileWithAi(files[0])}
              disabled={scanning}
              className="w-full gap-2 bg-gradient-to-r from-blue-50 to-cyan-50 border-blue-200 hover:from-blue-100 hover:to-cyan-100"
            >
              {scanning ? <><Loader2 className="h-4 w-4 animate-spin" /> KI liest Rechnung...</> : <><Sparkles className="h-4 w-4 text-blue-600" /> Erneut mit KI scannen</>}
            </Button>
          )}

          {/* Quick form */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t">
            <div className="col-span-2">
              <Label>Lieferant *</Label>
              <Input value={form.lieferant} onChange={e => update("lieferant", e.target.value)} placeholder="z.B. Hornbach" />
            </div>
            <div>
              <Label>Rechnungsnummer</Label>
              <Input value={form.rechnungsnummer} onChange={e => update("rechnungsnummer", e.target.value)} />
            </div>
            <div>
              <Label>Rechnungsdatum</Label>
              <Input type="date" value={form.rechnungsdatum} onChange={e => update("rechnungsdatum", e.target.value)} />
            </div>
            <div>
              <Label>Betrag Brutto * (€)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.betrag_brutto}
                onChange={e => {
                  update("betrag_brutto", e.target.value);
                  update("betrag_netto", calcNetto(e.target.value, form.ust_satz));
                }}
              />
            </div>
            <div>
              <Label>USt-Satz (%)</Label>
              <Select value={form.ust_satz} onValueChange={v => {
                update("ust_satz", v);
                update("betrag_netto", calcNetto(form.betrag_brutto, v));
              }}>
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
              <Select value={form.kategorie} onValueChange={v => update("kategorie", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {KATEGORIEN.map(k => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Projekt (optional)</Label>
              <Select value={form.project_id || "none"} onValueChange={v => update("project_id", v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Kein Projekt" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Kein Projekt</SelectItem>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => update("status", v)}>
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
              <Input type="date" value={form.faellig_am} onChange={e => update("faellig_am", e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label>Notizen</Label>
              <Textarea value={form.notizen} onChange={e => update("notizen", e.target.value)} rows={2} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Speichert...</> : "Speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

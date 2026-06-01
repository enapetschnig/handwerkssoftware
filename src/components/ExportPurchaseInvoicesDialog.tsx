// Excel-Export für Eingangsrechnungen.
// Zeitraum-Auswahl (Jahr + Monat ODER ganzes Jahr), Status/Kategorie-
// Filter optional, sortiert nach rechnungsdatum, dann nummer.
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Download, Loader2, FileSpreadsheet } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

const MONTHS = [
  "Jänner", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

const KATEGORIE_LABELS: Record<string, string> = {
  material: "Material",
  werkzeug: "Werkzeug",
  fahrzeug: "Fahrzeug/Tanken",
  buero: "Büro",
  versicherung: "Versicherung",
  steuer: "Steuer/Abgaben",
  miete: "Miete",
  sonstiges: "Sonstiges",
};

export function ExportPurchaseInvoicesDialog({ open, onClose }: Props) {
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const [year, setYear] = useState(currentYear.toString());
  const [month, setMonth] = useState(currentMonth.toString());
  const [exportAllYear, setExportAllYear] = useState(true);
  const [kategorieFilter, setKategorieFilter] = useState<string>("alle");
  const [statusFilter, setStatusFilter] = useState<string>("alle");
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      let q = supabase
        .from("purchase_invoices")
        .select("nummer, lieferant, rechnungsnummer, rechnungsdatum, faellig_am, bezahlt_am, betrag_netto, betrag_brutto, ust_satz, kategorie, status, zahlungsart, notizen, pdf_path, projects(name)")
        .order("rechnungsdatum", { ascending: true, nullsFirst: false })
        .order("nummer", { ascending: true });

      const yr = parseInt(year);
      if (exportAllYear) {
        q = q.gte("rechnungsdatum", `${yr}-01-01`).lt("rechnungsdatum", `${yr + 1}-01-01`);
      } else {
        const mo = parseInt(month);
        const startDate = `${yr}-${String(mo).padStart(2, "0")}-01`;
        const endMonth = mo === 12 ? 1 : mo + 1;
        const endYear = mo === 12 ? yr + 1 : yr;
        const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
        q = q.gte("rechnungsdatum", startDate).lt("rechnungsdatum", endDate);
      }
      if (kategorieFilter !== "alle") q = q.eq("kategorie", kategorieFilter);
      if (statusFilter !== "alle") q = q.eq("status", statusFilter);

      const { data, error } = await q;
      if (error) throw error;
      const rows = (data || []) as unknown as Array<{
        nummer: string | null; lieferant: string; rechnungsnummer: string | null;
        rechnungsdatum: string | null; faellig_am: string | null; bezahlt_am: string | null;
        betrag_netto: number | null; betrag_brutto: number; ust_satz: number | null;
        kategorie: string | null; status: string | null; zahlungsart: string | null;
        notizen: string | null; pdf_path: string | null; projects: { name: string } | null;
      }>;

      if (rows.length === 0) {
        toast({ title: "Keine Daten", description: "Für die gewählten Filter wurden keine Eingangsrechnungen gefunden." });
        setExporting(false);
        return;
      }

      const fmtDate = (iso: string | null) => iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("de-AT") : "";
      const aoa: (string | number | null)[][] = [
        ["Nr.", "Datum", "Fällig", "Bezahlt", "Lieferant", "Rechnungs-Nr.", "Netto", "MwSt %", "Brutto", "Kategorie", "Status", "Zahlung", "Projekt", "PDF", "Notiz"],
      ];
      let sumNetto = 0;
      let sumBrutto = 0;
      for (const r of rows) {
        const netto = Number(r.betrag_netto || 0);
        const brutto = Number(r.betrag_brutto || 0);
        sumNetto += netto;
        sumBrutto += brutto;
        aoa.push([
          r.nummer || "",
          fmtDate(r.rechnungsdatum),
          fmtDate(r.faellig_am),
          fmtDate(r.bezahlt_am),
          r.lieferant || "",
          r.rechnungsnummer || "",
          netto || null,
          r.ust_satz ?? null,
          brutto || null,
          r.kategorie ? (KATEGORIE_LABELS[r.kategorie] || r.kategorie) : "",
          r.status || "",
          r.zahlungsart || "",
          r.projects?.name || "",
          r.pdf_path ? "ja" : "nein",
          r.notizen || "",
        ]);
      }
      aoa.push([]);
      aoa.push(["", "", "", "", "", "Summe:", Math.round(sumNetto * 100) / 100, "", Math.round(sumBrutto * 100) / 100, "", "", "", "", "", ""]);

      // xlsx dynamisch importieren (großes Bundle)
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      // Spaltenbreiten
      ws["!cols"] = [
        { wch: 14 }, // Nr
        { wch: 12 }, // Datum
        { wch: 12 }, // Fällig
        { wch: 12 }, // Bezahlt
        { wch: 28 }, // Lieferant
        { wch: 18 }, // Rechnungs-Nr
        { wch: 10 }, // Netto
        { wch: 7 },  // MwSt %
        { wch: 10 }, // Brutto
        { wch: 14 }, // Kategorie
        { wch: 12 }, // Status
        { wch: 12 }, // Zahlung
        { wch: 20 }, // Projekt
        { wch: 6 },  // PDF
        { wch: 30 }, // Notiz
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Eingangsrechnungen");

      const filename = exportAllYear
        ? `Eingangsrechnungen_${yr}.xlsx`
        : `Eingangsrechnungen_${MONTHS[parseInt(month) - 1]}_${yr}.xlsx`;
      XLSX.writeFile(wb, filename);
      toast({ title: "Export erstellt", description: `${rows.length} Eingangsrechnungen exportiert.` });
      onClose();
    } catch (err) {
      toast({ variant: "destructive", title: "Export fehlgeschlagen", description: (err as Error).message });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Eingangsrechnungen exportieren
          </DialogTitle>
          <DialogDescription>
            Excel-Export aller Eingangsrechnungen für den gewählten Zeitraum, sortiert nach Datum.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="export-all-year"
              checked={exportAllYear}
              onCheckedChange={(v) => setExportAllYear(v === true)}
            />
            <Label htmlFor="export-all-year" className="cursor-pointer text-sm">Ganzes Jahr exportieren</Label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Jahr</Label>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 5 }, (_, i) => currentYear - 2 + i).map(y => (
                    <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!exportAllYear && (
              <div>
                <Label>Monat</Label>
                <Select value={month} onValueChange={setMonth}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
                      <SelectItem key={i} value={(i + 1).toString()}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Kategorie</Label>
              <Select value={kategorieFilter} onValueChange={setKategorieFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="alle">Alle</SelectItem>
                  {Object.entries(KATEGORIE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="alle">Alle</SelectItem>
                  <SelectItem value="offen">Offen</SelectItem>
                  <SelectItem value="bezahlt">Bezahlt</SelectItem>
                  <SelectItem value="verrechnet">Verrechnet</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={exporting}>Abbrechen</Button>
          <Button onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : <Download className="h-4 w-4 mr-2" />}
            Excel exportieren
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { FileText, Receipt, AlertTriangle, Download, Archive, ArchiveRestore, Trash2, FileDown, Printer, Settings, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { matchesSearch } from "@/lib/searchUtils";
import { loadInvoiceLogo } from "@/lib/logoLoader";
import { formatDateShort } from "@/lib/dateFormat";
import { EmptyState } from "@/components/EmptyState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format, parseISO, isBefore } from "date-fns";
import { de } from "date-fns/locale";
import { PageHeader } from "@/components/PageHeader";
import { ExportInvoicesDialog } from "@/components/ExportInvoicesDialog";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type InvoiceLayoutSettings, DEFAULT_LAYOUT, parseLayoutSettings } from "@/lib/invoiceLayoutTypes";

interface Invoice {
  id: string;
  typ: string;
  nummer: string;
  status: string;
  kunde_name: string;
  datum: string;
  brutto_summe: number;
  netto_summe: number;
  project_id: string | null;
  faellig_am: string | null;
  mahnstufe: number;
  gueltig_bis: string | null;
  bezahlt_betrag: number;
  archiviert: boolean;
}

const statusColors: Record<string, string> = {
  entwurf: "bg-muted text-muted-foreground",
  offen: "bg-blue-100 text-blue-800",
  bezahlt: "bg-green-100 text-green-800",
  teilbezahlt: "bg-yellow-100 text-yellow-800",
  storniert: "bg-red-100 text-red-800",
  abgelehnt: "bg-red-100 text-red-800",
  angenommen: "bg-green-100 text-green-800",
  verrechnet: "bg-purple-100 text-purple-800",
};

const statusLabels: Record<string, string> = {
  entwurf: "Entwurf",
  offen: "Offen",
  bezahlt: "Bezahlt",
  teilbezahlt: "Teilbezahlt",
  storniert: "Storniert",
  abgelehnt: "Abgelehnt",
  angenommen: "Angenommen",
  verrechnet: "Verrechnet",
};

// Rechnung: Kein Entwurf zurück, kein Storniert von außen (nur in Detail-Ansicht)
const rechnungStatuses = ["offen", "teilbezahlt", "bezahlt"];
const angebotStatuses = ["offen", "angenommen", "abgelehnt", "verrechnet"];

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTyp, setFilterTyp] = useState<string>("rechnung");
  const [filterStatus, setFilterStatus] = useState<string>("alle");
  const [searchQuery, setSearchQuery] = useState("");
  const [showArchive, setShowArchive] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportMonth, setExportMonth] = useState<string>(format(new Date(), "yyyy-MM"));
  const [exportMode, setExportMode] = useState<"month" | "year">("month");
  const [exporting, setExporting] = useState(false);
  const [bankKontoinhaber, setBankKontoinhaber] = useState("MONTI.PRO");
  const [bankIban, setBankIban] = useState("");
  const [bankBic, setBankBic] = useState("");
  const [createProjectDialogOpen, setCreateProjectDialogOpen] = useState(false);
  const [createProjectForInvoiceId, setCreateProjectForInvoiceId] = useState<string | null>(null);
  const [createProjectDefaults, setCreateProjectDefaults] = useState({ name: "", customerName: "", customerId: null as string | null, adresse: "", plz: "", ort: "", email: "", telefon: "", uidNummer: "", anrede: "", titel: "" });
  const [invoiceLayout, setInvoiceLayout] = useState<InvoiceLayoutSettings>(DEFAULT_LAYOUT);

  // Payment dialog for status change to teilbezahlt/bezahlt
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentInvoiceId, setPaymentInvoiceId] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<string>("bezahlt");
  const [paymentBetrag, setPaymentBetrag] = useState("");
  const [paymentDatum, setPaymentDatum] = useState(format(new Date(), "yyyy-MM-dd"));
  const [paymentNotiz, setPaymentNotiz] = useState("");
  const [existingPayments, setExistingPayments] = useState<{ betrag: number; datum: string; notiz: string | null; created_at: string }[]>([]);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    fetchInvoices();
    fetchNumberSettings();
  }, []);

  const fetchNumberSettings = async () => {
    const { data } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["bank_kontoinhaber", "bank_iban", "bank_bic", "invoice_layout"]);
    if (data) {
      data.forEach(s => {
        if (s.key === "bank_kontoinhaber") setBankKontoinhaber(s.value);
        if (s.key === "bank_iban") setBankIban(s.value);
        if (s.key === "bank_bic") setBankBic(s.value);
        if (s.key === "invoice_layout") setInvoiceLayout(parseLayoutSettings(s.value));
      });
    }
  };

  // Reset status filter when typ changes
  useEffect(() => {
    setFilterStatus("alle");
  }, [filterTyp]);

  const fetchInvoices = async () => {
    const { data, error } = await supabase
      .from("invoices")
      .select("id, typ, nummer, status, kunde_name, datum, brutto_summe, netto_summe, project_id, faellig_am, mahnstufe, gueltig_bis, bezahlt_betrag, archiviert, storno_nummer, storno_datum, kundennummer")
      .order("datum", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Rechnungen konnten nicht geladen werden" });
    } else {
      setInvoices((data || []).map(d => ({ ...d, mahnstufe: (d as any).mahnstufe || 0, gueltig_bis: (d as any).gueltig_bis || null, bezahlt_betrag: Number((d as any).bezahlt_betrag) || 0, archiviert: !!(d as any).archiviert })));
    }
    setLoading(false);
  };

  const handleStatusChange = async (invoiceId: string, newStatus: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const inv = invoices.find(i => i.id === invoiceId);
    if (!inv) return;

    // Prevent invalid backward status transitions
    const terminalStatuses = ["storniert", "bezahlt", "verrechnet"];
    if (terminalStatuses.includes(inv.status)) {
      toast({ variant: "destructive", title: "Status kann nicht geändert werden", description: `Status "${statusLabels[inv.status]}" ist endgültig` });
      return;
    }
    // Prevent backward transitions from teilbezahlt
    if (inv.status === "teilbezahlt" && (newStatus === "offen" || newStatus === "entwurf")) {
      toast({ variant: "destructive", title: "Nicht möglich", description: `Status kann nicht von "${statusLabels[inv.status]}" auf "${statusLabels[newStatus]}" zurückgesetzt werden` });
      return;
    }

    // For teilbezahlt/bezahlt: open payment dialog first
    if (newStatus === "teilbezahlt" || newStatus === "bezahlt") {
      setPaymentInvoiceId(invoiceId);
      setPaymentStatus(newStatus);
      setPaymentBetrag(newStatus === "bezahlt" && inv ? String((inv.brutto_summe - (inv.bezahlt_betrag || 0)).toFixed(2)) : "");
      setPaymentDatum(format(new Date(), "yyyy-MM-dd"));
      setPaymentNotiz("");
      // Load existing payments
      const { data: payments } = await supabase
        .from("invoice_payments")
        .select("betrag, datum, notiz, created_at")
        .eq("invoice_id", invoiceId)
        .order("datum", { ascending: true });
      setExistingPayments(payments || []);
      setPaymentDialogOpen(true);
      return;
    }

    const { error } = await supabase.from("invoices").update({ status: newStatus }).eq("id", invoiceId);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Status konnte nicht geändert werden" });
      return;
    }

    setInvoices(prev => prev.map(inv => inv.id === invoiceId ? { ...inv, status: newStatus } : inv));
    toast({ title: "Status geändert", description: `Status auf "${statusLabels[newStatus]}" gesetzt` });

    // When offer is accepted → open CreateProjectDialog
    if (newStatus === "angenommen") {
      const inv = invoices.find(i => i.id === invoiceId);
      if (inv && !inv.project_id) {
        const { data: fullInv } = await supabase
          .from("invoices")
          .select("kunde_name, kunde_adresse, kunde_plz, kunde_ort, customer_id, kunde_email, kunde_telefon, kunde_uid, kunde_anrede, kunde_titel")
          .eq("id", invoiceId)
          .single();

        if (fullInv) {
          setCreateProjectForInvoiceId(invoiceId);
          setCreateProjectDefaults({
            name: `${fullInv.kunde_name} - ${inv.nummer}`,
            customerName: fullInv.kunde_name || "",
            customerId: fullInv.customer_id || null,
            adresse: fullInv.kunde_adresse || "",
            plz: fullInv.kunde_plz || "",
            ort: fullInv.kunde_ort || "",
            email: (fullInv as any).kunde_email || "",
            telefon: (fullInv as any).kunde_telefon || "",
            uidNummer: (fullInv as any).kunde_uid || "",
            anrede: (fullInv as any).kunde_anrede || "",
            titel: (fullInv as any).kunde_titel || "",
          });
          setCreateProjectDialogOpen(true);
        }
      }
    }
  };

  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownloadPdf = async (invoiceId: string, nummer: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDownloadingId(invoiceId);
    try {
      // Load invoice + items + bank data
      const [{ data: inv }, { data: invItems }, { data: bankSettings }] = await Promise.all([
        supabase.from("invoices").select("*").eq("id", invoiceId).single(),
        supabase.from("invoice_items").select("*").eq("invoice_id", invoiceId).order("position"),
        supabase.from("app_settings").select("key, value").in("key", ["bank_kontoinhaber", "bank_iban", "bank_bic", "firmen_uid"]),
      ]);
      if (!inv) throw new Error("Rechnung nicht gefunden");

      const bank = { kontoinhaber: "MONTI.PRO", iban: bankIban, bic: bankBic };
      let firmenUid = "";
      if (bankSettings) {
        bankSettings.forEach((s: any) => {
          if (s.key === "bank_kontoinhaber") bank.kontoinhaber = s.value;
          if (s.key === "bank_iban") bank.iban = s.value;
          if (s.key === "bank_bic") bank.bic = s.value;
          if (s.key === "firmen_uid") firmenUid = s.value;
        });
      }

      // Load logo (prüft Custom-Logo aus Admin, fällt zurück auf Default)
      const logoUri = await loadInvoiceLogo();

      // QR code for invoices
      let qrUri: string | undefined;
      const { generateEpcQrCode } = await import("@/lib/invoiceHtml");
      if (inv.typ === "rechnung" && Number(inv.brutto_summe) > 0) {
        try { qrUri = await generateEpcQrCode(Number(inv.brutto_summe), inv.nummer || "", bank); } catch {}
      }

      const { generateInvoicePdf } = await import("@/lib/pdfGenerator");
      const pdfBlob = await generateInvoicePdf(
        {
          typ: inv.typ, nummer: inv.nummer, status: inv.status,
          kunde_name: inv.kunde_name, kunde_adresse: inv.kunde_adresse,
          kunde_plz: inv.kunde_plz, kunde_ort: inv.kunde_ort,
          kunde_land: inv.kunde_land, kunde_email: inv.kunde_email,
          kunde_telefon: inv.kunde_telefon, kunde_uid: inv.kunde_uid, kunde_anrede: inv.kunde_anrede || "", kunde_titel: inv.kunde_titel || "", reverse_charge: inv.reverse_charge || false,
          datum: inv.datum, faellig_am: inv.faellig_am,
          leistungsdatum: inv.leistungsdatum, gueltig_bis: inv.gueltig_bis,
          zahlungsbedingungen: inv.zahlungsbedingungen, notizen: inv.notizen,
          netto_summe: Number(inv.netto_summe), mwst_satz: Number(inv.mwst_satz),
          mwst_betrag: Number(inv.mwst_betrag), brutto_summe: Number(inv.brutto_summe),
          bezahlt_betrag: Number(inv.bezahlt_betrag), rabatt_prozent: Number(inv.rabatt_prozent),
          rabatt_betrag: Number(inv.rabatt_betrag), mahnstufe: Number(inv.mahnstufe),
          skonto_prozent: Number(inv.skonto_prozent || 0), skonto_tage: Number(inv.skonto_tage || 0),
        },
        (invItems || []).map((it: any) => ({
          position: it.position, beschreibung: it.beschreibung,
          kurztext: it.kurztext || it.beschreibung, langtext: it.langtext || "",
          menge: Number(it.menge), einheit: it.einheit || "Stk.",
          einzelpreis: Number(it.einzelpreis), gesamtpreis: Number(it.gesamtpreis),
        })),
        bank, logoUri, qrUri, firmenUid, invoiceLayout
      );

      // Direct download
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${nummer}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("PDF download error:", err);
      toast({ variant: "destructive", title: "Fehler", description: "PDF konnte nicht erstellt werden" });
    } finally {
      setDownloadingId(null);
    }
  };

  const handlePrintPdf = async (invoiceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      // Generate real PDF using jsPDF (same as download)
      const [{ data: inv }, { data: invItems }, { data: settings }] = await Promise.all([
        supabase.from("invoices").select("*").eq("id", invoiceId).single(),
        supabase.from("invoice_items").select("*").eq("invoice_id", invoiceId).order("position"),
        supabase.from("app_settings").select("key, value").in("key", ["bank_kontoinhaber", "bank_iban", "bank_bic", "firmen_uid"]),
      ]);
      if (!inv) throw new Error("Nicht gefunden");

      const bank = { kontoinhaber: bankKontoinhaber, iban: bankIban, bic: bankBic };
      let firmenUid = "";
      settings?.forEach((s: any) => {
        if (s.key === "bank_kontoinhaber") bank.kontoinhaber = s.value;
        if (s.key === "bank_iban") bank.iban = s.value;
        if (s.key === "bank_bic") bank.bic = s.value;
        if (s.key === "firmen_uid") firmenUid = s.value;
      });

      const logoUri = await loadInvoiceLogo();

      let qrUri: string | undefined;
      if (inv.typ === "rechnung" && Number(inv.brutto_summe) > 0) {
        try {
          const { generateEpcQrCode } = await import("@/lib/invoiceHtml");
          qrUri = await generateEpcQrCode(Number(inv.brutto_summe), inv.nummer || "", bank);
        } catch {}
      }

      const { generateInvoicePdf } = await import("@/lib/pdfGenerator");
      const pdfBlob = await generateInvoicePdf(
        {
          typ: inv.typ, nummer: inv.nummer, status: inv.status,
          kunde_name: inv.kunde_name, kunde_adresse: inv.kunde_adresse,
          kunde_plz: inv.kunde_plz, kunde_ort: inv.kunde_ort,
          kunde_land: inv.kunde_land, kunde_email: inv.kunde_email,
          kunde_telefon: inv.kunde_telefon, kunde_uid: inv.kunde_uid, kunde_anrede: inv.kunde_anrede || "", kunde_titel: inv.kunde_titel || "", reverse_charge: inv.reverse_charge || false,
          datum: inv.datum, faellig_am: inv.faellig_am,
          leistungsdatum: inv.leistungsdatum, gueltig_bis: inv.gueltig_bis,
          zahlungsbedingungen: inv.zahlungsbedingungen, notizen: inv.notizen,
          netto_summe: Number(inv.netto_summe), mwst_satz: Number(inv.mwst_satz),
          mwst_betrag: Number(inv.mwst_betrag), brutto_summe: Number(inv.brutto_summe),
          bezahlt_betrag: Number(inv.bezahlt_betrag), rabatt_prozent: Number(inv.rabatt_prozent),
          rabatt_betrag: Number(inv.rabatt_betrag), mahnstufe: Number(inv.mahnstufe),
          skonto_prozent: Number(inv.skonto_prozent || 0), skonto_tage: Number(inv.skonto_tage || 0),
        },
        (invItems || []).map((it: any) => ({
          position: it.position, beschreibung: it.beschreibung,
          kurztext: it.kurztext || it.beschreibung, langtext: it.langtext || "",
          menge: Number(it.menge), einheit: it.einheit || "Stk.",
          einzelpreis: Number(it.einzelpreis), gesamtpreis: Number(it.gesamtpreis),
        })),
        bank, logoUri, qrUri, firmenUid, invoiceLayout
      );

      // Open PDF in new tab for printing
      const url = URL.createObjectURL(pdfBlob);
      const win = window.open(url, "_blank");
      if (win) {
        win.addEventListener("load", () => {
          setTimeout(() => win.print(), 500);
        });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Fehler", description: err.message || "Drucken fehlgeschlagen" });
    }
  };

  const handleArchive = async (invoiceId: string, archive: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    const { error } = await supabase.from("invoices").update({ archiviert: archive }).eq("id", invoiceId);
    if (error) {
      toast({ variant: "destructive", title: "Fehler" });
    } else {
      setInvoices(prev => prev.map(inv => inv.id === invoiceId ? { ...inv, archiviert: archive } : inv));
      toast({ title: archive ? "Archiviert" : "Wiederhergestellt" });
    }
  };

  const handleDelete = async (invoiceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const inv = invoices.find(i => i.id === invoiceId);
    if (inv && inv.status !== "entwurf") {
      toast({ variant: "destructive", title: "Löschen nicht möglich", description: "Ausgestellte Rechnungen/Angebote können aus rechtlichen Gründen nicht gelöscht werden. Verwenden Sie stattdessen die Storno-Funktion." });
      return;
    }
    if (!confirm("Wirklich endgültig löschen?")) return;
    const { error } = await supabase.from("invoices").delete().eq("id", invoiceId);
    if (error) {
      toast({ variant: "destructive", title: "Fehler" });
    } else {
      setInvoices(prev => prev.filter(inv => inv.id !== invoiceId));
      toast({ title: "Gelöscht" });
    }
  };

  const handleExport = async () => {
    setExporting(true);
    const year = exportMonth.substring(0, 4);
    const month = exportMonth.substring(5, 7);

    let startDate: string, endDate: string, label: string;
    if (exportMode === "month") {
      startDate = `${year}-${month}-01`;
      const nextMonth = Number(month) === 12 ? `${Number(year) + 1}-01-01` : `${year}-${String(Number(month) + 1).padStart(2, "0")}-01`;
      endDate = nextMonth;
      label = format(parseISO(startDate), "MMMM yyyy", { locale: de });
    } else {
      startDate = `${year}-01-01`;
      endDate = `${Number(year) + 1}-01-01`;
      label = `Jahr ${year}`;
    }

    // Get matching invoices
    const toExport = invoices.filter(i => {
      const d = i.datum;
      return d >= startDate && d < endDate && i.status !== "entwurf";
    });

    if (toExport.length === 0) {
      toast({ title: "Keine Dokumente", description: `Keine Rechnungen/Angebote für ${label} gefunden` });
      setExporting(false);
      return;
    }

    // Open each PDF in sequence
    let success = 0;
    for (const inv of toExport) {
      try {
        const { data, error } = await supabase.functions.invoke("generate-invoice-pdf", {
          body: { invoiceId: inv.id },
        });
        if (error) continue;
        const html = decodeURIComponent(escape(atob(data.pdf)));
        const win = window.open("", "_blank");
        if (win) {
          win.document.write(html);
          win.document.close();
          win.document.title = `${inv.nummer} - ${inv.kunde_name}`;
        }
        success++;
      } catch {
        // skip
      }
    }
    toast({ title: `${success} PDFs geöffnet`, description: `Export für ${label}` });
    setExporting(false);
    setExportDialogOpen(false);
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isOverdue = (inv: Invoice) =>
    inv.typ === "rechnung" &&
    inv.faellig_am &&
    (inv.status === "offen" || inv.status === "teilbezahlt") &&
    isBefore(parseISO(inv.faellig_am), today);

  const isExpiredOffer = (inv: Invoice) =>
    inv.typ === "angebot" &&
    inv.gueltig_bis &&
    inv.status === "offen" &&
    isBefore(parseISO(inv.gueltig_bis), today);

  const filtered = invoices.filter(i => {
    const matchSearch = !searchQuery.trim() ||
      matchesSearch(i.nummer, searchQuery) ||
      matchesSearch((i as any).storno_nummer, searchQuery) ||
      matchesSearch(i.kunde_name, searchQuery) ||
      String(i.brutto_summe).includes(searchQuery) ||
      i.brutto_summe.toFixed(2).includes(searchQuery);
    const matchArchive = showArchive ? true : !i.archiviert;

    // Tab "storno" → NUR stornierte Rechnungen
    if (filterTyp === "storno") {
      return matchSearch && matchArchive && i.status === "storniert";
    }
    // Sonst nach Typ filtern, Stornierte ausschließen
    const matchTyp = i.typ === filterTyp;
    if (i.status === "storniert") return false;
    const matchStatus = filterStatus === "alle" ? true : i.status === filterStatus;
    return matchTyp && matchStatus && matchSearch && matchArchive;
  });

  const storniertCount = invoices.filter(i => i.status === "storniert").length;

  const totalRechnungen = invoices.filter(i => i.typ === "rechnung" && i.status !== "storniert").length;
  const totalAngebote = invoices.filter(i => i.typ === "angebot" && i.status !== "storniert").length;
  const offeneSumme = invoices
    .filter(i => i.typ === "rechnung" && (i.status === "offen" || i.status === "teilbezahlt"))
    .reduce((sum, i) => sum + Number(i.brutto_summe) - i.bezahlt_betrag, 0);
  const bezahlteSumme = invoices
    .filter(i => i.typ === "rechnung" && (i.status === "bezahlt" || i.status === "teilbezahlt"))
    .reduce((sum, i) => sum + i.bezahlt_betrag, 0);

  // Status options for the filter depend on selected typ
  const statusFilterOptions = filterTyp === "rechnung"
    ? rechnungStatuses
    : filterTyp === "angebot"
      ? angebotStatuses
      : [...new Set([...rechnungStatuses, ...angebotStatuses])];

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-[1600px]">
        <PageHeader title="Rechnungen & Angebote" backPath="/" />

        {/* Kompakte Stats — kontextuell gefiltert */}
        {(() => {
          if (filterTyp === "storno") {
            const stornoDocs = invoices.filter(i => i.status === "storniert");
            const summe = stornoDocs.reduce((s, i) => s + Number(i.brutto_summe), 0);
            return (
              <div className="grid grid-cols-2 gap-3 mb-4">
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">Storno-Belege</p>
                    <p className="text-xl font-bold">{stornoDocs.length}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">Stornierte Summe</p>
                    <p className="text-xl font-bold text-red-600">€ {summe.toFixed(2)}</p>
                  </CardContent>
                </Card>
              </div>
            );
          }
          const visibleInvoices = invoices.filter(i => i.typ === filterTyp && i.status !== "storniert");
          const count = visibleInvoices.length;
          const openBrutto = visibleInvoices.filter(i => i.typ === "rechnung" && (i.status === "offen" || i.status === "teilbezahlt")).reduce((s, i) => s + (Number(i.brutto_summe) - Number(i.bezahlt_betrag || 0)), 0);
          const overdue = visibleInvoices.filter(i => isOverdue(i)).length;
          return (
            <div className="grid grid-cols-3 gap-3 mb-4">
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">{filterTyp === "rechnung" ? "Rechnungen" : "Angebote"}</p>
                  <p className="text-xl font-bold">{count}</p>
                </CardContent>
              </Card>
              {filterTyp === "rechnung" ? (
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">Offener Betrag</p>
                    <p className="text-xl font-bold text-orange-600">€ {openBrutto.toFixed(2)}</p>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">Summe</p>
                    <p className="text-xl font-bold">€ {visibleInvoices.reduce((s, i) => s + Number(i.brutto_summe), 0).toFixed(2)}</p>
                  </CardContent>
                </Card>
              )}
              <Card className={overdue > 0 ? "border-red-300" : ""}>
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Überfällig</p>
                  <p className={`text-xl font-bold ${overdue > 0 ? "text-red-600" : ""}`}>{overdue}</p>
                </CardContent>
              </Card>
            </div>
          );
        })()}

        <Card>
          <CardHeader className="pb-3 space-y-3">
            {/* Titel + Tabs + primäre Aktion */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex rounded-md border overflow-hidden">
                <button
                  onClick={() => setFilterTyp("rechnung")}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${filterTyp === "rechnung" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                >
                  Rechnungen
                </button>
                <button
                  onClick={() => setFilterTyp("angebot")}
                  className={`px-4 py-2 text-sm font-medium transition-colors border-l ${filterTyp === "angebot" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                >
                  Angebote
                </button>
                <button
                  onClick={() => setFilterTyp("storno")}
                  className={`px-4 py-2 text-sm font-medium transition-colors border-l ${filterTyp === "storno" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                  title="Stornierte Rechnungen / Storno-Belege"
                >
                  Storno-Belege
                  {storniertCount > 0 && (
                    <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] ${filterTyp === "storno" ? "bg-primary-foreground/20" : "bg-muted"}`}>
                      {storniertCount}
                    </span>
                  )}
                </button>
              </div>
              <div className="flex gap-2">
                {filterTyp !== "storno" && (
                  <Button
                    onClick={() => navigate(filterTyp === "angebot" ? "/invoices/new?typ=angebot" : "/invoices/new?typ=rechnung")}
                    variant="default"
                    className="gap-2"
                  >
                    {filterTyp === "angebot" ? <FileText className="w-4 h-4" /> : <Receipt className="w-4 h-4" />}
                    {filterTyp === "angebot" ? "Neues Angebot" : "Neue Rechnung"}
                  </Button>
                )}
                <Button onClick={() => setExportDialogOpen(true)} variant="outline" className="gap-2">
                  <FileDown className="w-4 h-4" />
                  Export
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" title="Mehr Aktionen">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setShowArchive(!showArchive)}>
                      <Archive className="h-4 w-4 mr-2" />
                      {showArchive ? "Archiv ausblenden" : "Archiv anzeigen"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate("/admin")}>
                      <Settings className="h-4 w-4 mr-2" /> Nummernkreise
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Schlanke Filter-Zeile */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Input
                  placeholder={filterTyp === "storno" ? "Storno-Nr., Rechnungsnr., Kunde..." : "Nummer, Kunde oder Betrag suchen..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9"
                />
              </div>
              {filterTyp !== "storno" && (
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-[150px] h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="alle">Alle Status</SelectItem>
                    {statusFilterOptions.map(s => (
                      <SelectItem key={s} value={s}>{statusLabels[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-center py-8 text-muted-foreground">Lädt...</p>
            ) : filtered.length === 0 ? (
              filterTyp === "storno" ? (
                <EmptyState
                  icon={<Receipt className="w-12 h-12" />}
                  title="Keine Storno-Belege"
                  description="Hier erscheinen stornierte Rechnungen. Aktuell ist nichts storniert."
                />
              ) : (
                <EmptyState
                  icon={filterTyp === "angebot" ? <FileText className="w-12 h-12" /> : <Receipt className="w-12 h-12" />}
                  title={filterTyp === "angebot" ? "Noch keine Angebote" : "Noch keine Rechnungen"}
                  description={filterTyp === "angebot" ? "Erstelle dein erstes Angebot für einen Kunden." : "Erstelle deine erste Rechnung."}
                  action={{
                    label: filterTyp === "angebot" ? "Erstes Angebot erstellen" : "Erste Rechnung erstellen",
                    onClick: () => navigate(`/invoices/new?typ=${filterTyp}`),
                  }}
                />
              )
            ) : filterTyp === "storno" ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Storno-Nr.</TableHead>
                      <TableHead>Original Rechnung</TableHead>
                      <TableHead>Kunde</TableHead>
                      <TableHead>Storno-Datum</TableHead>
                      <TableHead>Grund</TableHead>
                      <TableHead className="text-right">Betrag</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((inv) => (
                      <TableRow key={inv.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/invoices/${inv.id}`)}>
                        <TableCell className="font-mono font-medium">{(inv as any).storno_nummer || "—"}</TableCell>
                        <TableCell className="font-mono text-muted-foreground">{inv.nummer}</TableCell>
                        <TableCell>{inv.kunde_name}</TableCell>
                        <TableCell>{formatDateShort((inv as any).storno_datum)}</TableCell>
                        <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{(inv as any).storno_grund || "—"}</TableCell>
                        <TableCell className="text-right font-medium">€ {Number(inv.brutto_summe).toFixed(2)}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={async (e) => {
                              e.stopPropagation();
                              // Download Storno-PDF
                              try {
                                const logoUri = await loadInvoiceLogo();
                                const bank = { kontoinhaber: bankKontoinhaber, iban: bankIban, bic: bankBic };
                                const { generateStornoPdf } = await import("@/lib/pdfGenerator");
                                const pdfBlob = generateStornoPdf(
                                  { nummer: inv.nummer, kunde_name: inv.kunde_name, brutto_summe: Number(inv.brutto_summe), datum: inv.datum },
                                  (inv as any).storno_nummer || "",
                                  (inv as any).storno_datum || new Date().toISOString().split("T")[0],
                                  (inv as any).storno_grund || "",
                                  bank, logoUri, invoiceLayout
                                );
                                const url = URL.createObjectURL(pdfBlob);
                                const a = document.createElement("a"); a.href = url;
                                a.download = `Storno_${(inv as any).storno_nummer || inv.nummer}.pdf`; a.click();
                                URL.revokeObjectURL(url);
                              } catch (err: any) {
                                toast({ variant: "destructive", title: "Fehler", description: err.message });
                              }
                            }}
                            title="Storno-Beleg herunterladen"
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nummer</TableHead>
                      <TableHead>Kunde</TableHead>
                      <TableHead>Datum</TableHead>
                      <TableHead className="text-right">Brutto</TableHead>
                      {filterTyp !== "angebot" && <TableHead className="text-right">Bezahlt</TableHead>}
                      <TableHead>Status</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((inv) => {
                      const overdue = isOverdue(inv);
                      const expired = isExpiredOffer(inv);
                      const brutto = Number(inv.brutto_summe);
                      const bezahlt = inv.bezahlt_betrag;
                      const offen = brutto - bezahlt;
                      const availableStatuses = inv.typ === "rechnung" ? rechnungStatuses : angebotStatuses;
                      return (
                        <TableRow
                          key={inv.id}
                          className={`cursor-pointer hover:bg-muted/50 ${overdue ? "bg-red-50" : ""}`}
                          onClick={() => navigate(`/invoices/${inv.id}`)}
                        >
                          <TableCell className="font-mono font-medium">{inv.nummer}</TableCell>
                          <TableCell>{inv.kunde_name}</TableCell>
                          <TableCell>{formatDateShort(inv.datum)}</TableCell>
                          <TableCell className="text-right font-medium">€ {brutto.toFixed(2)}</TableCell>
                          {filterTyp !== "angebot" && (
                            <TableCell className="text-right">
                              {inv.typ === "rechnung" ? (
                                <div>
                                  {inv.status === "bezahlt" ? (
                                    <span className="text-green-600 font-medium">€ {brutto.toFixed(2)}</span>
                                  ) : bezahlt > 0 ? (
                                    <div>
                                      <span className="text-yellow-600 font-medium">€ {bezahlt.toFixed(2)}</span>
                                      <div className="text-xs text-muted-foreground">offen: € {offen.toFixed(2)}</div>
                                    </div>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          )}
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            {(() => {
                              // Status-Dot Farbe
                              const dotColor =
                                inv.status === "bezahlt" || inv.status === "angenommen" ? "bg-green-500" :
                                inv.status === "storniert" || inv.status === "abgelehnt" ? "bg-red-500" :
                                overdue ? "bg-red-500" :
                                inv.status === "teilbezahlt" ? "bg-yellow-500" :
                                inv.status === "verrechnet" ? "bg-blue-500" :
                                "bg-orange-500";
                              // Warnungen als subtiler Sub-Text
                              const warn = overdue ? "überfällig" : expired ? "abgelaufen" : inv.mahnstufe > 0 ? `Mahnung ${inv.mahnstufe}` : "";
                              return (
                                <div className="flex items-center gap-2">
                                  <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                                  {inv.status === "storniert" ? (
                                    <span className="text-xs font-medium text-red-700">
                                      Storniert{(inv as any).storno_nummer ? ` (${(inv as any).storno_nummer})` : ""}
                                    </span>
                                  ) : (
                                    <Select
                                      value={inv.status}
                                      onValueChange={(val) => {
                                        const fakeEvent = { stopPropagation: () => {} } as React.MouseEvent;
                                        handleStatusChange(inv.id, val, fakeEvent);
                                      }}
                                    >
                                      <SelectTrigger className="h-7 text-xs font-medium border-0 shadow-none bg-transparent px-1 hover:bg-muted w-auto min-w-[90px]">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {availableStatuses.map(s => (
                                          <SelectItem key={s} value={s}>{statusLabels[s]}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}
                                  {warn && (
                                    <span className="text-[10px] text-red-600 font-medium">{warn}</span>
                                  )}
                                </div>
                              );
                            })()}
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" title="Aktionen">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={(e) => handleDownloadPdf(inv.id, inv.nummer, e as any)} disabled={downloadingId === inv.id}>
                                  <Download className="h-4 w-4 mr-2" /> PDF herunterladen
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={(e) => handlePrintPdf(inv.id, e as any)}>
                                  <Printer className="h-4 w-4 mr-2" /> Drucken
                                </DropdownMenuItem>
                                {inv.typ === "rechnung" && isOverdue(inv) && (
                                  <DropdownMenuItem
                                    className="text-red-600 focus:text-red-700"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      try {
                                        const logoUri = await loadInvoiceLogo();
                                        const bank = { kontoinhaber: bankKontoinhaber, iban: bankIban, bic: bankBic };
                                        const stufe = Number(inv.mahnstufe || 0) + 1;
                                        if (stufe > 3) { toast({ variant: "destructive", title: "Maximum erreicht", description: "Mahnstufe 3 ist das Maximum" }); return; }
                                        const { generateMahnungPdf } = await import("@/lib/pdfGenerator");
                                        const pdfBlob = generateMahnungPdf(
                                          {
                                            nummer: inv.nummer, datum: inv.datum, faellig_am: inv.faellig_am || "",
                                            kunde_name: inv.kunde_name, kunde_adresse: inv.kunde_adresse,
                                            kunde_plz: inv.kunde_plz, kunde_ort: inv.kunde_ort,
                                            brutto_summe: Number(inv.brutto_summe), bezahlt_betrag: Number(inv.bezahlt_betrag || 0),
                                          },
                                          stufe, 0, bank, logoUri, invoiceLayout
                                        );
                                        await supabase.from("invoices").update({ mahnstufe: stufe }).eq("id", inv.id);
                                        const url = URL.createObjectURL(pdfBlob);
                                        const a = document.createElement("a"); a.href = url;
                                        a.download = `Mahnung_${stufe}_${inv.nummer}.pdf`; a.click();
                                        URL.revokeObjectURL(url);
                                        toast({ title: `Mahnung ${stufe} erstellt` });
                                        fetchInvoices();
                                      } catch (err: any) {
                                        toast({ variant: "destructive", title: "Fehler", description: err.message });
                                      }
                                    }}
                                  >
                                    <AlertTriangle className="h-4 w-4 mr-2" /> Mahnung {Number(inv.mahnstufe || 0) + 1} erstellen
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>


        {/* Export Dialog */}
        <ExportInvoicesDialog
          open={exportDialogOpen}
          onClose={() => setExportDialogOpen(false)}
          bankData={{ kontoinhaber: bankKontoinhaber, iban: bankIban, bic: bankBic }}
        />
        {/* Create Project Dialog (when offer accepted) */}
        <CreateProjectDialog
          open={createProjectDialogOpen}
          onClose={() => setCreateProjectDialogOpen(false)}
          onCreated={async (newProject) => {
            if (createProjectForInvoiceId) {
              await supabase.from("invoices").update({ project_id: newProject.id }).eq("id", createProjectForInvoiceId);
              setInvoices(prev => prev.map(i => i.id === createProjectForInvoiceId ? { ...i, project_id: newProject.id } : i));
            }
            setCreateProjectDialogOpen(false);
            setCreateProjectForInvoiceId(null);
          }}
          defaultName={createProjectDefaults.name}
          defaultCustomerId={createProjectDefaults.customerId}
          defaultCustomerName={createProjectDefaults.customerName}
          defaultAdresse={createProjectDefaults.adresse}
          defaultPlz={createProjectDefaults.plz}
          defaultOrt={createProjectDefaults.ort}
          defaultEmail={createProjectDefaults.email}
          defaultTelefon={createProjectDefaults.telefon}
          defaultUidNummer={createProjectDefaults.uidNummer}
          defaultAnrede={createProjectDefaults.anrede}
          defaultTitel={createProjectDefaults.titel}
        />

        {/* Payment Dialog for Teilbezahlt/Bezahlt */}
        <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {paymentStatus === "bezahlt" ? "Zahlung erfassen" : "Teilzahlung erfassen"}
              </DialogTitle>
            </DialogHeader>

            {/* Invoice summary — always visible */}
            {(() => {
              const inv = invoices.find(i => i.id === paymentInvoiceId);
              const brutto = inv?.brutto_summe || 0;
              const bereitsGezahlt = existingPayments.reduce((s, p) => s + Number(p.betrag), 0);
              const offen = brutto - bereitsGezahlt;
              return (
                <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Rechnungsbetrag (brutto):</span>
                    <span className="font-bold">€ {brutto.toFixed(2)}</span>
                  </div>
                  {bereitsGezahlt > 0 && (
                    <div className="flex justify-between text-sm text-green-700">
                      <span>Bereits bezahlt:</span>
                      <span className="font-medium">€ {bereitsGezahlt.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold text-orange-600 border-t pt-1">
                    <span>Noch offen:</span>
                    <span>€ {offen.toFixed(2)}</span>
                  </div>

                  {/* Existing payment history */}
                  {existingPayments.length > 0 && (
                    <div className="border-t pt-2 mt-1 space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Zahlungshistorie:</p>
                      {existingPayments.map((p, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs">
                          <div>
                            <span className="font-medium text-green-700">€ {Number(p.betrag).toFixed(2)}</span>
                            <span className="text-muted-foreground ml-2">{new Date(p.datum).toLocaleDateString("de-AT")}</span>
                          </div>
                          {p.notiz && <span className="text-muted-foreground italic">{p.notiz}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* New payment */}
            {(() => {
              const inv = invoices.find(i => i.id === paymentInvoiceId);
              const maxBetrag = (inv?.brutto_summe || 0) - existingPayments.reduce((s, p) => s + Number(p.betrag), 0);
              return (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Betrag (€) <span className="text-muted-foreground font-normal">max. € {maxBetrag.toFixed(2)}</span></Label>
                  <Input
                    type="number"
                    value={paymentBetrag}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      if (val > maxBetrag) setPaymentBetrag(maxBetrag.toFixed(2));
                      else setPaymentBetrag(e.target.value);
                    }}
                    placeholder="0,00"
                    step="0.01"
                    min="0"
                    max={maxBetrag}
                  />
                </div>
                <div>
                  <Label>Zahlungsdatum</Label>
                  <Input
                    type="date"
                    value={paymentDatum}
                    onChange={(e) => setPaymentDatum(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label>Notiz (optional)</Label>
                <Input
                  value={paymentNotiz}
                  onChange={(e) => setPaymentNotiz(e.target.value)}
                  placeholder="z.B. Überweisung, Bar, Teilzahlung Anzahlung..."
                />
              </div>
            </div>
              );
            })()}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>Abbrechen</Button>
              <Button onClick={async () => {
                if (!paymentInvoiceId || !paymentBetrag) return;
                const betrag = parseFloat(paymentBetrag);
                if (isNaN(betrag) || betrag <= 0) {
                  toast({ variant: "destructive", title: "Ungültiger Betrag" });
                  return;
                }

                const inv = invoices.find(i => i.id === paymentInvoiceId);
                const maxBetrag = Math.round(((inv?.brutto_summe || 0) - (inv?.bezahlt_betrag || 0)) * 100) / 100;
                if (betrag > maxBetrag) {
                  toast({ variant: "destructive", title: "Betrag zu hoch", description: `Maximaler Betrag: €${maxBetrag.toFixed(2)}` });
                  return;
                }

                await supabase.from("invoice_payments").insert({
                  invoice_id: paymentInvoiceId,
                  betrag,
                  datum: paymentDatum,
                  notiz: paymentNotiz.trim() || null,
                });

                const newBezahlt = (inv?.bezahlt_betrag || 0) + betrag;
                const newStatus = newBezahlt >= (inv?.brutto_summe || 0) ? "bezahlt" : "teilbezahlt";

                await supabase.from("invoices").update({
                  status: newStatus,
                  bezahlt_betrag: newBezahlt,
                }).eq("id", paymentInvoiceId);

                setInvoices(prev => prev.map(i =>
                  i.id === paymentInvoiceId ? { ...i, status: newStatus, bezahlt_betrag: newBezahlt } : i
                ));

                toast({
                  title: newStatus === "bezahlt" ? "Vollständig bezahlt" : "Teilzahlung erfasst",
                  description: `€ ${betrag.toFixed(2)} am ${new Date(paymentDatum).toLocaleDateString("de-AT")}`,
                });
                setPaymentDialogOpen(false);
              }}>
                Zahlung speichern
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

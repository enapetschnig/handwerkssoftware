import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, Camera, ImagePlus, Lock, Pencil, Check, Settings, ClipboardList, MessageSquare, Download, FileDown, UserPlus, Plus, FolderTree, ExternalLink } from "lucide-react";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import { getDocConfig } from "@/lib/documentTypes";
import { Separator } from "@/components/ui/separator";
import { format, parseISO } from "date-fns";
import { ContactHistoryTimeline } from "@/components/ContactHistoryTimeline";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useConfigOptions } from "@/hooks/useConfigOptions";
import { useProjectStatuses } from "@/hooks/useProjectStatuses";
import { Badge } from "@/components/ui/badge";

type DocumentCategory = {
  type: "plans" | "reports" | "photos" | "chef";
  title: string;
  description: string;
  icon: React.ReactNode;
  count: number;
  adminOnly?: boolean;
};

const ProjectOverview = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [projectName, setProjectName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  // Unterprojekt-Anlegen-Dialog (nur bei Hauptprojekten relevant)
  const [createSubProjectOpen, setCreateSubProjectOpen] = useState(false);
  // Geschwister-Projekte (Sub-Liste bei Hauptprojekten, Parent-Anzeige bei Unterprojekten)
  const [childProjects, setChildProjects] = useState<{ id: string; name: string; status: string | null }[]>([]);
  const [parentProjectInfo, setParentProjectInfo] = useState<{ id: string; name: string } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const { options: projektartOptions } = useConfigOptions("projektart");
  const { options: prioritaetOptions } = useConfigOptions("prioritaet");
  const { options: bereichOptions } = useConfigOptions("projekt_bereich");
  const { statuses: projectStatuses, findByName: findStatusByName } = useProjectStatuses();
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [employees, setEmployees] = useState<{id: string, vorname: string, nachname: string}[]>([]);
  const [editForm, setEditForm] = useState({
    name: "", beschreibung: "",
    // Kunden-/Rechnungsadresse (gespeichert in customers)
    customer_id: null as string | null, kunde_name: "", kunde_anrede: "", kunde_titel: "",
    kunde_adresse: "", kunde_plz: "", kunde_ort: "", kunde_email: "", kunde_telefon: "", kunde_uid: "",
    // Projekt-/Leistungsort (gespeichert in projects)
    projekt_adresse: "", projekt_plz: "", projekt_ort: "",
    projekt_kontakt_name: "", projekt_kontakt_telefon: "",
    // Sonstiges Projekt
    bereich: "",
    kategorie: "",  // Geschäftsbereich für Google Calendar
    projektart: "", prioritaet: "normal", geplanter_start: "", geplantes_ende: "",
    budget: "", auftragsvolumen: "", bauleiter_id: "",
    zugewiesene_mitarbeiter: [] as string[],
    // Haupt-/Unterprojekt
    projekt_typ: "einzelprojekt",
    parent_project_id: null as string | null,
  });
  const [customers, setCustomers] = useState<{ id: string; name: string; plz: string | null; ort: string | null }[]>([]);
  // Liste aller verfügbaren Hauptprojekte für den parent-Picker im Edit-Dialog.
  // Self-Reference ist nicht möglich (eigener id wird ausgefiltert).
  const [availableParentProjects, setAvailableParentProjects] = useState<{ id: string; name: string }[]>([]);
  const [customerData, setCustomerData] = useState<any>(null);
  const [customerPopoverOpen, setCustomerPopoverOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [invoiceCount, setInvoiceCount] = useState(0);
  const [btbCount, setBtbCount] = useState(0);
  const [regieCount, setRegieCount] = useState(0);
  const [protokollCount, setProtokollCount] = useState(0);
  const [projectProtokolle, setProjectProtokolle] = useState<{ id: string; nummer: string | null; datum: string; typ: string | null; ort: string | null; kind: "protokoll" | "ersttermin"; linked?: boolean }[]>([]);
  const [regiePdfs, setRegiePdfs] = useState<{id: string; datum: string; kunde_name: string; pdf_path: string}[]>([]);
  const [purchaseInvoices, setPurchaseInvoices] = useState<{id: string; lieferant: string; rechnungsdatum: string | null; betrag_brutto: number; status: string; kategorie: string | null}[]>([]);
  const [projectData, setProjectData] = useState<any>(null);
  const [projectHours, setProjectHours] = useState<{user_id: string, name: string, total: number}[]>([]);
  const [angebotPositionen, setAngebotPositionen] = useState<{position: number; beschreibung: string; menge: number; einheit: string}[]>([]);
  const [categories, setCategories] = useState<DocumentCategory[]>([
    {
      type: "photos",
      title: "Fotos",
      description: "Baufortschritt und Dokumentationsfotos",
      icon: <Camera className="h-8 w-8" />,
      count: 0,
    },
    {
      type: "plans",
      title: "Pläne",
      description: "Baupläne und technische Zeichnungen",
      icon: <FileText className="h-8 w-8" />,
      count: 0,
    },
    {
      type: "chef",
      title: "🔒 Chefordner",
      description: "Vertrauliche Chef-Dokumente",
      icon: <Lock className="h-8 w-8" />,
      count: 0,
      adminOnly: true,
    },
  ]);

  useEffect(() => {
    if (projectId) {
      checkAdminStatus();
      fetchProjectName();
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) {
      fetchFileCounts();
      fetchInvoiceCount();
      fetchAngebotPositionen();
    }
  }, [projectId, isAdmin]);

  const fetchAngebotPositionen = async () => {
    if (!projectId) return;
    const { data: angebote } = await supabase.from("invoices")
      .select("id").eq("project_id", projectId).eq("typ", "angebot")
      .not("status", "eq", "storniert")
      .order("datum", { ascending: false }).limit(1);
    if (angebote?.[0]) {
      const { data: items } = await supabase.from("invoice_items")
        .select("position, beschreibung, kurztext, menge, einheit")
        .eq("invoice_id", angebote[0].id).order("position");
      setAngebotPositionen((items || []).map(i => ({
        position: i.position, beschreibung: (i as any).kurztext || i.beschreibung,
        menge: Number(i.menge), einheit: i.einheit || "Stk.",
      })));
    }
  };

  const checkAdminStatus = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "administrator")
      .maybeSingle();

    setIsAdmin(!!data);

    // Fetch project hours for admins
    if (data && projectId) {
      const { data: entries } = await supabase
        .from("time_entries")
        .select("user_id, stunden")
        .eq("project_id", projectId);

      if (entries) {
        const grouped: Record<string, number> = {};
        entries.forEach((e: any) => { grouped[e.user_id] = (grouped[e.user_id] || 0) + Number(e.stunden); });

        const userIds = Object.keys(grouped);
        if (userIds.length > 0) {
          const { data: profiles } = await (supabase.from("profiles" as never) as any)
            .select("id, vorname, nachname, hidden").in("id", userIds);

          setProjectHours(
            userIds
              .filter((uid) => {
                const p = (profiles as any[])?.find((pr: any) => pr.id === uid);
                return !p || !p.hidden; // hidden User nicht in der Projekt-Stundenliste
              })
              .map(uid => {
                const p = (profiles as any[])?.find((pr: any) => pr.id === uid);
                return { user_id: uid, name: p ? `${p.vorname} ${p.nachname}` : "Unbekannt", total: grouped[uid] };
              }).sort((a, b) => b.total - a.total)
          );
        }
      }
    }
  };

  const openEditDialog = async () => {
    if (!projectId) return;
    // Load project
    const { data: proj } = await supabase.from("projects").select("*").eq("id", projectId).single();
    if (!proj) return;
    // Parse adresse (stored as "street, plz, city")
    const parts = (proj.adresse || "").split(",").map((s: string) => s.trim());
    // Load customer
    let kunde: any = {};
    if (proj.customer_id) {
      const { data: c } = await supabase.from("customers").select("*").eq("id", proj.customer_id).single();
      if (c) kunde = c;
    }
    // Load customer list + employees
    const [{ data: custs }, { data: emps }, { data: hiddenProfs }] = await Promise.all([
      supabase.from("customers").select("id, name, plz, ort").order("name"),
      (supabase.from("employees" as never) as any).select("id, vorname, nachname, user_id").eq("aktiv", true).order("nachname"),
      (supabase.from("profiles" as never) as any).select("id").eq("hidden", true),
    ]);
    const hiddenIds = new Set(((hiddenProfs as any[]) || []).map((p: any) => p.id));
    setCustomers(custs || []);
    setEmployees(((emps as any[]) || []).filter((e: any) => !e.user_id || !hiddenIds.has(e.user_id)));
    // Hauptprojekte für den parent-Picker laden — eigenes Projekt ausschließen
    // (kein Self-Reference) sowie nur Hauptprojekte zur Auswahl anbieten.
    const { data: parentProjs } = await (supabase.from("projects" as never) as any)
      .select("id, name")
      .eq("projekt_typ", "hauptprojekt")
      .neq("id", proj.id)
      .order("name");
    setAvailableParentProjects(((parentProjs as { id: string; name: string }[]) || []));
    setEditForm({
      name: proj.name || "",
      beschreibung: proj.beschreibung || "",
      customer_id: proj.customer_id || null,
      // Kundenadresse (aus customers-Tabelle, für Rechnungsstellung)
      kunde_name: kunde.name || "",
      kunde_anrede: kunde.anrede || "",
      kunde_titel: kunde.titel || "",
      kunde_adresse: kunde.adresse || "",
      kunde_plz: kunde.plz || "",
      kunde_ort: kunde.ort || "",
      kunde_email: kunde.email || "",
      kunde_telefon: kunde.telefon || "",
      kunde_uid: kunde.uid_nummer || "",
      // Leistungsort / Durchführungsort (aus projects-Tabelle)
      projekt_adresse: proj.adresse || parts[0] || "",
      projekt_plz: proj.plz || parts[1] || "",
      projekt_ort: (proj as any).ort || parts[2] || "",
      projekt_kontakt_name: (proj as any).projekt_kontakt_name || "",
      projekt_kontakt_telefon: (proj as any).projekt_kontakt_telefon || "",
      // Sonstiges
      bereich: (proj as any).bereich || "",
      kategorie: (proj as any).kategorie || "",
      projektart: (proj as any).projektart || "",
      prioritaet: (proj as any).prioritaet || "normal",
      geplanter_start: (proj as any).geplanter_start || "",
      geplantes_ende: (proj as any).geplantes_ende || "",
      budget: (proj as any).budget != null ? String((proj as any).budget) : "",
      auftragsvolumen: (proj as any).auftragsvolumen != null ? String((proj as any).auftragsvolumen) : "",
      bauleiter_id: (proj as any).bauleiter_id || "",
      zugewiesene_mitarbeiter: Array.isArray((proj as any).zugewiesene_mitarbeiter)
        ? ((proj as any).zugewiesene_mitarbeiter as string[])
        : [],
      // Haupt-/Unterprojekt-Verknüpfung (Migration 20260615200000)
      projekt_typ: (proj as any).projekt_typ || "einzelprojekt",
      parent_project_id: (proj as any).parent_project_id || null,
    });
    setEditDialogOpen(true);
  };

  const handleEditSave = async () => {
    if (!projectId || !editForm.name.trim()) return;

    // H-1: Start/Ende-Konsistenz
    if (editForm.geplanter_start && editForm.geplantes_ende && editForm.geplantes_ende < editForm.geplanter_start) {
      toast({ variant: "destructive", title: "Zeitraum ungültig", description: "Geplantes Ende darf nicht vor dem geplanten Start liegen." });
      return;
    }
    // H-2: Budget/Auftragsvolumen nicht negativ
    if (editForm.budget && Number(editForm.budget) < 0) {
      toast({ variant: "destructive", title: "Budget ungültig", description: "Budget darf nicht negativ sein." });
      return;
    }
    if (editForm.auftragsvolumen && Number(editForm.auftragsvolumen) < 0) {
      toast({ variant: "destructive", title: "Auftragsvolumen ungültig", description: "Auftragsvolumen darf nicht negativ sein." });
      return;
    }
    // E-Mail-Validierung wenn Kunde editiert wird
    if (editForm.kunde_email && editForm.kunde_email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.kunde_email.trim())) {
      toast({ variant: "destructive", title: "Ungültige E-Mail" });
      return;
    }

    setEditSaving(true);
    // Update project — adresse/plz/ort = LEISTUNGSORT (NICHT die Kundenadresse!)
    await supabase.from("projects").update({
      name: editForm.name.trim(),
      beschreibung: editForm.beschreibung.trim() || null,
      adresse: editForm.projekt_adresse.trim() || null,
      plz: editForm.projekt_plz.trim() || null,
      ort: editForm.projekt_ort.trim() || null,
      projekt_kontakt_name: editForm.projekt_kontakt_name.trim() || null,
      projekt_kontakt_telefon: editForm.projekt_kontakt_telefon.trim() || null,
      bereich: editForm.bereich || null,
      kategorie: editForm.kategorie || null,
      customer_id: editForm.customer_id,
      projektart: editForm.projektart || null,
      prioritaet: editForm.prioritaet || "normal",
      geplanter_start: editForm.geplanter_start || null,
      geplantes_ende: editForm.geplantes_ende || null,
      budget: editForm.budget ? parseFloat(editForm.budget) : null,
      auftragsvolumen: editForm.auftragsvolumen ? parseFloat(editForm.auftragsvolumen) : null,
      bauleiter_id: editForm.bauleiter_id || null,
      zugewiesene_mitarbeiter: editForm.zugewiesene_mitarbeiter.length > 0
        ? editForm.zugewiesene_mitarbeiter
        : [],
      projekt_typ: editForm.projekt_typ || "einzelprojekt",
      parent_project_id: editForm.projekt_typ === "unterprojekt"
        ? (editForm.parent_project_id || null)
        : null,
    } as any).eq("id", projectId);
    // Update or create customer
    if (editForm.customer_id && editForm.kunde_name.trim()) {
      await supabase.from("customers").update({
        name: editForm.kunde_name.trim(),
        anrede: editForm.kunde_anrede || null,
        titel: editForm.kunde_titel.trim() || null,
        adresse: editForm.kunde_adresse.trim() || null,
        plz: editForm.kunde_plz.trim() || null,
        ort: editForm.kunde_ort.trim() || null,
        email: editForm.kunde_email.trim() || null,
        telefon: editForm.kunde_telefon.trim() || null,
        uid_nummer: editForm.kunde_uid.trim() || null,
      }).eq("id", editForm.customer_id);
    } else if (!editForm.customer_id && editForm.kunde_name.trim()) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: newCust } = await supabase.from("customers").insert({
          user_id: user.id,
          name: editForm.kunde_name.trim(),
          anrede: editForm.kunde_anrede || null,
          titel: editForm.kunde_titel.trim() || null,
          adresse: editForm.kunde_adresse.trim() || null,
          plz: editForm.kunde_plz.trim() || null,
          ort: editForm.kunde_ort.trim() || null,
          email: editForm.kunde_email.trim() || null,
          telefon: editForm.kunde_telefon.trim() || null,
          uid_nummer: editForm.kunde_uid.trim() || null,
        }).select("id").single();
        if (newCust) {
          await supabase.from("projects").update({ customer_id: newCust.id }).eq("id", projectId);
        }
      }
    }
    setProjectName(editForm.name.trim());
    setEditSaving(false);
    setEditDialogOpen(false);
    const count = editForm.zugewiesene_mitarbeiter?.length || 0;
    toast({
      title: "Projekt aktualisiert",
      description: count > 0
        ? `${count} Mitarbeiter haben Zugriff — Änderung sofort aktiv in Zeiterfassung + WhatsApp-Bot.`
        : "Keine Mitarbeiter zugewiesen — nur Bauleiter/Verantwortlicher sehen das Projekt.",
    });
  };

  const selectCustomerForEdit = (c: { id: string; name: string; plz: string | null; ort: string | null }) => {
    // Load full customer data
    supabase.from("customers").select("*").eq("id", c.id).single().then(({ data }) => {
      if (data) {
        setEditForm(f => ({
          ...f,
          customer_id: data.id,
          kunde_name: data.name,
          kunde_anrede: (data as any).anrede || "",
          kunde_titel: (data as any).titel || "",
          kunde_adresse: data.adresse || "",
          kunde_plz: data.plz || "",
          kunde_ort: data.ort || "",
          kunde_email: data.email || "",
          kunde_telefon: data.telefon || "",
          kunde_uid: data.uid_nummer || "",
        }));
      }
    });
    setCustomerPopoverOpen(false);
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!projectId || !projectData || updatingStatus || newStatus === projectData.status) return;
    setUpdatingStatus(true);
    const { error } = await supabase
      .from("projects")
      .update({ status: newStatus })
      .eq("id", projectId);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Status konnte nicht gespeichert werden" });
    } else {
      setProjectData((prev: any) => prev ? { ...prev, status: newStatus } : prev);
      toast({ title: "Status aktualisiert", description: `${projectName} → ${newStatus}` });
    }
    setUpdatingStatus(false);
  };

  const fetchProjectName = async () => {
    if (!projectId) return;

    const { data } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();

    if (data) {
      setProjectName(data.name);
      setProjectData(data);

      // Haupt-/Unterprojekt-Verknüpfung laden
      const dProjektTyp = (data as any).projekt_typ;
      const dParent = (data as any).parent_project_id;
      if (dProjektTyp === "hauptprojekt") {
        const { data: kids } = await (supabase.from("projects" as never) as any)
          .select("id, name, status")
          .eq("parent_project_id", projectId)
          .order("name");
        setChildProjects(((kids as { id: string; name: string; status: string | null }[]) || []));
        setParentProjectInfo(null);
      } else if (dParent) {
        const { data: parent } = await (supabase.from("projects" as never) as any)
          .select("id, name")
          .eq("id", dParent)
          .maybeSingle();
        setParentProjectInfo(parent ? { id: parent.id, name: parent.name } : null);
        setChildProjects([]);
      } else {
        setChildProjects([]);
        setParentProjectInfo(null);
      }

      // Kundendaten für Rechnungsadresse-Anzeige
      if ((data as any).customer_id) {
        const { data: cust } = await supabase
          .from("customers")
          .select("*")
          .eq("id", (data as any).customer_id)
          .maybeSingle();
        setCustomerData(cust || null);
      } else {
        setCustomerData(null);
      }
    }

    // Fetch BTB count
    (supabase.from("bautagesberichte" as never) as any)
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .then(({ count }: any) => setBtbCount(count || 0));

    // Fetch Regie count (filtered by project)
    (supabase.from("disturbances" as never) as any)
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .then(({ count }: any) => setRegieCount(count || 0));

    // Fetch Regiebericht PDFs for this project
    (supabase.from("disturbances" as never) as any)
      .select("id, datum, kunde_name, pdf_path")
      .eq("project_id", projectId)
      .not("pdf_path", "is", null)
      .order("datum", { ascending: false })
      .then(({ data: pdfData }: any) => setRegiePdfs(pdfData || []));

    // Fetch Eingangsrechnungen for this project
    supabase.from("purchase_invoices")
      .select("id, lieferant, rechnungsdatum, betrag_brutto, status, kategorie")
      .eq("project_id", projectId)
      .order("rechnungsdatum", { ascending: false, nullsFirst: false })
      .then(({ data }) => setPurchaseInvoices(data || []));

    // Fetch Protokoll count + Liste (Besprechungsprotokolle + Ersttermine)
    // Ersttermine: direkt verknüpfte (project_id=X) + noch unverknüpfte
    // Ersttermine desselben Kunden (damit sie manuell zugeordnet werden können).
    const custIdForProto = (data as any)?.customer_id || null;
    const erstterminFilter = custIdForProto
      ? `project_id.eq.${projectId},and(project_id.is.null,customer_id.eq.${custIdForProto})`
      : `project_id.eq.${projectId}`;
    Promise.all([
      (supabase.from("besprechungsprotokolle" as never) as any)
        .select("id, nummer, datum, typ, ort")
        .eq("project_id", projectId)
        .order("datum", { ascending: false }),
      (supabase.from("ersttermin_interessent" as never) as any)
        .select("id, nummer, datum, projektname, standort, project_id")
        .or(erstterminFilter)
        .order("datum", { ascending: false }),
    ]).then(([protoRes, erstterminRes]) => {
      const protos = ((protoRes as any).data || []).map((p: any) => ({
        id: p.id, nummer: p.nummer, datum: p.datum, typ: p.typ, ort: p.ort, kind: "protokoll" as const, linked: true,
      }));
      const ersts = ((erstterminRes as any).data || []).map((e: any) => ({
        id: e.id, nummer: e.nummer, datum: e.datum, typ: "Ersttermin", ort: e.standort || e.projektname, kind: "ersttermin" as const,
        linked: e.project_id === projectId,
      }));
      const all = [...protos, ...ersts].sort((a, b) => (b.datum || "").localeCompare(a.datum || ""));
      setProjectProtokolle(all);
      setProtokollCount(all.length);
    });
  };

  const [projectInvoices, setProjectInvoices] = useState<{id: string; nummer: string; typ: string; datum: string; brutto_summe: number; kunde_name: string; status: string}[]>([]);

  const fetchInvoiceCount = async () => {
    if (!projectId) return;
    const { data, count } = await supabase
      .from("invoices")
      .select("id, nummer, typ, datum, brutto_summe, kunde_name, status", { count: "exact" })
      .eq("project_id", projectId)
      .order("datum", { ascending: false });
    setInvoiceCount(count || 0);
    if (data) setProjectInvoices(data);
  };

  const fetchFileCounts = async () => {
    if (!projectId) return;

    // Counter laeuft jetzt ueber documents-Tabelle (statt storage.list,
    // das auch Phantom-Ordner zaehlt → User sah "Fotos vorhanden" aber
    // leere Galerie). Dadurch ist der Counter konsistent mit der Galerie
    // (ProjectPhotoGallery.tsx liest ebenfalls aus documents).
    const updatedCategories = await Promise.all(
      categories.map(async (category) => {
        // Skip chef bucket for non-admins
        if (category.type === "chef" && !isAdmin) {
          return { ...category, count: 0 };
        }

        const { count } = await (supabase.from("documents" as never) as any)
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId)
          .eq("typ", category.type);

        return {
          ...category,
          count: count || 0,
        };
      })
    );

    setCategories(updatedCategories);
  };

  const handleQuickPhotoUpload = () => {
    navigate(`/projects/${projectId}/photos`);
  };

  // Filter categories based on admin status
  const visibleCategories = categories.filter(
    (category) => !category.adminOnly || isAdmin
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/projects")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Zurück</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 max-w-4xl">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            {editingName ? (
              <form onSubmit={async (e) => {
                e.preventDefault();
                if (!editNameValue.trim()) return;
                await supabase.from("projects").update({ name: editNameValue.trim() }).eq("id", projectId);
                setProjectName(editNameValue.trim());
                setEditingName(false);
                toast({ title: "Projektname geändert" });
              }} className="flex items-center gap-2 flex-1">
                <Input
                  value={editNameValue}
                  onChange={(e) => setEditNameValue(e.target.value)}
                  className="text-2xl font-bold h-auto py-1"
                  autoFocus
                />
                <Button type="submit" size="icon" variant="ghost" className="shrink-0"><Check className="h-5 w-5 text-green-600" /></Button>
                <Button type="button" size="icon" variant="ghost" className="shrink-0" onClick={() => setEditingName(false)}>✕</Button>
              </form>
            ) : (
              <>
                <h1 className="text-2xl sm:text-3xl font-bold">{projectName}</h1>
                <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={() => { setEditNameValue(projectName); setEditingName(true); }}>
                  <Pencil className="h-4 w-4 text-muted-foreground" />
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={openEditDialog}>
                  <Settings className="h-3.5 w-3.5" />
                  Bearbeiten
                </Button>
                {/* Unterprojekt-Anlegen — nur bei Hauptprojekten sichtbar */}
                {(projectData as any)?.projekt_typ === "hauptprojekt" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 shrink-0"
                    onClick={() => setCreateSubProjectOpen(true)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Unterprojekt
                  </Button>
                )}
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <p className="text-muted-foreground text-sm">Dokumentation und Dateien</p>
            {projectData && projectStatuses.length > 0 && (() => {
              const curStatus = (projectData as any).status || "";
              const sColor = findStatusByName(curStatus);
              return (
                <div className="flex items-center gap-2">
                  <Badge
                    className="border-0"
                    style={
                      sColor
                        ? { backgroundColor: sColor.farbe_bg, color: sColor.farbe_text }
                        : { backgroundColor: "#e5e7eb", color: "#374151" }
                    }
                  >
                    {curStatus || "–"}
                  </Badge>
                  {isAdmin && (
                    <Select
                      value={curStatus}
                      onValueChange={handleStatusChange}
                      disabled={updatingStatus}
                    >
                      <SelectTrigger className="h-8 w-[180px] text-xs">
                        <SelectValue placeholder="Status ändern..." />
                      </SelectTrigger>
                      <SelectContent>
                        {projectStatuses.map((s) => (
                          <SelectItem key={s.id} value={s.name}>
                            <span className="inline-flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.farbe_bg }} />
                              {s.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Quick-Actions: neues Dokument mit vorbelegter project_id */}
        <div className="flex flex-wrap gap-2 mb-4">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate(`/besprechungsprotokolle/neu?project=${projectId}`)}>
            <MessageSquare className="h-3.5 w-3.5" />Neues Protokoll
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate(`/ersttermine/neu?project=${projectId}`)}>
            <UserPlus className="h-3.5 w-3.5" />Neue Erstaufnahme
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate(`/invoices/new?typ=angebot&project=${projectId}`)}>
            <FileText className="h-3.5 w-3.5" />Neues Angebot
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate(`/invoices/new?typ=rechnung&project=${projectId}`)}>
            <FileDown className="h-3.5 w-3.5" />Neue Rechnung
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate(`/disturbances?new=${projectId}`)}>
            <FileText className="h-3.5 w-3.5" />Neuer Regiebericht
          </Button>
        </div>

        {/* Projektinfos */}
        {projectData && (
          <Card className="mb-4">
            <CardContent className="p-4 space-y-2">
              {/* Leistungsort / Durchführungsort (aus projects-Tabelle) */}
              {(projectData.adresse || projectData.plz || (projectData as any).ort) && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Leistungsort:</span>{" "}
                  {[projectData.adresse, [projectData.plz, (projectData as any).ort].filter(Boolean).join(" ")].filter(Boolean).join(", ")}
                </div>
              )}
              {((projectData as any).projekt_kontakt_name || (projectData as any).projekt_kontakt_telefon) && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Kontakt vor Ort:</span>{" "}
                  {(projectData as any).projekt_kontakt_name || ""}
                  {(projectData as any).projekt_kontakt_telefon && (
                    <>
                      {" "}
                      <a className="text-primary underline" href={`tel:${(projectData as any).projekt_kontakt_telefon}`}>
                        {(projectData as any).projekt_kontakt_telefon}
                      </a>
                    </>
                  )}
                </div>
              )}
              {(projectData as any).bereich && (
                <div className="text-sm"><span className="text-muted-foreground">Bereich:</span> {bereichOptions.find(o => o.wert === (projectData as any).bereich)?.label || (projectData as any).bereich}</div>
              )}
              {/* Rechnungsadresse (Kunde) */}
              {customerData && (customerData.adresse || customerData.plz || customerData.ort) && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Rechnungsadresse:</span>{" "}
                  {customerData.name}
                  {customerData.adresse ? `, ${customerData.adresse}` : ""}
                  {customerData.plz || customerData.ort ? `, ${[customerData.plz, customerData.ort].filter(Boolean).join(" ")}` : ""}
                </div>
              )}
              {(projectData as any).geplanter_start && (
                <div className="text-sm"><span className="text-muted-foreground">Start:</span> {format(parseISO((projectData as any).geplanter_start), "dd.MM.yyyy")}</div>
              )}
              {(projectData as any).geplantes_ende && (
                <div className="text-sm"><span className="text-muted-foreground">Ende:</span> {format(parseISO((projectData as any).geplantes_ende), "dd.MM.yyyy")}</div>
              )}
              {(projectData as any).projektart && (
                <div className="text-sm"><span className="text-muted-foreground">Projektart:</span> {(projectData as any).projektart}</div>
              )}
              {(projectData as any).prioritaet && (projectData as any).prioritaet !== "normal" && (
                <div className="text-sm"><span className="text-muted-foreground">Priorität:</span> {(projectData as any).prioritaet}</div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Hauptprojekt-Verweis bei Unterprojekten */}
        {parentProjectInfo && (
          <Card className="mb-4 border-blue-200 bg-blue-50/40">
            <CardContent className="py-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 text-sm">
                  <FolderTree className="h-4 w-4 text-blue-600" />
                  <span className="text-muted-foreground">Dieses Unterprojekt gehört zu:</span>
                  <span className="font-medium">{parentProjectInfo.name}</span>
                </div>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`/projects/${parentProjectInfo.id}`)}>
                  <ExternalLink className="h-3 w-3" />
                  Hauptprojekt öffnen
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Unterprojekte-Liste bei Hauptprojekten */}
        {(projectData as any)?.projekt_typ === "hauptprojekt" && childProjects.length > 0 && (
          <Card className="mb-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <FolderTree className="h-4 w-4" /> Unterprojekte ({childProjects.length})
              </CardTitle>
              <CardDescription>Direkt zugeordnete Teilbereiche dieses Hauptprojekts</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {childProjects.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => navigate(`/projects/${c.id}`)}
                    className="flex items-center justify-between p-2.5 rounded-md border bg-white hover:bg-muted/40 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-blue-600 font-mono text-xs">↳</span>
                      <span className="truncate font-medium">{c.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {c.status && <Badge variant="outline" className="text-[10px]">{c.status}</Badge>}
                      <ExternalLink className="h-3 w-3 text-muted-foreground" />
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Projektstunden (Admin only) */}
        {isAdmin && (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-base">Projektstunden</CardTitle>
            </CardHeader>
            <CardContent>
              {projectHours.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine Stunden gebucht</p>
              ) : (
                <div className="space-y-2">
                  {projectHours.map((h) => (
                    <div key={h.user_id} className="flex justify-between text-sm">
                      <span>{h.name}</span>
                      <span className="font-medium">{h.total.toFixed(1)} Std.</span>
                    </div>
                  ))}
                  <Separator />
                  <div className="flex justify-between font-medium">
                    <span>Gesamt</span>
                    <span>{projectHours.reduce((s, h) => s + h.total, 0).toFixed(1)} Std.</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {visibleCategories.map((category) => (
            <Card 
              key={category.type}
              className="cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => navigate(`/projects/${projectId}/${category.type}`)}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="text-primary">{category.icon}</div>
                  <div className="text-2xl font-bold">{category.count}</div>
                </div>
                <CardTitle className="text-xl">{category.title}</CardTitle>
                <CardDescription>{category.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full">
                  Öffnen
                </Button>
              </CardContent>
            </Card>
          ))}

          {/* Angebotspositionen — ohne Preise, für alle sichtbar */}
          {angebotPositionen.length > 0 && (
            <Card className="col-span-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Angebotspositionen ({angebotPositionen.length})
                </CardTitle>
                <CardDescription>Positionen aus dem Angebot — ohne Preise</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                {angebotPositionen.map(p => (
                  <div key={p.position} className="flex items-center justify-between gap-2 py-1.5 border-b last:border-0 text-sm">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-xs text-muted-foreground font-mono shrink-0">{String(p.position).padStart(2, "0")}</span>
                      <span className="truncate">{p.beschreibung}</span>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{p.menge} {p.einheit}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Regieberichte */}
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/disturbances?project=${projectId}`)}>
            <CardContent className="flex items-center gap-3 p-4">
              <FileText className="h-5 w-5 text-yellow-600" />
              <div className="flex-1">
                <p className="font-medium">Regieberichte</p>
                <p className="text-xs text-muted-foreground">{regieCount} Berichte</p>
              </div>
            </CardContent>
          </Card>

          {/* Regiebericht PDFs */}
          {regiePdfs.length > 0 && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <p className="font-medium text-sm flex items-center gap-2">
                  <Download className="h-4 w-4 text-yellow-600" />
                  Regiebericht-PDFs
                </p>
                <div className="space-y-1">
                  {regiePdfs.map(pdf => (
                    <button
                      key={pdf.id}
                      className="flex items-center gap-2 text-sm w-full text-left hover:bg-muted rounded px-2 py-1.5 transition-colors"
                      onClick={async () => {
                        const { data } = await supabase.storage.from("hws-regiebericht-pdfs").createSignedUrl(pdf.pdf_path, 300);
                        if (data?.signedUrl) window.open(data.signedUrl, "_blank");
                      }}
                    >
                      <FileText className="h-4 w-4 text-red-500 shrink-0" />
                      <span className="truncate">{pdf.kunde_name} - {new Date(pdf.datum).toLocaleDateString("de-AT")}</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Eingangsrechnungen — nur Admin */}
          {isAdmin && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileDown className="h-5 w-5 text-purple-600" />
                    Eingangsrechnungen
                    {purchaseInvoices.length > 0 && (
                      <span className="text-xs text-muted-foreground font-normal">
                        · € {purchaseInvoices.reduce((s, i) => s + Number(i.betrag_brutto), 0).toFixed(2)}
                      </span>
                    )}
                  </CardTitle>
                  <Button variant="outline" size="sm" onClick={() => navigate(`/eingangsrechnungen?project=${projectId}`)}>
                    {purchaseInvoices.length === 0 ? "Hinzufügen" : "Verwalten"}
                  </Button>
                </div>
              </CardHeader>
              {purchaseInvoices.length > 0 && (
                <CardContent className="space-y-1">
                  {purchaseInvoices.slice(0, 5).map(inv => (
                    <button
                      key={inv.id}
                      className="flex items-center gap-3 text-sm w-full text-left hover:bg-muted rounded px-2 py-2 transition-colors"
                      onClick={() => navigate(`/eingangsrechnungen?project=${projectId}`)}
                    >
                      <FileDown className="h-4 w-4 shrink-0 text-purple-500" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{inv.lieferant}</span>
                          {inv.status === "bezahlt" && <span className="text-[10px] text-green-600">✓ bezahlt</span>}
                          {inv.status === "offen" && <span className="text-[10px] text-orange-600">offen</span>}
                        </div>
                        {inv.rechnungsdatum && (
                          <div className="text-xs text-muted-foreground">
                            {new Date(inv.rechnungsdatum).toLocaleDateString("de-AT")}
                          </div>
                        )}
                      </div>
                      <span className="text-sm font-medium whitespace-nowrap">€ {Number(inv.betrag_brutto).toFixed(2)}</span>
                    </button>
                  ))}
                  {purchaseInvoices.length > 5 && (
                    <p className="text-xs text-muted-foreground text-center pt-1">
                      +{purchaseInvoices.length - 5} weitere
                    </p>
                  )}
                </CardContent>
              )}
            </Card>
          )}

          {/* Protokolle — direkte Links zu Besprechungsprotokollen + Ersttermin */}
          {projectProtokolle.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-cyan-600" />
                    Protokolle & Erstaufnahmen
                  </CardTitle>
                  <Button variant="outline" size="sm" onClick={() => navigate(`/besprechungsprotokolle?project=${projectId}`)}>
                    Alle anzeigen
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-1">
                {projectProtokolle.map((p) => (
                  <div
                    key={`${p.kind}-${p.id}`}
                    className="flex items-center gap-3 text-sm w-full hover:bg-muted rounded px-2 py-2 transition-colors"
                  >
                    <button
                      className="flex items-center gap-3 text-left flex-1 min-w-0"
                      onClick={() => navigate(p.kind === "ersttermin" ? `/ersttermine/${p.id}` : `/besprechungsprotokolle/${p.id}`)}
                    >
                      <MessageSquare className={`h-4 w-4 shrink-0 ${p.kind === "ersttermin" ? "text-orange-500" : "text-cyan-600"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{p.nummer || "—"}</span>
                          <span className="text-xs text-muted-foreground">
                            {p.kind === "ersttermin" ? "Erstaufnahme" : (p.typ ? p.typ.charAt(0).toUpperCase() + p.typ.slice(1) : "Protokoll")}
                          </span>
                          {p.kind === "ersttermin" && p.linked === false && (
                            <span className="text-[10px] uppercase tracking-wide text-orange-600 border border-orange-300 rounded px-1 py-0.5">nicht verknüpft</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {p.datum ? new Date(p.datum).toLocaleDateString("de-AT") : "—"}
                          {p.ort ? ` · ${p.ort}` : ""}
                        </div>
                      </div>
                    </button>
                    {p.kind === "ersttermin" && p.linked === false && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async (e) => {
                          e.stopPropagation();
                          const { error } = await (supabase.from("ersttermin_interessent" as never) as any)
                            .update({ project_id: projectId })
                            .eq("id", p.id);
                          if (error) {
                            toast({ variant: "destructive", title: "Fehler", description: error.message });
                          } else {
                            toast({ title: "Ersttermin verknüpft", description: "Dem Projekt zugeordnet." });
                            fetchProjectName();
                          }
                        }}
                      >
                        Verknüpfen
                      </Button>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/besprechungsprotokolle?project=${projectId}`)}>
              <CardContent className="flex items-center gap-3 p-4">
                <MessageSquare className="h-5 w-5 text-cyan-600" />
                <div className="flex-1">
                  <p className="font-medium">Protokolle & Erstaufnahmen</p>
                  <p className="text-xs text-muted-foreground">Keine zugeordnet</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Angebote & Rechnungen — Liste mit PDF-Links */}
          {isAdmin && projectInvoices.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" />
                    Angebote & Rechnungen
                  </CardTitle>
                  <Button variant="outline" size="sm" onClick={() => navigate(`/invoices?project=${projectId}`)}>
                    Alle anzeigen
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-1">
                {projectInvoices.map(inv => {
                  const cfg = getDocConfig(inv.typ);
                  const iconColor = cfg.isAngebotLike ? "text-blue-500"
                    : cfg.typ === "lieferschein" ? "text-orange-500"
                    : cfg.typ === "gutschrift" ? "text-purple-500"
                    : "text-green-600";
                  return (
                    <button
                      key={inv.id}
                      className="flex items-center gap-3 text-sm w-full text-left hover:bg-muted rounded px-2 py-2 transition-colors"
                      onClick={() => navigate(`/invoices/${inv.id}`)}
                    >
                      <FileText className={`h-4 w-4 shrink-0 ${iconColor}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{inv.nummer}</span>
                          <span className="text-xs text-muted-foreground">{cfg.label}</span>
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {inv.kunde_name} · {new Date(inv.datum).toLocaleDateString("de-AT")}
                        </div>
                      </div>
                      <span className="text-sm font-medium whitespace-nowrap">€ {Number(inv.brutto_summe).toFixed(2)}</span>
                    </button>
                  );
                })}
              </CardContent>
            </Card>
          )}
          {isAdmin && projectInvoices.length === 0 && (
            <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/invoices?project=${projectId}`)}>
              <CardContent className="flex items-center gap-3 p-4">
                <FileText className="h-5 w-5 text-primary" />
                <div className="flex-1">
                  <p className="font-medium">Angebote & Rechnungen</p>
                  <p className="text-xs text-muted-foreground">Keine zugeordneten Dokumente</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Floating Action Button für Fotos */}
        {/* Kontakthistorie */}
        {projectId && (
          <div className="mt-6">
            <ContactHistoryTimeline projectId={projectId} />
          </div>
        )}

        <Button
          className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg"
          size="icon"
          onClick={handleQuickPhotoUpload}
        >
          <ImagePlus className="h-6 w-6" />
        </Button>
      </main>

      {/* Projekt bearbeiten Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Projekt bearbeiten</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Projektname *</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label>Beschreibung</Label>
              <Textarea value={editForm.beschreibung} onChange={(e) => setEditForm(f => ({ ...f, beschreibung: e.target.value }))} rows={2} />
            </div>

            {/* Erweiterte Projektfelder */}
            <div className="border-t pt-4 space-y-3">
              <Label className="text-base font-semibold">Projektdetails</Label>
              <div>
                <Label>Bereich / Firma</Label>
                <Select value={editForm.bereich || "none"} onValueChange={(v) => setEditForm(f => ({ ...f, bereich: v === "none" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="Wählen..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">--</SelectItem>
                    {bereichOptions.map(o => (
                      <SelectItem key={o.id} value={o.wert}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Freier Bereichstext (admin-konfigurierbar).</p>
              </div>
              <div>
                <Label>Geschäftsbereich (Google Calendar)</Label>
                <Select
                  value={editForm.kategorie || "none"}
                  onValueChange={(v) => setEditForm(f => ({ ...f, kategorie: v === "none" ? "" : v }))}
                >
                  <SelectTrigger><SelectValue placeholder="Default-Kalender" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— ohne Bereich (Default-Kalender)</SelectItem>
                    <SelectItem value="montipro">Monti.pro</SelectItem>
                    <SelectItem value="bks">BKS-BauKomplettService</SelectItem>
                    <SelectItem value="gartenmacher">Gartenmacher</SelectItem>
                    <SelectItem value="fensterwerk">Fensterwerk</SelectItem>
                    <SelectItem value="ladenbau">Ladenbau</SelectItem>
                    <SelectItem value="portas">Portas</SelectItem>
                    <SelectItem value="chef">CHEF (privater Kalender)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Plantafel-Einsätze landen automatisch im zugehörigen Google Calendar.
                  Ändern ⇒ alle Einsätze werden automatisch umgehängt.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Projektart</Label>
                  <Select value={editForm.projektart || "none"} onValueChange={(v) => setEditForm(f => ({ ...f, projektart: v === "none" ? "" : v }))}>
                    <SelectTrigger><SelectValue placeholder="Wählen..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">--</SelectItem>
                      {projektartOptions.map(o => (
                        <SelectItem key={o.id} value={o.wert}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Priorität</Label>
                  <Select value={editForm.prioritaet || "normal"} onValueChange={(v) => setEditForm(f => ({ ...f, prioritaet: v }))}>
                    <SelectTrigger><SelectValue placeholder="Normal" /></SelectTrigger>
                    <SelectContent>
                      {prioritaetOptions.length > 0 ? prioritaetOptions.map(o => (
                        <SelectItem key={o.id} value={o.wert}>{o.label}</SelectItem>
                      )) : (
                        <>
                          <SelectItem value="niedrig">Niedrig</SelectItem>
                          <SelectItem value="normal">Normal</SelectItem>
                          <SelectItem value="hoch">Hoch</SelectItem>
                          <SelectItem value="dringend">Dringend</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {/* Haupt-/Unterprojekt-Verknüpfung */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Art des Projekts</Label>
                  <Select
                    value={editForm.projekt_typ || "einzelprojekt"}
                    onValueChange={(v) => setEditForm(f => ({
                      ...f,
                      projekt_typ: v,
                      // Bei Wechsel weg von "unterprojekt" parent leeren
                      parent_project_id: v === "unterprojekt" ? f.parent_project_id : null,
                    }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="einzelprojekt">Einzelprojekt</SelectItem>
                      <SelectItem value="hauptprojekt">Hauptprojekt (übergeordnet)</SelectItem>
                      <SelectItem value="unterprojekt">Unterprojekt (zu einem Hauptprojekt)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {editForm.projekt_typ === "unterprojekt" && (
                  <div>
                    <Label>Gehört zu Hauptprojekt</Label>
                    <Select
                      value={editForm.parent_project_id || "none"}
                      onValueChange={(v) => setEditForm(f => ({ ...f, parent_project_id: v === "none" ? null : v }))}
                    >
                      <SelectTrigger><SelectValue placeholder="— wählen —" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— (nicht zugeordnet) —</SelectItem>
                        {availableParentProjects.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Geplanter Start</Label>
                  <Input type="date" value={editForm.geplanter_start} onChange={(e) => setEditForm(f => ({ ...f, geplanter_start: e.target.value }))} />
                </div>
                <div>
                  <Label>Geplantes Ende</Label>
                  <Input type="date" value={editForm.geplantes_ende} onChange={(e) => setEditForm(f => ({ ...f, geplantes_ende: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Budget</Label>
                  <Input type="number" step="0.01" min="0" value={editForm.budget} onChange={(e) => setEditForm(f => ({ ...f, budget: e.target.value }))} placeholder="0.00" />
                </div>
                <div>
                  <Label>Auftragsvolumen</Label>
                  <Input type="number" step="0.01" min="0" value={editForm.auftragsvolumen} onChange={(e) => setEditForm(f => ({ ...f, auftragsvolumen: e.target.value }))} placeholder="0.00" />
                </div>
              </div>
              <div>
                <Label>Bauleiter</Label>
                <Select value={editForm.bauleiter_id || "none"} onValueChange={(v) => setEditForm(f => ({ ...f, bauleiter_id: v === "none" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="Wählen..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">--</SelectItem>
                    {employees.map(e => (
                      <SelectItem key={e.id} value={e.id}>{e.vorname} {e.nachname}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Zugewiesene Mitarbeiter – steuert den Zugriff auf das Projekt */}
              <div>
                <Label className="mb-2 block">Zugewiesene Mitarbeiter</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Nur diese Mitarbeiter sehen das Projekt in der App und können Fotos/Stunden dafür buchen. Administrator und Vorarbeiter sehen alle Projekte.
                </p>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto border rounded-md p-3">
                  {employees.length > 0 ? employees.map((e) => {
                    const checked = editForm.zugewiesene_mitarbeiter.includes(e.id);
                    return (
                      <label key={e.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(ev) => {
                            setEditForm(f => ({
                              ...f,
                              zugewiesene_mitarbeiter: ev.target.checked
                                ? [...f.zugewiesene_mitarbeiter, e.id]
                                : f.zugewiesene_mitarbeiter.filter(x => x !== e.id),
                            }));
                          }}
                          className="rounded"
                        />
                        {e.vorname} {e.nachname}
                      </label>
                    );
                  }) : (
                    <p className="text-sm text-muted-foreground col-span-2">Keine aktiven Mitarbeiter gefunden.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Leistungsort / Durchführungsort */}
            <div className="border-t pt-4">
              <div className="flex items-start justify-between mb-1">
                <Label className="text-base font-semibold block">Leistungsort / Durchführungsort</Label>
                {editForm.customer_id && (editForm.kunde_adresse || editForm.kunde_plz || editForm.kunde_ort) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditForm(f => ({
                      ...f,
                      projekt_adresse: f.kunde_adresse,
                      projekt_plz: f.kunde_plz,
                      projekt_ort: f.kunde_ort,
                      projekt_kontakt_name: f.projekt_kontakt_name || (f.kunde_name || ""),
                      projekt_kontakt_telefon: f.projekt_kontakt_telefon || (f.kunde_telefon || ""),
                    }))}
                  >
                    Kundenadresse übernehmen
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Adresse, wo die Arbeiten tatsächlich durchgeführt werden. Kann von der Kundenadresse abweichen.
              </p>
              <div className="space-y-2">
                <div>
                  <Label className="text-xs">Straße + Hausnr.</Label>
                  <Input
                    value={editForm.projekt_adresse}
                    onChange={(e) => setEditForm(f => ({ ...f, projekt_adresse: e.target.value }))}
                    placeholder="z.B. Hinterleitenweg 19"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-xs">PLZ</Label>
                    <Input
                      value={editForm.projekt_plz}
                      onChange={(e) => setEditForm(f => ({ ...f, projekt_plz: e.target.value }))}
                      placeholder="2733"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Ort</Label>
                    <Input
                      value={editForm.projekt_ort}
                      onChange={(e) => setEditForm(f => ({ ...f, projekt_ort: e.target.value }))}
                      placeholder="z.B. Schrattenbach"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <Label className="text-xs">Kontakt vor Ort</Label>
                    <Input
                      value={editForm.projekt_kontakt_name}
                      onChange={(e) => setEditForm(f => ({ ...f, projekt_kontakt_name: e.target.value }))}
                      placeholder="z.B. Frau Müller"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Telefon</Label>
                    <Input
                      type="tel"
                      value={editForm.projekt_kontakt_telefon}
                      onChange={(e) => setEditForm(f => ({ ...f, projekt_kontakt_telefon: e.target.value }))}
                      placeholder="+43 664 ..."
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Kunde */}
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <Label className="text-base font-semibold">Kunde</Label>
                {editForm.customer_id && <span className="text-xs text-green-600 font-medium">Verknüpft</span>}
              </div>
              <Popover open={customerPopoverOpen} onOpenChange={setCustomerPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start gap-2 mb-3">
                    <Pencil className="w-4 h-4" />
                    {editForm.kunde_name || "Kunde auswählen..."}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[350px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Kunde suchen..." />
                    <CommandList>
                      <CommandEmpty>Kein Kunde gefunden</CommandEmpty>
                      <CommandGroup>
                        {customers.map(c => (
                          <CommandItem key={c.id} value={c.name} onSelect={() => selectCustomerForEdit(c)}>
                            <div>
                              <p className="font-medium text-sm">{c.name}</p>
                              {c.ort && <p className="text-xs text-muted-foreground">{c.plz} {c.ort}</p>}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {editForm.customer_id && (
                <button className="text-xs text-muted-foreground underline mb-3" onClick={() => setEditForm(f => ({ ...f, customer_id: null, kunde_name: "", kunde_anrede: "", kunde_titel: "", kunde_adresse: "", kunde_plz: "", kunde_ort: "", kunde_email: "", kunde_telefon: "", kunde_uid: "" }))}>
                  Verknüpfung lösen
                </button>
              )}
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label>Anrede</Label>
                    <Select value={editForm.kunde_anrede || "none"} onValueChange={(v) => setEditForm(f => ({ ...f, kunde_anrede: v === "none" ? "" : v }))}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        <SelectItem value="Herr">Herr</SelectItem>
                        <SelectItem value="Frau">Frau</SelectItem>
                        <SelectItem value="Firma">Firma</SelectItem>
                        <SelectItem value="Familie">Familie</SelectItem>
                        <SelectItem value="Divers">Divers</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Titel</Label>
                    <Input value={editForm.kunde_titel} onChange={(e) => setEditForm(f => ({ ...f, kunde_titel: e.target.value }))} placeholder="Mag., Dr." />
                  </div>
                  <div>
                    <Label>Firma / Name</Label>
                    <Input value={editForm.kunde_name} onChange={(e) => setEditForm(f => ({ ...f, kunde_name: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <Label>Adresse</Label>
                  <Input value={editForm.kunde_adresse} onChange={(e) => setEditForm(f => ({ ...f, kunde_adresse: e.target.value }))} placeholder="Straße + Hausnr." />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label>PLZ</Label>
                    <Input value={editForm.kunde_plz} onChange={(e) => setEditForm(f => ({ ...f, kunde_plz: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <Label>Ort</Label>
                    <Input value={editForm.kunde_ort} onChange={(e) => setEditForm(f => ({ ...f, kunde_ort: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>E-Mail</Label>
                    <Input value={editForm.kunde_email} onChange={(e) => setEditForm(f => ({ ...f, kunde_email: e.target.value }))} type="email" />
                  </div>
                  <div>
                    <Label>Telefon</Label>
                    <Input value={editForm.kunde_telefon} onChange={(e) => setEditForm(f => ({ ...f, kunde_telefon: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <Label>UID-Nummer</Label>
                  <Input value={editForm.kunde_uid} onChange={(e) => setEditForm(f => ({ ...f, kunde_uid: e.target.value }))} placeholder="ATU..." />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Abbrechen</Button>
            <Button onClick={handleEditSave} disabled={editSaving || !editForm.name.trim()}>
              {editSaving ? "Speichert..." : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unterprojekt-anlegen-Dialog — Pre-set parent_project_id und
          projekt_typ='unterprojekt'. Kundendaten werden vom
          Hauptprojekt übernommen (vererbt). */}
      <CreateProjectDialog
        open={createSubProjectOpen}
        onClose={() => setCreateSubProjectOpen(false)}
        onCreated={(newProj) => {
          setCreateSubProjectOpen(false);
          // Liste sofort aktualisieren
          setChildProjects(prev => [...prev, { id: newProj.id, name: newProj.name, status: null }]);
          toast({ title: "Unterprojekt angelegt", description: newProj.name });
        }}
        defaultProjektTyp="unterprojekt"
        defaultParentProjectId={projectId}
        defaultCustomerId={(projectData as any)?.customer_id || null}
        defaultCustomerName={(customerData as any)?.name || ""}
        defaultAdresse={(customerData as any)?.adresse || ""}
        defaultPlz={(customerData as any)?.plz || ""}
        defaultOrt={(customerData as any)?.ort || ""}
        defaultEmail={(customerData as any)?.email || ""}
        defaultTelefon={(customerData as any)?.telefon || ""}
        defaultAnrede={(customerData as any)?.anrede || ""}
        defaultTitel={(customerData as any)?.titel || ""}
      />
    </div>
  );
};

export default ProjectOverview;

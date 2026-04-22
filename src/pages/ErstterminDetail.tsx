import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Save, Trash2, CheckCircle, PenLine, FolderPlus, Camera, Upload, ZoomIn, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { DictateButton } from "@/components/DictateButton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { PhotoGallery } from "@/components/PhotoGallery";
import { copyErstterminPhotosToProject } from "@/lib/copyErstterminPhotos";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useConfigOptions } from "@/hooks/useConfigOptions";
import { PageHeader } from "@/components/PageHeader";
import { CustomerSelect } from "@/components/CustomerSelect";

interface ErstterminPhoto {
  id: string;
  file_path: string;
  file_name: string;
  beschreibung: string | null;
  created_at: string;
}

export default function ErstterminDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const isNew = id === "neu";
  const navigate = useNavigate();
  const { toast } = useToast();
  const { options: projektartOptions } = useConfigOptions("projektart");
  const { options: entscheidungsOptions } = useConfigOptions("entscheidungsstatus");
  const { options: checklistenItems } = useConfigOptions("ersttermin_checkliste");
  const { options: leistungsartOptions } = useConfigOptions("leistungsart");
  const [employees, setEmployees] = useState<{ id: string; vorname: string; nachname: string }[]>([]);

  // Section 1: Allgemeine Daten
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [selectedCustomerData, setSelectedCustomerData] = useState<any>(null);
  const [ansprechpartner, setAnsprechpartner] = useState("");
  const [projektname, setProjektname] = useState("");
  const [standort, setStandort] = useState("");
  const [standortPlz, setStandortPlz] = useState("");
  const [standortOrt, setStandortOrt] = useState("");
  const [telefon, setTelefon] = useState("");
  const [email, setEmail] = useState("");
  const [datum, setDatum] = useState(new Date().toISOString().slice(0, 10));
  // berater field removed per user request
  const [nummer, setNummer] = useState("");

  // Section 2: Projekt & Bedarf
  const [projektart, setProjektart] = useState("");
  const [gewerk, setGewerk] = useState("");
  const [leistungsumfang, setLeistungsumfang] = useState("");
  const [entscheidungsstatus, setEntscheidungsstatus] = useState("");
  const [zeitrahmen, setZeitrahmen] = useState("");
  const [geplantesEnde, setGeplantesEnde] = useState("");
  const [budget, setBudget] = useState<number | "">("");
  const [quelle, setQuelle] = useState("");
  const [prioritaeten, setPrioritaeten] = useState("");
  const [leistungsarten, setLeistungsarten] = useState<string[]>([]);

  // Section 3: Technische Rahmenbedingungen
  const [zufahrt, setZufahrt] = useState("");
  const [infrastruktur, setInfrastruktur] = useState("");
  const [materialien, setMaterialien] = useState("");
  const [sicherheit, setSicherheit] = useState("");
  const [hindernisse, setHindernisse] = useState("");
  const [entsorgung, setEntsorgung] = useState("");
  const [genehmigungen, setGenehmigungen] = useState("");
  const [offeneFragen, setOffeneFragen] = useState("");

  // Section 4: Angebotsvorbereitung
  const [leistungsbeschreibung, setLeistungsbeschreibung] = useState("");
  const [firmenIntern, setFirmenIntern] = useState("");
  const [firmenExtern, setFirmenExtern] = useState("");
  const [firmenInternOptions, setFirmenInternOptions] = useState<{ value: string; label: string }[]>([]);
  const [firmenExternOptions, setFirmenExternOptions] = useState<{ value: string; label: string }[]>([]);
  const [flaecheAufmass, setFlaecheAufmass] = useState("");
  const [anmerkungen, setAnmerkungen] = useState("");

  // Section 5: Nächste Schritte
  const [angebotErsteller, setAngebotErsteller] = useState("");
  const [angebotBis, setAngebotBis] = useState("");
  const [folgeterminNoetig, setFolgeterminNoetig] = useState(false);
  const [folgeterminDatum, setFolgeterminDatum] = useState("");
  const [fehlendeUnterlagen, setFehlendeUnterlagen] = useState("");
  const [zustaendigkeitenIntern, setZustaendigkeitenIntern] = useState("");
  const [zustaendigkeitenExtern, setZustaendigkeitenExtern] = useState("");

  // Section 6: Ressourcen & Kalkulation
  const [bauleiter, setBauleiter] = useState("");
  const [bauleiterId, setBauleiterId] = useState("");
  const [beteiligte, setBeteiligte] = useState("");
  const [benoetigteMaterialien, setBenoetigteMaterialien] = useState("");
  const [stundenSchaetzung, setStundenSchaetzung] = useState<number | "">("");
  const [materialkosten, setMaterialkosten] = useState<number | "">("");
  const [fremdkosten, setFremdkosten] = useState<number | "">("");
  const [gesamtkosten, setGesamtkosten] = useState<number | "">("");

  // Section 8: Checkliste (config items + custom items)
  const [checkliste, setCheckliste] = useState<Record<string, boolean>>({});
  const [customCheckItems, setCustomCheckItems] = useState<string[]>([]);
  const [newCheckItem, setNewCheckItem] = useState("");

  // Status (Legacy — bleibt in DB, UI zeigt es nicht mehr)
  const [status, setStatus] = useState("abgeschlossen");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [askProjectOpen, setAskProjectOpen] = useState(false);
  const [askProjectName, setAskProjectName] = useState("");
  const [linkableProjects, setLinkableProjects] = useState<{ id: string; name: string; projektnummer: string | null }[]>([]);
  const [selectedLinkProject, setSelectedLinkProject] = useState<string>("");

  // UI state
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);

  // Dirty-Flag setzen sobald User etwas ändert (nach Initial-Load, siehe init())
  const markDirty = () => { if (!loading) setHasUnsavedChanges(true); };
  const [deleting, setDeleting] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(isNew ? null : id || null);
  const [ressourcenOpen, setRessourcenOpen] = useState(false);

  // Photos state (DB photos + local pending photos)
  const [photos, setPhotos] = useState<ErstterminPhoto[]>([]);
  const [pendingPhotos, setPendingPhotos] = useState<{ file: File; preview: string }[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { init(); }, [id]);

  // Auswahllisten für Firma intern / Firma extern laden
  useEffect(() => {
    (async () => {
      const [{ data: internData }, { data: externData }] = await Promise.all([
        (supabase.from("admin_config_options" as never) as any)
          .select("wert, label, sort_order")
          .eq("kategorie", "firma_intern")
          .eq("is_active", true)
          .order("sort_order"),
        (supabase.from("admin_config_options" as never) as any)
          .select("wert, label, sort_order")
          .eq("kategorie", "firma_extern")
          .eq("is_active", true)
          .order("sort_order"),
      ]);
      setFirmenInternOptions(((internData as any[]) || []).map(o => ({ value: o.wert, label: o.label })));
      setFirmenExternOptions(((externData as any[]) || []).map(o => ({ value: o.wert, label: o.label })));
    })();
  }, []);

  const init = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { navigate("/auth"); return; }

    // Aktive Mitarbeiter für Bauleiter-Dropdown laden
    (supabase.from("employees" as never) as any)
      .select("id, vorname, nachname")
      .eq("aktiv", true)
      .order("nachname")
      .then(({ data }: any) => { if (data) setEmployees(data); });

    if (!isNew && id) {
      const { data } = await (supabase.from("ersttermin_interessent" as never) as any)
        .select("*").eq("id", id).single();
      if (data) {
        const d = data as any;
        const s = (v: any) => v || "";
        setCustomerId(d.customer_id || null); setAnsprechpartner(s(d.notizen));
        setProjektname(s(d.projektname)); setStandort(s(d.standort));
        setStandortPlz(s(d.standort_plz)); setStandortOrt(s(d.standort_ort));
        setTelefon(s(d.telefon)); setEmail(s(d.email)); setDatum(s(d.datum));
        setNummer(s(d.nummer));
        setProjektart(s(d.projektart)); setGewerk(s(d.gewerke));
        setLeistungsarten(Array.isArray(d.leistungsarten) ? d.leistungsarten : []);
        setLeistungsumfang(s(d.umfang)); setEntscheidungsstatus(s(d.entscheidungsstatus));
        setZeitrahmen(s(d.zeitrahmen)); setGeplantesEnde(s(d.geplantes_ende));
        setBudget(d.budget ?? "");
        setQuelle(s(d.quelle)); setPrioritaeten(s(d.prioritaeten));
        setZufahrt(s(d.zufahrt_parkplatz)); setInfrastruktur(s(d.infrastruktur));
        setMaterialien(s(d.materialien)); setSicherheit(s(d.sicherheit));
        setHindernisse(s(d.hindernisse)); setEntsorgung(s(d.entsorgung));
        setGenehmigungen(s(d.genehmigungen_relevant)); setOffeneFragen(s(d.offene_technische_fragen));
        setLeistungsbeschreibung(s(d.leistungsbeschreibung)); setFirmenIntern(s(d.firmen_intern));
        setFirmenExtern(s(d.firmen_extern)); setFlaecheAufmass(s(d.aufmasse));
        setAnmerkungen(s(d.anmerkungen)); setAngebotErsteller(s(d.angebot_ersteller));
        setAngebotBis(s(d.angebot_bis)); setFolgeterminNoetig(!!d.folgetermin_noetig);
        setFolgeterminDatum(s(d.folgetermin_datum)); setFehlendeUnterlagen(s(d.fehlende_unterlagen));
        setZustaendigkeitenIntern(s(d.zustaendigkeiten_intern));
        setZustaendigkeitenExtern(s(d.zustaendigkeiten_extern));
        setBauleiter(s(d.bauleiter)); setBauleiterId(s(d.bauleiter_id));
        setBeteiligte(s(d.beteiligte));
        setBenoetigteMaterialien(s(d.benoetigte_materialien));
        setStundenSchaetzung(d.stunden_schaetzung ?? ""); setMaterialkosten(d.materialkosten ?? "");
        setFremdkosten(d.fremdkosten ?? ""); setGesamtkosten(d.gesamtkosten ?? "");
        const loadedChecklist = d.checkliste || {};
        setCheckliste(loadedChecklist);
        // Extract custom check items (keys that are not in config options)
        const configKeys = checklistenItems.map(ci => ci.wert);
        const customs = Object.keys(loadedChecklist).filter(k => !configKeys.includes(k) && k.startsWith("custom_"));
        setCustomCheckItems(customs.map(k => k.replace("custom_", "")));
        setStatus(d.status || "entwurf");
        setProjectId(d.project_id || null);
      }
      fetchPhotos(id);
    } else if (isNew) {
      // Neu-Ersttermin aus Projekt heraus aufgerufen: ?project=<id>
      // → project_id + Kunde + Projekt-Adresse vorausfüllen.
      const preProjectId = searchParams.get("project");
      if (preProjectId) {
        setProjectId(preProjectId);
        const { data: proj } = await (supabase.from("projects" as never) as any)
          .select("id, name, customer_id, adresse, plz, ort, projekt_kontakt_name, projekt_kontakt_telefon")
          .eq("id", preProjectId)
          .maybeSingle();
        if (proj) {
          if (proj.name) setProjektname(proj.name);
          if (proj.adresse) setStandort(proj.adresse);
          if (proj.plz) setStandortPlz(proj.plz);
          if (proj.ort) setStandortOrt(proj.ort);
          if (proj.projekt_kontakt_name) setAnsprechpartner(proj.projekt_kontakt_name);
          if (proj.projekt_kontakt_telefon) setTelefon(proj.projekt_kontakt_telefon);
          if (proj.customer_id) {
            setCustomerId(proj.customer_id);
            // Kundendaten direkt laden, damit die Kundenbox sofort gefüllt ist.
            const { data: cust } = await supabase
              .from("customers")
              .select("id, name, anrede, titel, adresse, plz, ort, email, telefon, uid_nummer")
              .eq("id", proj.customer_id)
              .maybeSingle();
            if (cust) {
              setSelectedCustomerData(cust as any);
              if (cust.email) setEmail(cust.email);
              if (!proj.projekt_kontakt_telefon && cust.telefon) setTelefon(cust.telefon);
            }
          }
        }
      }
    }
    setLoading(false);
    // nach Initial-Load kurz warten, dann Dirty-Tracking aktivieren
    setTimeout(() => setHasUnsavedChanges(false), 300);
  };

  // Lade Projekte des aktuellen Kunden für die "Mit Projekt verknüpfen"-Auswahl.
  useEffect(() => {
    if (!customerId || projectId) {
      setLinkableProjects([]);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, name, projektnummer")
        .eq("customer_id", customerId)
        .order("name");
      setLinkableProjects((data as any) || []);
    })();
  }, [customerId, projectId]);

  const handleLinkToExistingProject = async () => {
    if (!savedId || !selectedLinkProject) return;
    const { error } = await (supabase.from("ersttermin_interessent" as never) as any)
      .update({ project_id: selectedLinkProject })
      .eq("id", savedId);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    setProjectId(selectedLinkProject);
    toast({ title: "Ersttermin verknüpft", description: "Mit dem gewählten Projekt verbunden." });
  };

  // Photos
  const fetchPhotos = async (eid: string) => {
    setPhotosLoading(true);
    const { data } = await (supabase.from("ersttermin_interessent_photos" as never) as any)
      .select("*").eq("ersttermin_interessent_id", eid).order("created_at", { ascending: false });
    if (data) setPhotos(data as ErstterminPhoto[]);
    setPhotosLoading(false);
  };

  const getPhotoUrl = (filePath: string) =>
    supabase.storage.from("ersttermin-photos").getPublicUrl(filePath).data.publicUrl;

  // Upload eines einzelnen Foto-Files (aus <PhotoGallery> — mit optional
  // mitgegebenem Kommentar aus dem Upload-Dialog). Vor dem ersten Save
  // (kein savedId) landen die Fotos lokal als pendingPhotos und werden
  // nach dem Save hochgeladen. Sonst direkt in die DB.
  const uploadSinglePhoto = async (file: File, comment: string | null) => {
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) return;
    if (!savedId) {
      setPendingPhotos(prev => [...prev, { file, preview: URL.createObjectURL(file), comment: comment || "" } as any]);
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const fileName = `${savedId}/${Date.now()}_${file.name}`;
    const { error: upErr } = await supabase.storage.from("ersttermin-photos").upload(fileName, file);
    if (upErr) return;
    const { error: dbErr } = await (supabase.from("ersttermin_interessent_photos" as never) as any)
      .insert({
        ersttermin_interessent_id: savedId,
        user_id: user.id,
        file_path: fileName,
        file_name: file.name,
        beschreibung: comment || null,
      });
    if (dbErr) {
      await supabase.storage.from("ersttermin-photos").remove([fileName]);
      return;
    }
    fetchPhotos(savedId);
  };

  const updatePhotoComment = async (photoId: string, comment: string) => {
    if (photoId.startsWith("pending-")) {
      const idx = parseInt(photoId.slice("pending-".length));
      setPendingPhotos(prev => prev.map((p, i) => i === idx ? ({ ...p, comment } as any) : p));
      return;
    }
    await (supabase.from("ersttermin_interessent_photos" as never) as any)
      .update({ beschreibung: comment })
      .eq("id", photoId);
    setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, beschreibung: comment } : p));
  };

  // Upload pending photos after first save — inkl. Kommentar
  const uploadPendingPhotos = async (eid: string) => {
    if (pendingPhotos.length === 0) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    let failedCount = 0;
    for (const pp of pendingPhotos as any[]) {
      const fileName = `${eid}/${Date.now()}_${pp.file.name}`;
      const { error: upErr } = await supabase.storage.from("ersttermin-photos").upload(fileName, pp.file);
      if (upErr) { failedCount++; continue; }
      const { error: dbErr } = await (supabase.from("ersttermin_interessent_photos" as never) as any)
        .insert({
          ersttermin_interessent_id: eid,
          user_id: user.id,
          file_path: fileName,
          file_name: pp.file.name,
          beschreibung: (pp.comment || "").trim() || null,
        });
      if (dbErr) {
        await supabase.storage.from("ersttermin-photos").remove([fileName]);
        failedCount++;
      }
    }
    if (failedCount > 0) {
      toast({ variant: "destructive", title: "Fotos", description: `${failedCount} Foto(s) konnten nicht gespeichert werden.` });
    }
    setPendingPhotos([]);
    fetchPhotos(eid);
  };

  const handlePhotoDelete = async (p: ErstterminPhoto | { id: string }) => {
    // Pending-Delete: nur aus lokalem State entfernen
    if (p.id.startsWith("pending-")) {
      const idx = parseInt(p.id.slice("pending-".length));
      setPendingPhotos(prev => {
        const pp = prev[idx] as any;
        if (pp?.preview) URL.revokeObjectURL(pp.preview);
        return prev.filter((_, i) => i !== idx);
      });
      return;
    }
    const real = p as ErstterminPhoto;
    const { error: storageErr } = await supabase.storage.from("ersttermin-photos").remove([real.file_path]);
    const { error: dbErr } = await (supabase.from("ersttermin_interessent_photos" as never) as any).delete().eq("id", real.id);
    if (storageErr || dbErr) {
      toast({ variant: "destructive", title: "Foto konnte nicht gelöscht werden", description: (storageErr || dbErr)?.message });
      return;
    }
    setPhotos((prev) => prev.filter((x) => x.id !== real.id));
  };
  // Save
  const handleSave = async () => {
    if (saving) return; // Doppelklick-Schutz
    setSaving(true);
    let docNummer = nummer;
    if (!docNummer) {
      const { data: nextNum } = await supabase.rpc("next_document_number" as never, { p_typ: "ersttermin" } as never);
      if (nextNum) docNummer = String(nextNum);
    }

    const payload: any = {
      customer_id: customerId, notizen: ansprechpartner, projektname, standort, telefon, email, datum,
      standort_plz: standortPlz || null, standort_ort: standortOrt || null,
      nummer: docNummer, projektart: projektart || null, gewerke: gewerk,
      leistungsarten: leistungsarten.length > 0 ? leistungsarten : null,
      umfang: leistungsumfang,
      entscheidungsstatus: entscheidungsstatus || null, zeitrahmen,
      geplantes_ende: geplantesEnde || null,
      budget: budget === "" ? null : budget,
      quelle, prioritaeten, zufahrt_parkplatz: zufahrt, infrastruktur, materialien, sicherheit, hindernisse, entsorgung,
      genehmigungen_relevant: genehmigungen, offene_technische_fragen: offeneFragen, leistungsbeschreibung, firmen_intern: firmenIntern,
      firmen_extern: firmenExtern, aufmasse: flaecheAufmass, anmerkungen,
      angebot_ersteller: angebotErsteller, angebot_bis: angebotBis || null,
      folgetermin_noetig: folgeterminNoetig, folgetermin_datum: folgeterminDatum || null,
      fehlende_unterlagen: fehlendeUnterlagen, zustaendigkeiten_intern: zustaendigkeitenIntern,
      zustaendigkeiten_extern: zustaendigkeitenExtern,
      bauleiter, bauleiter_id: bauleiterId || null,
      beteiligte, benoetigte_materialien: benoetigteMaterialien,
      stunden_schaetzung: stundenSchaetzung === "" ? null : stundenSchaetzung,
      materialkosten: materialkosten === "" ? null : materialkosten,
      fremdkosten: fremdkosten === "" ? null : fremdkosten,
      gesamtkosten: gesamtkosten === "" ? null : gesamtkosten,
      checkliste, status,
      project_id: projectId,
    };

    let eid = savedId;
    if (savedId) {
      const { error } = await (supabase.from("ersttermin_interessent" as never) as any).update(payload).eq("id", savedId);
      if (error) { toast({ variant: "destructive", title: "Fehler", description: "Speichern fehlgeschlagen" }); setSaving(false); return; }
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: inserted, error } = await (supabase.from("ersttermin_interessent" as never) as any)
        .insert({ ...payload, erstellt_von: user?.id }).select("id").single();
      if (error || !inserted) { console.error("Insert error:", error); toast({ variant: "destructive", title: "Fehler", description: error?.message || "Erstellen fehlgeschlagen" }); setSaving(false); return; }
      eid = (inserted as any).id;
      setSavedId(eid);
      setNummer(docNummer);
    }

    // Upload pending photos after first save
    if (eid && pendingPhotos.length > 0) await uploadPendingPhotos(eid);

    setHasUnsavedChanges(false);
    toast({ title: "Gespeichert", description: "Ersttermin wurde gespeichert" });

    // PDF in den Projekt-Protokolle-Ordner erzeugen
    if (eid) {
      void generateErstterminPdfAndUpload(eid);
    }

    // Wenn noch kein Projekt verknüpft und Kunde vorhanden
    // → Dialog zeigen "Projekt jetzt anlegen?" (Name kann im Dialog noch angepasst werden).
    if (eid && !projectId && customerId) {
      // Vorgeschlagenen Projektname füllen: Projektname aus dem Ersttermin, sonst Kundenname
      const suggested = projektname.trim() || (selectedCustomerData?.name ? `Projekt ${selectedCustomerData.name}` : "");
      setAskProjectName(suggested);
      setAskProjectOpen(true);
    }

    if (isNew && eid) navigate(`/ersttermine/${eid}`, { replace: true });
    setSaving(false);
  };

  /** Wird vom "Projekt jetzt anlegen"-Dialog aufgerufen. Nutzt den vom User bestätigten Namen. */
  const confirmCreateProject = async () => {
    if (!savedId) { setAskProjectOpen(false); return; }
    const nameToUse = askProjectName.trim();
    if (!nameToUse) {
      toast({ variant: "destructive", title: "Projektname erforderlich" });
      return;
    }
    const pid = await ensureProjectForErsttermin(savedId, nameToUse);
    setAskProjectOpen(false);
    if (pid) {
      // Name am Ersttermin aktualisieren falls geändert
      if (nameToUse !== projektname) setProjektname(nameToUse);
      // PDF neu erzeugen, jetzt mit Projekt-Verknüpfung
      void generateErstterminPdfAndUpload(savedId);
    }
  };

  /** Legt automatisch ein Projekt für den Ersttermin an (oder verknüpft ein
   *  existierendes, wenn Name + Kunde schon matchen). Liefert project_id. */
  const ensureProjectForErsttermin = async (eid: string, nameOverride?: string): Promise<string | null> => {
    const effektiverName = (nameOverride ?? projektname).trim();
    if (!customerId || !effektiverName) return null;
    try {
      // Duplicate-Check: gleicher Name + gleicher Kunde → vorhandenes verknüpfen
      const { data: existing } = await supabase
        .from("projects")
        .select("id, name")
        .ilike("name", effektiverName)
        .eq("customer_id", customerId)
        .limit(1)
        .maybeSingle();

      let pid: string | null = null;
      if (existing) {
        pid = (existing as any).id;
      } else {
        // Nächste Projekt-Nummer
        const { data: projektNummer } = await supabase.rpc("next_document_number" as never, {
          p_typ: "projekt",
        } as never);

        // Leistungsarten: strukturierter Multi-Select bevorzugt, sonst Gewerk als Fallback
        const leistungsartenArr = leistungsarten.length > 0
          ? leistungsarten
          : (gewerk ? [gewerk] : null);

        // Prioritaet auf Projekt-Enum normalisieren (niedrig/normal/hoch/dringend)
        const prioritaetValid = ["niedrig", "normal", "hoch", "dringend"];
        const projektPrioritaet = prioritaetValid.includes((prioritaeten || "").toLowerCase())
          ? (prioritaeten as string).toLowerCase()
          : "normal";

        // Zusätzliche Info (Zeitrahmen, Quelle, Entscheidungsstatus) als strukturierter Zusatz
        const zusatzInfos = [
          zeitrahmen ? `Zeitrahmen: ${zeitrahmen}` : "",
          quelle ? `Quelle: ${quelle}` : "",
          entscheidungsstatus ? `Entscheidungsstatus: ${entscheidungsstatus}` : "",
        ].filter(Boolean).join("\n");

        // Beschreibung = Leistungsumfang + Leistungsbeschreibung zusammen
        const beschreibungFull = [leistungsumfang, leistungsbeschreibung]
          .filter(Boolean)
          .join("\n\n") || null;

        const { data: newProj, error } = await supabase
          .from("projects")
          .insert({
            name: effektiverName,
            customer_id: customerId,
            status: "Anfrage",
            erfassungsdatum: datum || new Date().toISOString().slice(0, 10),
            projektnummer: projektNummer || null,
            // Leistungsort = Standort aus Ersttermin (NICHT Kunden-Adresse)
            adresse: standort || null,
            plz: standortPlz || null,
            ort: standortOrt || null,
            // Projekt-Inhalt
            projektart: projektart || null,
            leistungsarten: leistungsartenArr as any,
            prioritaet: projektPrioritaet,
            beschreibung: beschreibungFull,
            zusatzinfos: zusatzInfos || null,
            // Zeit & Geld
            geplanter_start: (folgeterminDatum || null) as any,
            geplantes_ende: (geplantesEnde || null) as any,
            budget: budget === "" ? null : Number(budget),
            auftragsvolumen: gesamtkosten === "" ? null : Number(gesamtkosten),
            // Team
            bauleiter_id: bauleiterId || null,
          } as any)
          .select("id")
          .single();

        if (error || !newProj) return null;
        pid = (newProj as any).id;
        toast({ title: "Projekt angelegt", description: `"${effektiverName}" wurde als neues Projekt erstellt und verknüpft.` });
      }

      // Ersttermin mit Projekt verknüpfen
      if (pid) {
        await (supabase.from("ersttermin_interessent" as never) as any)
          .update({ project_id: pid })
          .eq("id", eid);
        setProjectId(pid);

        // Fotos aus dem Ersttermin in den Projekt-Ordner kopieren (best effort)
        try {
          const res = await copyErstterminPhotosToProject(eid, pid);
          if (res.copied > 0) {
            toast({
              title: "Fotos übernommen",
              description: `${res.copied} Foto${res.copied === 1 ? "" : "s"} ins Projekt kopiert${res.skipped ? ` (${res.skipped} bereits vorhanden)` : ""}.`,
            });
          }
        } catch (e) {
          console.error("Foto-Kopie in Projekt fehlgeschlagen:", e);
        }
      }
      return pid;
    } catch {
      return null;
    }
  };

  /** Generiert das Ersttermin-PDF (mit Briefkopf + Fotos) und legt es in
   *  project-reports/{project_id}/protokolle/ ab. Aktualisiert pdf_path. */
  const generateErstterminPdfAndUpload = async (eid: string) => {
    try {
      const [{ generateErstterminPdf }, { loadDocumentLayout }, { loadInvoiceLogo }, { uploadProjectPdf }] =
        await Promise.all([
          import("@/lib/pdfErsttermin"),
          import("@/lib/loadLayout"),
          import("@/lib/logoLoader"),
          import("@/lib/pdfUploader"),
        ]);

      // Kunde-Name aus Selected-Customer-Data oder Nachladen
      let kundeName: string | null = selectedCustomerData?.name || null;
      if (!kundeName && customerId) {
        const { data: cust } = await supabase
          .from("customers")
          .select("name")
          .eq("id", customerId)
          .maybeSingle();
        kundeName = (cust as any)?.name ?? null;
      }

      // Fotos laden
      const { data: photoRows } = await (supabase.from("ersttermin_interessent_photos" as never) as any)
        .select("file_path, file_name, beschreibung")
        .eq("ersttermin_interessent_id", eid)
        .order("created_at", { ascending: true });

      const [{ layout, firmenUid }, logoDataUri] = await Promise.all([
        loadDocumentLayout(),
        loadInvoiceLogo(),
      ]);

      const blob = await generateErstterminPdf(
        {
          nummer,
          datum,
          projektname,
          kunde_name: kundeName,
          ansprechpartner,
          telefon,
          email,
          standort,
          projektart,
          gewerk,
          leistungsumfang,
          entscheidungsstatus,
          zeitrahmen,
          budget: budget === "" ? null : Number(budget),
          quelle,
          prioritaeten,
          zufahrt,
          infrastruktur,
          materialien,
          sicherheit,
          hindernisse,
          entsorgung,
          genehmigungen,
          offene_fragen: offeneFragen,
          leistungsbeschreibung,
          flaeche_aufmass: flaecheAufmass,
          anmerkungen,
          angebot_ersteller: angebotErsteller,
          angebot_bis: angebotBis || null,
          folgetermin_datum: folgeterminDatum || null,
          fehlende_unterlagen: fehlendeUnterlagen,
          bauleiter,
        },
        (photoRows || []).map((r: any) => ({
          bucket: "ersttermin-photos",
          file_path: r.file_path,
          file_name: r.file_name,
          beschreibung: r.beschreibung,
        })),
        layout,
        logoDataUri,
        firmenUid,
      );

      const basename = `Ersttermin-${nummer || eid.slice(0, 8)}-${datum}`;
      const { path } = await uploadProjectPdf({
        projectId,
        category: "protokolle",
        basename,
        blob,
      });

      await (supabase.from("ersttermin_interessent" as never) as any)
        .update({ pdf_path: path })
        .eq("id", eid);
    } catch (err: any) {
      // Vite/Rollup Chunk-Hash-Mismatch nach Deploy → reload statt Error-Toast
      if (err?.message?.includes("Failed to fetch dynamically imported module")) {
        window.location.reload();
        return;
      }
      toast({
        variant: "destructive",
        title: "PDF konnte nicht erstellt werden",
        description: err?.message || String(err),
      });
    }
  };

  const handleDelete = async () => {
    if (!savedId) return;
    setDeleting(true);
    const { error } = await (supabase.from("ersttermin_interessent" as never) as any).delete().eq("id", savedId);
    if (error) { toast({ variant: "destructive", title: "Fehler", description: "Löschen fehlgeschlagen" }); }
    else { toast({ title: "Gelöscht" }); navigate("/ersttermine"); }
    setDeleting(false);
  };


  const numInput = (val: number | "", set: (v: number | "") => void) => (
    <Input type="number" value={val} onChange={(e) => set(e.target.value === "" ? "" : Number(e.target.value))} />
  );
  const field = (label: string, val: string, set: (v: string) => void, rows = 0, ph = "") => (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {rows > 0 && <DictateButton value={val} onResult={set} />}
      </div>
      {rows > 0 ? <Textarea rows={rows} value={val} onChange={(e) => set(e.target.value)} placeholder={ph} />
        : <Input value={val} onChange={(e) => set(e.target.value)} placeholder={ph} />}
    </div>
  );

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title={isNew ? "Neuer Ersttermin" : `Ersttermin ${nummer || ""}`} backPath="/ersttermine" />

      <main className="container mx-auto px-4 py-6 max-w-4xl space-y-6">
        {/* Actions */}
        <div className="flex flex-wrap gap-2 justify-end items-center">
          <div className="flex gap-2">
            {savedId && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={deleting}><Trash2 className="h-4 w-4 mr-1" />Löschen</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader><AlertDialogTitle>Ersttermin löschen?</AlertDialogTitle>
                    <AlertDialogDescription>Dieser Ersttermin wird unwiderruflich gelöscht.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>Abbrechen</AlertDialogCancel><AlertDialogAction onClick={handleDelete}>Löschen</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              <Save className="h-4 w-4" />{saving ? "Speichert..." : "Speichern"}
            </Button>
          </div>
        </div>

        {/* Projekt-Verknüpfung (wenn gespeichert und noch kein Projekt) */}
        {savedId && !projectId && customerId && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="py-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <FolderPlus className="h-5 w-5 text-primary mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Kein Projekt verknüpft</p>
                    <p className="text-xs text-muted-foreground">Mit bestehendem Projekt verbinden oder neu erstellen.</p>
                  </div>
                </div>
                <Button size="sm" onClick={() => {
                  const suggested = projektname.trim() || (selectedCustomerData?.name ? `Projekt ${selectedCustomerData.name}` : "");
                  setAskProjectName(suggested);
                  setAskProjectOpen(true);
                }}>
                  <FolderPlus className="h-4 w-4 mr-1" />Neues Projekt erstellen
                </Button>
              </div>
              {linkableProjects.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
                  <span className="text-xs text-muted-foreground">Mit bestehendem Projekt verknüpfen:</span>
                  <Select value={selectedLinkProject} onValueChange={setSelectedLinkProject}>
                    <SelectTrigger className="w-[260px] h-9">
                      <SelectValue placeholder="Projekt wählen..." />
                    </SelectTrigger>
                    <SelectContent>
                      {linkableProjects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.projektnummer ? `${p.projektnummer} · ` : ""}{p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!selectedLinkProject}
                    onClick={handleLinkToExistingProject}
                  >
                    Verknüpfen
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 1. Allgemeine Daten */}
        <Card>
          <CardHeader><CardTitle>Allgemeine Daten</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1"><Label>Kunde</Label>
              <CustomerSelect value={customerId} onChange={(cid, customer) => {
                setCustomerId(cid);
                if (customer) setSelectedCustomerData(customer);
              }} />
            </div>
            {/* Kundendaten übernehmen */}
            {selectedCustomerData && (
              <div className="rounded-lg border p-3 bg-muted/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{selectedCustomerData.name}</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => {
                    const c = selectedCustomerData;
                    if (c.adresse) setStandort(c.adresse);
                    if (c.plz) setStandortPlz(c.plz);
                    if (c.ort) setStandortOrt(c.ort);
                    if (c.telefon) setTelefon(c.telefon);
                    if (c.email) setEmail(c.email);
                    toast({ title: "Kundendaten übernommen" });
                  }}>Daten übernehmen</Button>
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {selectedCustomerData.adresse && <div>{selectedCustomerData.adresse}, {selectedCustomerData.plz} {selectedCustomerData.ort}</div>}
                  <div className="flex gap-3">
                    {selectedCustomerData.telefon && <span>{selectedCustomerData.telefon}</span>}
                    {selectedCustomerData.email && <span>{selectedCustomerData.email}</span>}
                  </div>
                </div>
              </div>
            )}
            {field("Ansprechpartner vor Ort", ansprechpartner, setAnsprechpartner, 0, "Name des Ansprechpartners")}
            {field("Projektname", projektname, setProjektname, 0, "Projektbezeichnung")}
            <AddressAutocomplete
              label="Standort / Baustellenadresse"
              value={standort}
              onChange={setStandort}
              onSelect={(addr) => {
                setStandort(addr.street || addr.displayName);
                if (addr.plz) setStandortPlz(addr.plz);
                if (addr.ort) setStandortOrt(addr.ort);
              }}
              placeholder="Straße + Hausnr. der Baustelle"
            />
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label>PLZ</Label>
                <Input value={standortPlz} onChange={(e) => setStandortPlz(e.target.value)} placeholder="2733" />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Ort</Label>
                <Input value={standortOrt} onChange={(e) => setStandortOrt(e.target.value)} placeholder="z.B. Schrattenbach" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {field("Telefon", telefon, setTelefon, 0, "Telefonnummer")}
              <div className="space-y-1"><Label>E-Mail</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-Mail-Adresse" /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1"><Label>Datum</Label><Input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} /></div>
              <div className="space-y-1"><Label>Nummer</Label><Input value={nummer} readOnly placeholder="Wird automatisch vergeben" className="bg-muted" /></div>
            </div>
          </CardContent>
        </Card>

        {/* 2. Projekt & Bedarf */}
        <Card>
          <CardHeader><CardTitle>Projekt & Bedarf</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1"><Label>Projektart</Label>
              <Select value={projektart} onValueChange={setProjektart}>
                <SelectTrigger><SelectValue placeholder="Projektart wählen" /></SelectTrigger>
                <SelectContent>{projektartOptions.map((o) => <SelectItem key={o.id} value={o.wert}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {field("Gewerk (betroffene Bereiche)", gewerk, setGewerk, 0, "z.B. Fassade, Innenausbau...")}

            {/* Leistungsarten — Multi-Select (fürs Projekt) */}
            {leistungsartOptions.length > 0 && (
              <div className="space-y-1">
                <Label>Art der Leistung</Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 border rounded-md p-3">
                  {leistungsartOptions.map((l) => (
                    <label key={l.wert} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={leistungsarten.includes(l.wert)}
                        onChange={() => setLeistungsarten((prev) =>
                          prev.includes(l.wert) ? prev.filter((x) => x !== l.wert) : [...prev, l.wert]
                        )}
                        className="rounded border-input"
                      />
                      {l.label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {field("Leistungsumfang", leistungsumfang, setLeistungsumfang, 3, "Beschreibung des Leistungsumfangs")}
            <div className="space-y-1"><Label>Entscheidungsstatus</Label>
              <Select value={entscheidungsstatus} onValueChange={setEntscheidungsstatus}>
                <SelectTrigger><SelectValue placeholder="Status wählen" /></SelectTrigger>
                <SelectContent>{entscheidungsOptions.map((o) => <SelectItem key={o.id} value={o.wert}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {field("Zeitrahmen (Freitext)", zeitrahmen, setZeitrahmen, 0, "z.B. Q2 2026")}
              <div className="space-y-1">
                <Label>Geplantes Ende</Label>
                <Input type="date" value={geplantesEnde} onChange={(e) => setGeplantesEnde(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1"><Label>Budget</Label>{numInput(budget, setBudget)}</div>
              <div className="space-y-1">
                <Label>Priorität</Label>
                <Select value={prioritaeten || "normal"} onValueChange={setPrioritaeten}>
                  <SelectTrigger><SelectValue placeholder="Priorität wählen" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="niedrig">Niedrig</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="hoch">Hoch</SelectItem>
                    <SelectItem value="dringend">Dringend</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {field("Quelle / Empfehlung", quelle, setQuelle, 0, "Wie kam der Kontakt zustande?")}
          </CardContent>
        </Card>

        {/* 3. Technische Rahmenbedingungen */}
        <Card>
          <CardHeader><CardTitle>Technische Rahmenbedingungen</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {field("Zufahrt / Parking", zufahrt, setZufahrt, 2)}
            {field("Strom / Wasser / Infrastruktur", infrastruktur, setInfrastruktur, 2)}
            {field("Bestandsmaterial / Untergrund", materialien, setMaterialien, 2)}
            {field("Sicherheitsanforderungen", sicherheit, setSicherheit, 2)}
            {field("Hindernisse / Schutzmaßnahmen", hindernisse, setHindernisse, 2)}
            {field("Entsorgung / Demontage", entsorgung, setEntsorgung, 2)}
            {field("Genehmigungen relevant", genehmigungen, setGenehmigungen, 2)}
            {field("Offene technische Fragen", offeneFragen, setOffeneFragen, 2)}
          </CardContent>
        </Card>

        {/* 4. Angebotsvorbereitung */}
        <Card>
          <CardHeader><CardTitle>Angebotsvorbereitung</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {field("Kurzbeschreibung / Kundenwunsch", leistungsbeschreibung, setLeistungsbeschreibung, 3)}
            {/* Firmen intern — Mehrfachauswahl aus admin_config_options + Freitext */}
            <div className="space-y-1">
              <Label>Firmen intern</Label>
              {firmenInternOptions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {firmenInternOptions.map((opt) => {
                    const active = firmenIntern.split(/,\s*/).filter(Boolean).includes(opt.label);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          const parts = firmenIntern.split(/,\s*/).filter(Boolean);
                          const next = active
                            ? parts.filter(p => p !== opt.label)
                            : [...parts, opt.label];
                          setFirmenIntern(next.join(", "));
                        }}
                        className={`text-xs rounded-full px-3 py-1 border transition-colors ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background hover:bg-muted border-input"
                        }`}
                      >
                        {active ? "✓ " : "+ "}{opt.label}
                      </button>
                    );
                  })}
                </div>
              )}
              <Textarea
                value={firmenIntern}
                onChange={(e) => setFirmenIntern(e.target.value)}
                rows={2}
                placeholder="Mehrere Firmen mit Komma trennen — oder oben auswählen"
              />
            </div>

            <div className="space-y-1">
              <Label>Firmen extern</Label>
              {firmenExternOptions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {firmenExternOptions.map((opt) => {
                    const active = firmenExtern.split(/,\s*/).filter(Boolean).includes(opt.label);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          const parts = firmenExtern.split(/,\s*/).filter(Boolean);
                          const next = active
                            ? parts.filter(p => p !== opt.label)
                            : [...parts, opt.label];
                          setFirmenExtern(next.join(", "));
                        }}
                        className={`text-xs rounded-full px-3 py-1 border transition-colors ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background hover:bg-muted border-input"
                        }`}
                      >
                        {active ? "✓ " : "+ "}{opt.label}
                      </button>
                    );
                  })}
                </div>
              )}
              <Textarea
                value={firmenExtern}
                onChange={(e) => setFirmenExtern(e.target.value)}
                rows={2}
                placeholder="Mehrere Firmen mit Komma trennen — oder oben auswählen"
              />
            </div>
            {field("Fläche / Aufmaß", flaecheAufmass, setFlaecheAufmass, 2)}
            {field("Bemerkung / Anmerkungen", anmerkungen, setAnmerkungen, 3)}
          </CardContent>
        </Card>

        {/* 5. Nächste Schritte */}
        <Card>
          <CardHeader><CardTitle>Nächste Schritte</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {field("Wer erstellt Angebot?", angebotErsteller, setAngebotErsteller)}
            <div className="space-y-1"><Label>Angebot bis wann?</Label>
              <Input type="date" value={angebotBis} onChange={(e) => setAngebotBis(e.target.value)} />
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Switch checked={folgeterminNoetig} onCheckedChange={setFolgeterminNoetig} />
                <Label>Folgetermin erforderlich?</Label>
              </div>
              {folgeterminNoetig && (
                <div className="space-y-1"><Label>Folgetermin Datum</Label>
                  <Input type="date" value={folgeterminDatum} onChange={(e) => setFolgeterminDatum(e.target.value)} />
                </div>
              )}
            </div>
            {field("Fehlende Unterlagen", fehlendeUnterlagen, setFehlendeUnterlagen, 2)}
            {field("Zuständigkeiten intern", zustaendigkeitenIntern, setZustaendigkeitenIntern, 2)}
            {field("Zuständigkeiten extern", zustaendigkeitenExtern, setZustaendigkeitenExtern, 2)}
          </CardContent>
        </Card>

        {/* 6. Ressourcen & Kalkulation (Collapsible) */}
        <Card>
          <Collapsible open={ressourcenOpen} onOpenChange={setRessourcenOpen}>
            <CardHeader>
              <CollapsibleTrigger asChild>
                <button className="flex items-center justify-between w-full text-left">
                  <CardTitle>Ressourcen & Kalkulation</CardTitle>
                  <ChevronDown className={`h-5 w-5 transition-transform ${ressourcenOpen ? "rotate-180" : ""}`} />
                </button>
              </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <Label>Bauleiter</Label>
                  <Select
                    value={bauleiterId || "none"}
                    onValueChange={(v) => {
                      const id = v === "none" ? "" : v;
                      setBauleiterId(id);
                      // Auch den Text-Namen synchronisieren (für Display)
                      if (id) {
                        const emp = employees.find((e) => e.id === id);
                        if (emp) setBauleiter(`${emp.vorname} ${emp.nachname}`.trim());
                      } else {
                        setBauleiter("");
                      }
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Bauleiter wählen..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {employees.map((e) => (
                        <SelectItem key={e.id} value={e.id}>{e.vorname} {e.nachname}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {field("Beteiligte", beteiligte, setBeteiligte, 2)}
                {field("Benötigte Materialien", benoetigteMaterialien, setBenoetigteMaterialien, 2)}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="space-y-1"><Label>Stunden-Schätzung</Label>{numInput(stundenSchaetzung, setStundenSchaetzung)}</div>
                  <div className="space-y-1"><Label>Materialkosten</Label>{numInput(materialkosten, setMaterialkosten)}</div>
                  <div className="space-y-1"><Label>Fremdkosten</Label>{numInput(fremdkosten, setFremdkosten)}</div>
                  <div className="space-y-1"><Label>Gesamtkosten</Label>{numInput(gesamtkosten, setGesamtkosten)}</div>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>

        {/* 7. Fotos — shared PhotoGallery-Komponente (Grid, Drag&Drop,
             Lightbox, Kommentar pro Foto, Upload-Dialog mit Kommentar).
             Pending-Fotos (vor erstem Speichern) werden synthetisch als
             "pending-N"-IDs eingeblendet — nach dem Save wandern sie in
             die DB und kriegen echte IDs. */}
        <PhotoGallery
          title="Fotos"
          loading={photosLoading}
          photos={[
            ...(pendingPhotos as any[]).map((pp, idx) => ({
              id: `pending-${idx}`,
              url: pp.preview,
              fileName: pp.file.name,
              beschreibung: pp.comment || null,
            })),
            ...photos.map(p => ({
              id: p.id,
              url: getPhotoUrl(p.file_path),
              fileName: p.file_name || undefined,
              beschreibung: p.beschreibung ?? null,
              createdAt: p.created_at,
            })),
          ]}
          onUpload={uploadSinglePhoto}
          onUpdateComment={updatePhotoComment}
          onDelete={(photo) => handlePhotoDelete({ id: photo.id, file_path: (photos.find(p => p.id === photo.id) as any)?.file_path } as any)}
          headerExtra={projectId && photos.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (!id || !projectId) return;
                const res = await copyErstterminPhotosToProject(id, projectId);
                toast({
                  title: "Fotos-Übernahme abgeschlossen",
                  description: `${res.copied} kopiert · ${res.skipped} übersprungen${res.failed ? ` · ${res.failed} fehlgeschlagen` : ""}`,
                });
              }}
              className="gap-2"
            >
              <FolderPlus className="h-4 w-4" /> Ins Projekt übernehmen
            </Button>
          ) : undefined}
        />

        {/* 8. Checkliste */}
        <Card>
          <CardHeader><CardTitle>Checkliste</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {/* Config-basierte Punkte */}
            <div className="space-y-3">
              {checklistenItems.map((item) => (
                <div key={item.id} className="flex items-center gap-3">
                  <Checkbox
                    id={`cl-${item.wert}`}
                    checked={!!checkliste[item.wert]}
                    onCheckedChange={(checked) => setCheckliste((prev) => ({ ...prev, [item.wert]: !!checked }))}
                  />
                  <Label htmlFor={`cl-${item.wert}`} className="cursor-pointer">{item.label}</Label>
                </div>
              ))}
            </div>

            {/* Eigene Punkte */}
            {customCheckItems.length > 0 && (
              <div className="space-y-3 border-t pt-3">
                <p className="text-xs text-muted-foreground font-medium">Eigene Punkte</p>
                {customCheckItems.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <Checkbox
                      id={`custom-${idx}`}
                      checked={!!checkliste[`custom_${item}`]}
                      onCheckedChange={(checked) => setCheckliste((prev) => ({ ...prev, [`custom_${item}`]: !!checked }))}
                    />
                    <Label htmlFor={`custom-${idx}`} className="cursor-pointer flex-1">{item}</Label>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => {
                      setCustomCheckItems(prev => prev.filter((_, i) => i !== idx));
                      setCheckliste(prev => { const n = { ...prev }; delete n[`custom_${item}`]; return n; });
                    }}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                ))}
              </div>
            )}

            {/* Neuen Punkt hinzufügen */}
            <div className="flex gap-2 border-t pt-3">
              <Input
                placeholder="Eigenen Checkpunkt hinzufügen..."
                value={newCheckItem}
                onChange={(e) => setNewCheckItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newCheckItem.trim()) {
                    setCustomCheckItems(prev => [...prev, newCheckItem.trim()]);
                    setCheckliste(prev => ({ ...prev, [`custom_${newCheckItem.trim()}`]: false }));
                    setNewCheckItem("");
                  }
                }}
                className="flex-1"
              />
              <Button variant="outline" size="sm" disabled={!newCheckItem.trim()} onClick={() => {
                if (newCheckItem.trim()) {
                  setCustomCheckItems(prev => [...prev, newCheckItem.trim()]);
                  setCheckliste(prev => ({ ...prev, [`custom_${newCheckItem.trim()}`]: false }));
                  setNewCheckItem("");
                }
              }}>Hinzufügen</Button>
            </div>
          </CardContent>
        </Card>

        {/* Bottom save */}
        <div className="flex justify-end gap-2">
          <Button onClick={handleSave} disabled={saving} className="gap-2"><Save className="h-4 w-4" />{saving ? "Speichert..." : "Speichern"}</Button>
        </div>

        {/* Lightbox wird jetzt von <PhotoGallery> verwaltet */}

        {/* "Projekt jetzt anlegen?" — Bestätigungsdialog nach Speichern */}
        <AlertDialog open={askProjectOpen} onOpenChange={setAskProjectOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Projekt aus Ersttermin erstellen?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div>
                  Aus diesem Ersttermin wird ein Projekt mit allen erfassten
                  Daten (Kunde, Standort, Leistungsarten, Budget usw.) angelegt.
                  <div className="mt-3 text-sm">
                    Kunde: <strong>{selectedCustomerData?.name || "—"}</strong>
                  </div>
                  <div className="mt-3 space-y-1">
                    <Label className="text-sm">Projektname *</Label>
                    <Input
                      value={askProjectName}
                      onChange={(e) => setAskProjectName(e.target.value)}
                      placeholder="Projektname"
                      autoFocus
                    />
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Später</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); confirmCreateProject(); }}
                disabled={!askProjectName.trim()}
              >
                Ja, Projekt erstellen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
  );
}

import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, UserPlus, Building, Upload, Trash2, CheckCircle, FileText, Image, Map } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useConfigOptions } from "@/hooks/useConfigOptions";

interface CustomerOption {
  id: string;
  name: string;
  ansprechpartner: string | null;
  uid_nummer: string | null;
  adresse: string | null;
  plz: string | null;
  ort: string | null;
  land: string | null;
  email: string | null;
  telefon: string | null;
}

interface CreateProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (project: { id: string; name: string }) => void;
  defaultName?: string;
  defaultCustomerId?: string | null;
  defaultCustomerName?: string;
  defaultAdresse?: string;
  defaultPlz?: string;
  defaultOrt?: string;
  defaultEmail?: string;
  defaultTelefon?: string;
  defaultUidNummer?: string;
  defaultAnrede?: string;
  defaultTitel?: string;
}

interface UploadedFile {
  name: string;
  bucket: string;
  path: string;
}

export function CreateProjectDialog({
  open,
  onClose,
  onCreated,
  defaultName = "",
  defaultCustomerId = null,
  defaultCustomerName = "",
  defaultAdresse = "",
  defaultPlz = "",
  defaultOrt = "",
  defaultEmail = "",
  defaultTelefon = "",
  defaultUidNummer = "",
  defaultAnrede = "",
  defaultTitel = "",
}: CreateProjectDialogProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerPopoverOpen, setCustomerPopoverOpen] = useState(false);
  const [customerTab, setCustomerTab] = useState<"existing" | "new">("existing");

  // Config options
  const { options: projektartOptions } = useConfigOptions("projektart");
  const { options: prioritaetOptions } = useConfigOptions("prioritaet");
  const { options: projektTypOptions } = useConfigOptions("projekt_typ");
  const { options: leistungsartOptions } = useConfigOptions("leistungsart");
  const { options: bereichOptions } = useConfigOptions("projekt_bereich");

  // Employees & statuses
  const [employees, setEmployees] = useState<{ id: string; vorname: string; nachname: string }[]>([]);
  const [projectStatuses, setProjectStatuses] = useState<{ id: string; name: string; is_default: boolean }[]>([]);

  // --- Section 1: Projektdaten ---
  const [projectName, setProjectName] = useState(defaultName);
  const [status, setStatus] = useState("");
  const [erfassungsDatum, setErfassungsDatum] = useState(new Date().toISOString().split("T")[0]);
  const [beschreibung, setBeschreibung] = useState("");

  // --- Section 2: Kunde ---
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(defaultCustomerId);
  const [customerName, setCustomerName] = useState(defaultCustomerName);
  const [adresse, setAdresse] = useState(defaultAdresse);
  const [plz, setPlz] = useState(defaultPlz);
  const [ort, setOrt] = useState(defaultOrt);
  const [land, setLand] = useState("Österreich");
  const [email, setEmail] = useState("");
  const [telefon, setTelefon] = useState("");
  const [uidNummer, setUidNummer] = useState("");
  const [anrede, setAnrede] = useState("");
  const [titel, setTitel] = useState("");

  // --- Section 3: Projektadresse / Leistungsort ---
  const [projektAdresse, setProjektAdresse] = useState("");
  const [projektPlz, setProjektPlz] = useState("");
  const [projektOrt, setProjektOrt] = useState("");
  const [projektLand, setProjektLand] = useState("Österreich");
  const [projektKontaktName, setProjektKontaktName] = useState("");
  const [projektKontaktTelefon, setProjektKontaktTelefon] = useState("");
  const [zusatzinfos, setZusatzinfos] = useState("");
  const [wegbeschreibung, setWegbeschreibung] = useState("");

  // --- Section 1b: Bereich/Mandant ---
  const [bereich, setBereich] = useState("");

  // --- Section 4: Projektinhalt ---
  const [projektTyp, setProjektTyp] = useState("");
  const [projektart, setProjektart] = useState("");
  const [prioritaet, setPrioritaet] = useState("normal");
  const [leistungsarten, setLeistungsarten] = useState<string[]>([]);
  const [geplanterStart, setGeplanterStart] = useState("");
  const [geplantesEnde, setGeplantesEnde] = useState("");
  const [budget, setBudget] = useState("");
  const [auftragsvolumen, setAuftragsvolumen] = useState("");

  // --- Section 5: Team ---
  const [projektverantwortlicherId, setProjektverantwortlicherId] = useState("");
  const [bauleiterId, setBauleiterId] = useState("");
  const [zugewieseneMitarbeiter, setZugewieseneMitarbeiter] = useState<string[]>([]);

  // --- Section 6: Fotos & Dokumente (post-save) ---
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [createdProjectName, setCreatedProjectName] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const planInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  // Load data on open
  useEffect(() => {
    if (open) {
      // Reset form
      setProjectName(defaultName);
      setStatus("");
      setErfassungsDatum(new Date().toISOString().split("T")[0]);
      setBeschreibung("");
      setSelectedCustomerId(defaultCustomerId);
      setCustomerName(defaultCustomerName);
      setAdresse(defaultAdresse);
      setPlz(defaultPlz);
      setOrt(defaultOrt);
      setLand("Österreich");
      setEmail(defaultEmail);
      setTelefon(defaultTelefon);
      setUidNummer(defaultUidNummer);
      setAnrede(defaultAnrede);
      setTitel(defaultTitel);
      setProjektAdresse("");
      setProjektPlz("");
      setProjektOrt("");
      setProjektLand("Österreich");
      setProjektKontaktName("");
      setProjektKontaktTelefon("");
      setZusatzinfos("");
      setWegbeschreibung("");
      setBereich("");
      setProjektTyp("");
      setProjektart("");
      setPrioritaet("normal");
      setLeistungsarten([]);
      setGeplanterStart("");
      setGeplantesEnde("");
      setBudget("");
      setAuftragsvolumen("");
      setProjektverantwortlicherId("");
      setBauleiterId("");
      setZugewieseneMitarbeiter([]);
      setCreatedProjectId(null);
      setCreatedProjectName("");
      setUploadedFiles([]);
      setUploading(null);
      setCustomerTab(defaultCustomerId ? "existing" : "existing");

      // Load customers
      supabase
        .from("customers")
        .select("id, name, ansprechpartner, uid_nummer, adresse, plz, ort, land, email, telefon")
        .order("name")
        .then(({ data }) => {
          if (data) setCustomers(data);
        });

      // Load employees (hidden Profile ausblenden)
      (async () => {
        const [{ data: emps }, { data: hiddenProfs }] = await Promise.all([
          (supabase.from("employees" as never) as any)
            .select("id, vorname, nachname, user_id").eq("aktiv", true).order("nachname"),
          (supabase.from("profiles" as never) as any).select("id").eq("hidden", true),
        ]);
        const hiddenIds = new Set(((hiddenProfs as any[]) || []).map((p: any) => p.id));
        if (emps) setEmployees((emps as any[]).filter((e: any) => !e.user_id || !hiddenIds.has(e.user_id)));
      })();

      // Load project statuses
      (supabase.from("project_statuses" as never) as any)
        .select("id, name, is_default")
        .order("sort_order")
        .then(({ data }: any) => {
          if (data && data.length > 0) {
            setProjectStatuses(data);
            const defaultStatus = data.find((s: any) => s.is_default);
            setStatus(defaultStatus ? defaultStatus.name : data[0].name);
          } else {
            setProjectStatuses([]);
            setStatus("Anfrage");
          }
        });
    }
  }, [open]);

  const selectCustomer = (c: CustomerOption) => {
    setSelectedCustomerId(c.id);
    setCustomerName(c.name);
    setAdresse(c.adresse || "");
    setPlz(c.plz || "");
    setOrt(c.ort || "");
    setLand(c.land || "Österreich");
    setEmail(c.email || "");
    setTelefon(c.telefon || "");
    setUidNummer(c.uid_nummer || "");
    setAnrede((c as any).anrede || "");
    setTitel((c as any).titel || "");
    setCustomerPopoverOpen(false);
    if (!projectName) setProjectName(c.name);
  };

  const toggleLeistungsart = (wert: string) => {
    setLeistungsarten((prev) =>
      prev.includes(wert) ? prev.filter((l) => l !== wert) : [...prev, wert]
    );
  };

  const toggleMitarbeiter = (id: string) => {
    setZugewieseneMitarbeiter((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const handleSave = async () => {
    if (!projectName.trim()) {
      toast({ variant: "destructive", title: "Projektname erforderlich" });
      return;
    }

    // H-1: Geplantes Ende darf nicht vor geplantem Start liegen
    if (geplanterStart && geplantesEnde && geplantesEnde < geplanterStart) {
      toast({ variant: "destructive", title: "Zeitraum ungültig", description: "Geplantes Ende darf nicht vor dem geplanten Start liegen." });
      return;
    }

    // H-2: Budget + Auftragsvolumen nicht negativ
    if (budget && Number(budget) < 0) {
      toast({ variant: "destructive", title: "Budget ungültig", description: "Budget darf nicht negativ sein." });
      return;
    }
    if (auftragsvolumen && Number(auftragsvolumen) < 0) {
      toast({ variant: "destructive", title: "Auftragsvolumen ungültig", description: "Auftragsvolumen darf nicht negativ sein." });
      return;
    }

    // H-3: Projekt ohne Kunde — erlaubt (z.B. interne Projekte), aber mit Hinweis
    if (!selectedCustomerId && !customerName.trim()) {
      const ok = window.confirm("Dieses Projekt hat keinen Kunden. Wirklich ohne Kunde anlegen?");
      if (!ok) return;
    }

    // E-Mail-Validierung wenn gesetzt
    if (email && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast({ variant: "destructive", title: "Ungültige E-Mail", description: "Bitte gültige E-Mail-Adresse eingeben" });
      return;
    }

    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Nicht angemeldet");

      let customerId = selectedCustomerId;

      // Find or create customer (duplicate protection by name)
      if (!customerId && customerName.trim()) {
        let query = supabase.from("customers").select("id").ilike("name", customerName.trim());
        if (plz.trim()) query = query.eq("plz", plz.trim());
        const { data: existing } = await query.limit(1).maybeSingle();

        if (existing) {
          customerId = existing.id;
          await supabase
            .from("customers")
            .update({
              adresse: adresse.trim() || undefined,
              plz: plz.trim() || undefined,
              ort: ort.trim() || undefined,
              email: email.trim() || undefined,
              telefon: telefon.trim() || undefined,
              uid_nummer: uidNummer.trim() || undefined,
              anrede: anrede || undefined,
              titel: titel.trim() || undefined,
            })
            .eq("id", existing.id);
        } else {
          const { data: newCustomer, error: custErr } = await supabase
            .from("customers")
            .insert({
              user_id: user.id,
              name: customerName.trim(),
              adresse: adresse.trim() || null,
              plz: plz.trim() || null,
              ort: ort.trim() || null,
              land: land.trim() || null,
              email: email.trim() || null,
              telefon: telefon.trim() || null,
              uid_nummer: uidNummer.trim() || null,
              anrede: anrede || null,
              titel: titel.trim() || null,
            })
            .select("id")
            .single();
          if (custErr) throw custErr;
          customerId = newCustomer.id;
        }
      }

      // Duplicate-Check: gleiches Projekt für diesen Kunden?
      // Verhindert dass beim Ersttermin-Anlegen versehentlich ein zweites
      // Projekt mit gleichem Namen erzeugt wird.
      if (customerId) {
        const { data: existing } = await supabase
          .from("projects")
          .select("id, name")
          .ilike("name", projectName.trim())
          .eq("customer_id", customerId)
          .limit(1)
          .maybeSingle();

        if (existing) {
          toast({
            title: "Projekt bereits vorhanden",
            description: `"${existing.name}" existiert schon für diesen Kunden und wurde verknüpft.`,
          });
          onCreated(existing as { id: string; name: string });
          setSaving(false);
          return;
        }
      }

      // Get next project number
      const { data: projektNummer } = await supabase.rpc("next_document_number" as never, {
        p_typ: "projekt",
      } as never);

      const { data: newProject, error } = await supabase
        .from("projects")
        .insert({
          name: projectName.trim(),
          beschreibung: beschreibung.trim() || null,
          status: status || "Anfrage",
          erfassungsdatum: erfassungsDatum || null,
          projektnummer: projektNummer || null,
          // Kunde
          customer_id: customerId,
          // Projektadresse / Leistungsort
          adresse: projektAdresse.trim() || null,
          plz: projektPlz.trim() || null,
          ort: projektOrt.trim() || null,
          land: projektLand.trim() || null,
          projekt_kontakt_name: projektKontaktName.trim() || null,
          projekt_kontakt_telefon: projektKontaktTelefon.trim() || null,
          bereich: bereich || null,
          zusatzinfos: zusatzinfos.trim() || null,
          wegbeschreibung: wegbeschreibung.trim() || null,
          // Projektinhalt
          projekt_typ: projektTyp || null,
          projektart: projektart || null,
          prioritaet: prioritaet || "normal",
          leistungsarten: leistungsarten.length > 0 ? leistungsarten : null,
          geplanter_start: geplanterStart || null,
          geplantes_ende: geplantesEnde || null,
          budget: budget ? parseFloat(budget) : null,
          auftragsvolumen: auftragsvolumen ? parseFloat(auftragsvolumen) : null,
          // Team
          projektverantwortlicher_id: projektverantwortlicherId || null,
          bauleiter_id: bauleiterId || null,
          zugewiesene_mitarbeiter:
            zugewieseneMitarbeiter.length > 0 ? zugewieseneMitarbeiter : null,
        } as any)
        .select("id, name")
        .single();

      if (error) throw error;

      setCreatedProjectId(newProject.id);
      setCreatedProjectName(newProject.name);

      toast({
        title: "Projekt erstellt",
        description: `"${newProject.name}" wurde angelegt. Sie können jetzt Dateien hochladen.`,
      });

      // Notify parent so it can refresh lists etc.
      onCreated(newProject);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Fehler", description: err.message });
    } finally {
      setSaving(false);
    }
  };

  // --- File upload helpers ---
  const handleFileUpload = async (
    files: FileList | null,
    bucket: string,
    bucketLabel: string
  ) => {
    if (!files || files.length === 0 || !createdProjectId) return;

    setUploading(bucket);
    try {
      const newFiles: UploadedFile[] = [];

      for (const file of Array.from(files)) {
        const timestamp = Date.now();
        const filePath = `${createdProjectId}/${timestamp}-${file.name}`;

        const { error } = await supabase.storage.from(bucket).upload(filePath, file);
        if (error) throw error;

        newFiles.push({ name: file.name, bucket, path: filePath });
      }

      setUploadedFiles((prev) => [...prev, ...newFiles]);
      toast({
        title: "Hochgeladen",
        description: `${files.length} ${bucketLabel} hochgeladen.`,
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Upload-Fehler", description: err.message });
    } finally {
      setUploading(null);
    }
  };

  const handleDeleteFile = async (file: UploadedFile) => {
    try {
      const { error } = await supabase.storage.from(file.bucket).remove([file.path]);
      if (error) throw error;

      setUploadedFiles((prev) => prev.filter((f) => f.path !== file.path));
      toast({ title: "Gelöscht", description: `"${file.name}" wurde entfernt.` });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Fehler", description: err.message });
    }
  };

  const handleClose = () => {
    setCreatedProjectId(null);
    onClose();
  };

  // Default leistungsarten if config is empty
  const defaultLeistungsarten = [
    { wert: "beratung", label: "Beratung" },
    { wert: "planung", label: "Planung" },
    { wert: "lieferung", label: "Lieferung" },
    { wert: "montage", label: "Montage" },
    { wert: "reparatur", label: "Reparatur" },
    { wert: "wartung", label: "Wartung" },
    { wert: "sanierung", label: "Sanierung" },
    { wert: "sonstiges", label: "Sonstiges" },
  ];

  const effectiveLeistungsarten =
    leistungsartOptions.length > 0
      ? leistungsartOptions.map((o) => ({ wert: o.wert, label: o.label }))
      : defaultLeistungsarten;

  // Default projekt_typ if config is empty
  const defaultProjektTypen = [
    { wert: "hauptprojekt", label: "Hauptprojekt" },
    { wert: "unterprojekt", label: "Unterprojekt" },
    { wert: "einzelprojekt", label: "Einzelprojekt" },
  ];

  const effectiveProjektTypen =
    projektTypOptions.length > 0
      ? projektTypOptions.map((o) => ({ wert: o.wert, label: o.label }))
      : defaultProjektTypen;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building className="w-5 h-5" />
            {createdProjectId ? (
              <span className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                Projekt erstellt - Dateien hochladen
              </span>
            ) : (
              "Neues Projekt erstellen"
            )}
          </DialogTitle>
        </DialogHeader>

        {/* ============================================================ */}
        {/* POST-SAVE: Upload section                                     */}
        {/* ============================================================ */}
        {createdProjectId ? (
          <div className="space-y-6">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-800 font-medium">
                Projekt "{createdProjectName}" wurde erfolgreich erstellt.
              </p>
              <p className="text-xs text-green-600 mt-1">
                Sie können jetzt Fotos, Pläne und Dokumente hochladen.
              </p>
            </div>

            {/* Fotos */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold flex items-center gap-2">
                <Image className="w-4 h-4" />
                Fotos hochladen
              </Label>
              <input
                ref={photoInputRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={(e) =>
                  handleFileUpload(e.target.files, "project-photos", "Foto(s)")
                }
              />
              <Button
                variant="outline"
                className="w-full"
                disabled={uploading === "project-photos"}
                onClick={() => photoInputRef.current?.click()}
              >
                <Upload className="w-4 h-4 mr-2" />
                {uploading === "project-photos" ? "Lädt hoch..." : "Fotos auswählen"}
              </Button>
              {uploadedFiles
                .filter((f) => f.bucket === "project-photos")
                .map((f) => (
                  <div
                    key={f.path}
                    className="flex items-center justify-between text-sm bg-muted rounded px-3 py-1.5"
                  >
                    <span className="truncate">{f.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-destructive"
                      onClick={() => handleDeleteFile(f)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
            </div>

            {/* Pläne */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold flex items-center gap-2">
                <Map className="w-4 h-4" />
                Pläne hochladen
              </Label>
              <input
                ref={planInputRef}
                type="file"
                multiple
                accept=".pdf,.dwg,.dxf,.png,.jpg,.jpeg"
                className="hidden"
                onChange={(e) =>
                  handleFileUpload(e.target.files, "project-plans", "Plan/Pläne")
                }
              />
              <Button
                variant="outline"
                className="w-full"
                disabled={uploading === "project-plans"}
                onClick={() => planInputRef.current?.click()}
              >
                <Upload className="w-4 h-4 mr-2" />
                {uploading === "project-plans" ? "Lädt hoch..." : "Pläne auswählen"}
              </Button>
              {uploadedFiles
                .filter((f) => f.bucket === "project-plans")
                .map((f) => (
                  <div
                    key={f.path}
                    className="flex items-center justify-between text-sm bg-muted rounded px-3 py-1.5"
                  >
                    <span className="truncate">{f.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-destructive"
                      onClick={() => handleDeleteFile(f)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
            </div>

            {/* Dokumente */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Dokumente hochladen
              </Label>
              <input
                ref={docInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) =>
                  handleFileUpload(e.target.files, "project-reports", "Dokument(e)")
                }
              />
              <Button
                variant="outline"
                className="w-full"
                disabled={uploading === "project-reports"}
                onClick={() => docInputRef.current?.click()}
              >
                <Upload className="w-4 h-4 mr-2" />
                {uploading === "project-reports" ? "Lädt hoch..." : "Dokumente auswählen"}
              </Button>
              {uploadedFiles
                .filter((f) => f.bucket === "project-reports")
                .map((f) => (
                  <div
                    key={f.path}
                    className="flex items-center justify-between text-sm bg-muted rounded px-3 py-1.5"
                  >
                    <span className="truncate">{f.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-destructive"
                      onClick={() => handleDeleteFile(f)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
            </div>

            <div className="flex justify-end pt-4 border-t">
              <Button onClick={handleClose}>Fertig</Button>
            </div>
          </div>
        ) : (
          /* ============================================================ */
          /* PRE-SAVE: Full project creation form                          */
          /* ============================================================ */
          <div className="space-y-6">
            {/* ======== Section 1: Projektdaten ======== */}
            <div className="space-y-3">
              <Label className="text-base font-semibold border-b pb-1 block">
                Projektdaten
              </Label>
              <div>
                <Label>Projektname *</Label>
                <Input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="z.B. Badezimmer Sanierung Müller"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Projektnummer</Label>
                  <Input
                    disabled
                    value="(wird automatisch vergeben)"
                    className="text-muted-foreground"
                  />
                </div>
                <div>
                  <Label>Status</Label>
                  <Select
                    value={status || "none"}
                    onValueChange={(v) => setStatus(v === "none" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Status wählen..." />
                    </SelectTrigger>
                    <SelectContent>
                      {projectStatuses.length > 0 ? (
                        projectStatuses.map((s) => (
                          <SelectItem key={s.id} value={s.name}>
                            {s.name}
                          </SelectItem>
                        ))
                      ) : (
                        <>
                          <SelectItem value="Anfrage">Anfrage</SelectItem>
                          <SelectItem value="In Arbeit">In Arbeit</SelectItem>
                          <SelectItem value="Abgeschlossen">Abgeschlossen</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Datum der Erfassung</Label>
                <Input
                  type="date"
                  value={erfassungsDatum}
                  onChange={(e) => setErfassungsDatum(e.target.value)}
                />
              </div>
              <div>
                <Label>Bereich / Firma</Label>
                <Select value={bereich || "none"} onValueChange={(v) => setBereich(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Wählen..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">--</SelectItem>
                    {bereichOptions.map((o) => (
                      <SelectItem key={o.id} value={o.wert}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Mandant für Kalender-Zuordnung (Monti.pro, Gartenmacher, …).</p>
              </div>
              <div>
                <Label>Beschreibung / Kurzbeschreibung</Label>
                <Textarea
                  value={beschreibung}
                  onChange={(e) => setBeschreibung(e.target.value)}
                  placeholder="Kurze Projektbeschreibung..."
                  rows={3}
                />
              </div>
            </div>

            {/* ======== Section 2: Kunde ======== */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold border-b pb-1 block">
                  Kunde
                </Label>
                {selectedCustomerId && (
                  <span className="text-xs text-green-600 font-medium">
                    Kunde ausgewählt
                  </span>
                )}
              </div>

              <Tabs value={customerTab} onValueChange={(v) => setCustomerTab(v as any)}>
                <TabsList className="w-full mb-3">
                  <TabsTrigger value="existing" className="flex-1 gap-1">
                    <Search className="w-3.5 h-3.5" />
                    Bestehender Kunde
                  </TabsTrigger>
                  <TabsTrigger value="new" className="flex-1 gap-1">
                    <UserPlus className="w-3.5 h-3.5" />
                    Neuer Kunde
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="existing">
                  <Popover open={customerPopoverOpen} onOpenChange={setCustomerPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start gap-2">
                        <Search className="w-4 h-4" />
                        {customerName || "Kunde suchen..."}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[350px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Kunde suchen..." />
                        <CommandList>
                          <CommandEmpty>Kein Kunde gefunden</CommandEmpty>
                          <CommandGroup>
                            {customers.map((c) => (
                              <CommandItem
                                key={c.id}
                                value={c.name}
                                onSelect={() => selectCustomer(c)}
                              >
                                <div>
                                  <p className="font-medium text-sm">{c.name}</p>
                                  {c.ort && (
                                    <p className="text-xs text-muted-foreground">
                                      {c.plz} {c.ort}
                                    </p>
                                  )}
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </TabsContent>

                <TabsContent value="new" className="space-y-3">
                  <div>
                    <Label>Firma / Name *</Label>
                    <Input
                      value={customerName}
                      onChange={(e) => {
                        setCustomerName(e.target.value);
                        setSelectedCustomerId(null);
                      }}
                      placeholder="Firma / Name"
                    />
                  </div>
                </TabsContent>
              </Tabs>

              {/* Anrede/Titel + Adresse (always visible) */}
              <div className="space-y-3 mt-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Anrede/Firma</Label>
                    <Select
                      value={anrede || "none"}
                      onValueChange={(v) => setAnrede(v === "none" ? "" : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Wählen..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">--</SelectItem>
                        <SelectItem value="Herr">Herr</SelectItem>
                        <SelectItem value="Frau">Frau</SelectItem>
                        <SelectItem value="Firma">Firma</SelectItem>
                        <SelectItem value="Divers">Divers</SelectItem>
                        <SelectItem value="Familie">Familie</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Titel</Label>
                    <Input
                      value={titel}
                      onChange={(e) => setTitel(e.target.value)}
                      placeholder="Mag., Dr., Ing."
                    />
                  </div>
                </div>
                <AddressAutocomplete
                  label="Adresse"
                  value={adresse}
                  onChange={setAdresse}
                  onSelect={(addr) => { setAdresse(addr.street); setPlz(addr.plz); setOrt(addr.ort); }}
                  placeholder="Straße + Hausnr."
                />
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label>PLZ</Label>
                    <Input value={plz} onChange={(e) => setPlz(e.target.value)} placeholder="8831" />
                  </div>
                  <div className="col-span-2">
                    <Label>Ort</Label>
                    <Input value={ort} onChange={(e) => setOrt(e.target.value)} placeholder="Niederwölz" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>E-Mail</Label>
                    <Input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="kunde@email.at"
                      type="email"
                    />
                  </div>
                  <div>
                    <Label>Telefon</Label>
                    <Input
                      value={telefon}
                      onChange={(e) => setTelefon(e.target.value)}
                      placeholder="+43 ..."
                    />
                  </div>
                </div>
                <div>
                  <Label>UID-Nummer</Label>
                  <Input
                    value={uidNummer}
                    onChange={(e) => setUidNummer(e.target.value)}
                    placeholder="ATU..."
                  />
                </div>
              </div>
            </div>

            {/* ======== Section 3: Projektadresse / Leistungsort ======== */}
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b pb-1">
                <Label className="text-base font-semibold block">
                  Projektadresse / Leistungsort
                </Label>
                {(adresse || plz || ort) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setProjektAdresse(adresse);
                      setProjektPlz(plz);
                      setProjektOrt(ort);
                      if (!projektKontaktName) setProjektKontaktName(customerName);
                      if (!projektKontaktTelefon) setProjektKontaktTelefon(telefon);
                    }}
                  >
                    Kundenadresse übernehmen
                  </Button>
                )}
              </div>
              <AddressAutocomplete
                label="Adresse"
                value={projektAdresse}
                onChange={setProjektAdresse}
                onSelect={(addr) => { setProjektAdresse(addr.street); setProjektPlz(addr.plz); setProjektOrt(addr.ort); }}
                placeholder="Straße + Hausnr. des Projekts"
              />
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label>PLZ</Label>
                  <Input value={projektPlz} onChange={(e) => setProjektPlz(e.target.value)} placeholder="8831" />
                </div>
                <div className="col-span-2">
                  <Label>Ort</Label>
                  <Input value={projektOrt} onChange={(e) => setProjektOrt(e.target.value)} placeholder="z.B. Wien, Graz..." />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Kontakt vor Ort</Label>
                  <Input value={projektKontaktName} onChange={(e) => setProjektKontaktName(e.target.value)} placeholder="z.B. Frau Müller" />
                </div>
                <div>
                  <Label>Telefon</Label>
                  <Input type="tel" value={projektKontaktTelefon} onChange={(e) => setProjektKontaktTelefon(e.target.value)} placeholder="+43 664 ..." />
                </div>
              </div>
              <div>
                <Label>Land</Label>
                <Input
                  value={projektLand}
                  onChange={(e) => setProjektLand(e.target.value)}
                  placeholder="Österreich"
                />
              </div>
              <div>
                <Label>Zusatzinfos</Label>
                <Textarea
                  value={zusatzinfos}
                  onChange={(e) => setZusatzinfos(e.target.value)}
                  placeholder="Schlüsselstandort, Zugang, Besonderheiten..."
                  rows={2}
                />
              </div>
              <div>
                <Label>Wegbeschreibung</Label>
                <Textarea
                  value={wegbeschreibung}
                  onChange={(e) => setWegbeschreibung(e.target.value)}
                  placeholder="Anfahrt, Google Maps Link..."
                  rows={2}
                />
              </div>
            </div>

            {/* ======== Section 4: Projektinhalt ======== */}
            <div className="space-y-3">
              <Label className="text-base font-semibold border-b pb-1 block">
                Projektinhalt
              </Label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Art des Projekts / Projekt-Typ</Label>
                  <Select
                    value={projektTyp || "none"}
                    onValueChange={(v) => setProjektTyp(v === "none" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Wählen..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">--</SelectItem>
                      {effectiveProjektTypen.map((o) => (
                        <SelectItem key={o.wert} value={o.wert}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Projektart</Label>
                  <Select
                    value={projektart || "none"}
                    onValueChange={(v) => setProjektart(v === "none" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Wählen..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">--</SelectItem>
                      {projektartOptions.map((o) => (
                        <SelectItem key={o.id} value={o.wert}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Priorität</Label>
                <Select
                  value={prioritaet || "normal"}
                  onValueChange={(v) => setPrioritaet(v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Normal" />
                  </SelectTrigger>
                  <SelectContent>
                    {prioritaetOptions.length > 0 ? (
                      prioritaetOptions.map((o) => (
                        <SelectItem key={o.id} value={o.wert}>
                          {o.label}
                        </SelectItem>
                      ))
                    ) : (
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

              {/* Leistungsarten - checkboxes */}
              <div>
                <Label className="mb-2 block">Art der Leistung</Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {effectiveLeistungsarten.map((l) => (
                    <label
                      key={l.wert}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <Checkbox
                        checked={leistungsarten.includes(l.wert)}
                        onCheckedChange={() => toggleLeistungsart(l.wert)}
                      />
                      {l.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Geplanter Start</Label>
                  <Input
                    type="date"
                    value={geplanterStart}
                    onChange={(e) => setGeplanterStart(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Geplantes Ende</Label>
                  <Input
                    type="date"
                    value={geplantesEnde}
                    onChange={(e) => setGeplantesEnde(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Budget</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <Label>Auftragsvolumen</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={auftragsvolumen}
                    onChange={(e) => setAuftragsvolumen(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>

            {/* ======== Section 5: Team ======== */}
            <div className="space-y-3">
              <Label className="text-base font-semibold border-b pb-1 block">Team</Label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Projektverantwortlicher</Label>
                  <Select
                    value={projektverantwortlicherId || "none"}
                    onValueChange={(v) =>
                      setProjektverantwortlicherId(v === "none" ? "" : v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Wählen..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">--</SelectItem>
                      {employees.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.vorname} {e.nachname}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Bauleiter</Label>
                  <Select
                    value={bauleiterId || "none"}
                    onValueChange={(v) => setBauleiterId(v === "none" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Wählen..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">--</SelectItem>
                      {employees.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.vorname} {e.nachname}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="mb-2 block">Zugewiesene Mitarbeiter</Label>
                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto border rounded-md p-3">
                  {employees.length > 0 ? (
                    employees.map((e) => (
                      <label
                        key={e.id}
                        className="flex items-center gap-2 text-sm cursor-pointer"
                      >
                        <Checkbox
                          checked={zugewieseneMitarbeiter.includes(e.id)}
                          onCheckedChange={() => toggleMitarbeiter(e.id)}
                        />
                        {e.vorname} {e.nachname}
                      </label>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground col-span-2">
                      Keine aktiven Mitarbeiter gefunden
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* ======== Actions ======== */}
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" onClick={onClose}>
                Abbrechen
              </Button>
              <Button onClick={handleSave} disabled={saving || !projectName.trim()}>
                {saving ? "Erstellt..." : "Projekt erstellen"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

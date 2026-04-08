import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Save, Trash2, CheckCircle, PenLine, FolderPlus, Camera, Upload, ZoomIn, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useConfigOptions } from "@/hooks/useConfigOptions";
import { PageHeader } from "@/components/PageHeader";
import { SignaturePad } from "@/components/SignaturePad";
import { CustomerSelect } from "@/components/CustomerSelect";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";

interface ErstterminPhoto {
  id: string;
  file_path: string;
  file_name: string;
  beschreibung: string | null;
  created_at: string;
}

export default function ErstterminDetail() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "neu";
  const navigate = useNavigate();
  const { toast } = useToast();
  const { options: projektartOptions } = useConfigOptions("projektart");
  const { options: entscheidungsOptions } = useConfigOptions("entscheidungsstatus");
  const { options: checklistenItems } = useConfigOptions("ersttermin_checkliste");

  // Section 1: Allgemeine Daten
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [ansprechpartner, setAnsprechpartner] = useState("");
  const [projektname, setProjektname] = useState("");
  const [standort, setStandort] = useState("");
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
  const [budget, setBudget] = useState<number | "">("");
  const [quelle, setQuelle] = useState("");
  const [prioritaeten, setPrioritaeten] = useState("");

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
  const [flaecheAufmass, setFlaecheAufmass] = useState("");
  const [anmerkungen, setAnmerkungen] = useState("");

  // Section 5: Naechste Schritte
  const [angebotErsteller, setAngebotErsteller] = useState("");
  const [angebotBis, setAngebotBis] = useState("");
  const [folgeterminNoetig, setFolgeterminNoetig] = useState(false);
  const [folgeterminDatum, setFolgeterminDatum] = useState("");
  const [fehlendeUnterlagen, setFehlendeUnterlagen] = useState("");
  const [zustaendigkeitenIntern, setZustaendigkeitenIntern] = useState("");
  const [zustaendigkeitenExtern, setZustaendigkeitenExtern] = useState("");

  // Section 6: Ressourcen & Kalkulation
  const [bauleiter, setBauleiter] = useState("");
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

  // Signatures & status
  const [status, setStatus] = useState("entwurf");
  const [signaturBerater, setSignaturBerater] = useState<string | null>(null);
  const [signaturInteressent, setSignaturInteressent] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  // UI state
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [skipSignBerater, setSkipSignBerater] = useState(false);
  const [skipSignInteressent, setSkipSignInteressent] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(isNew ? null : id || null);
  const [ressourcenOpen, setRessourcenOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);

  // Photos state
  const [photos, setPhotos] = useState<ErstterminPhoto[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { init(); }, [id]);

  const init = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { navigate("/auth"); return; }

    if (!isNew && id) {
      const { data } = await (supabase.from("ersttermin_interessent" as never) as any)
        .select("*").eq("id", id).single();
      if (data) {
        const d = data as any;
        const s = (v: any) => v || "";
        setCustomerId(d.customer_id || null); setAnsprechpartner(s(d.notizen));
        setProjektname(s(d.projektname)); setStandort(s(d.standort));
        setTelefon(s(d.telefon)); setEmail(s(d.email)); setDatum(s(d.datum));
        setNummer(s(d.nummer));
        setProjektart(s(d.projektart)); setGewerk(s(d.gewerke));
        setLeistungsumfang(s(d.umfang)); setEntscheidungsstatus(s(d.entscheidungsstatus));
        setZeitrahmen(s(d.zeitrahmen)); setBudget(d.budget ?? "");
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
        setBauleiter(s(d.bauleiter)); setBeteiligte(s(d.beteiligte));
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
        setSignaturBerater(d.unterschrift_berater || null);
        setSignaturInteressent(d.unterschrift_interessent || null);
        setProjectId(d.project_id || null);
      }
      fetchPhotos(id);
    }
    setLoading(false);
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

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || !savedId) return;
    setUploading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setUploading(false); return; }
    let count = 0;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) continue;
      const fileName = `${savedId}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from("ersttermin-photos").upload(fileName, file);
      if (upErr) continue;
      const { error: dbErr } = await (supabase.from("ersttermin_interessent_photos" as never) as any)
        .insert({ ersttermin_interessent_id: savedId, user_id: user.id, file_path: fileName, file_name: file.name });
      if (dbErr) { await supabase.storage.from("ersttermin-photos").remove([fileName]); continue; }
      count++;
    }
    if (count > 0) { toast({ title: "Erfolg", description: `${count} Foto${count > 1 ? "s" : ""} hochgeladen` }); fetchPhotos(savedId); }
    if (fileInputRef.current) fileInputRef.current.value = "";
    setUploading(false);
  };

  const handlePhotoDelete = async (p: ErstterminPhoto) => {
    await supabase.storage.from("ersttermin-photos").remove([p.file_path]);
    await (supabase.from("ersttermin_interessent_photos" as never) as any).delete().eq("id", p.id);
    setPhotos((prev) => prev.filter((x) => x.id !== p.id));
  };
  // Save
  const handleSave = async () => {
    setSaving(true);
    let docNummer = nummer;
    if (!docNummer) {
      const { data: nextNum } = await supabase.rpc("next_document_number" as never, { p_typ: "ersttermin" } as never);
      if (nextNum) docNummer = String(nextNum);
    }

    const payload: any = {
      customer_id: customerId, notizen: ansprechpartner, projektname, standort, telefon, email, datum,
      nummer: docNummer, projektart: projektart || null, gewerke: gewerk, umfang: leistungsumfang,
      entscheidungsstatus: entscheidungsstatus || null, zeitrahmen, budget: budget === "" ? null : budget,
      quelle, prioritaeten, zufahrt_parkplatz: zufahrt, infrastruktur, materialien, sicherheit, hindernisse, entsorgung,
      genehmigungen_relevant: genehmigungen, offene_technische_fragen: offeneFragen, leistungsbeschreibung, firmen_intern: firmenIntern,
      firmen_extern: firmenExtern, aufmasse: flaecheAufmass, anmerkungen,
      angebot_ersteller: angebotErsteller, angebot_bis: angebotBis || null,
      folgetermin_noetig: folgeterminNoetig, folgetermin_datum: folgeterminDatum || null,
      fehlende_unterlagen: fehlendeUnterlagen, zustaendigkeiten_intern: zustaendigkeitenIntern,
      zustaendigkeiten_extern: zustaendigkeitenExtern, bauleiter, beteiligte, benoetigte_materialien: benoetigteMaterialien,
      stunden_schaetzung: stundenSchaetzung === "" ? null : stundenSchaetzung,
      materialkosten: materialkosten === "" ? null : materialkosten,
      fremdkosten: fremdkosten === "" ? null : fremdkosten,
      gesamtkosten: gesamtkosten === "" ? null : gesamtkosten,
      checkliste, status, unterschrift_berater: signaturBerater, unterschrift_interessent: signaturInteressent,
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

    toast({ title: "Gespeichert", description: "Ersttermin wurde gespeichert" });
    if (isNew && eid) navigate(`/ersttermine/${eid}`, { replace: true });
    setSaving(false);
    if (status === "entwurf") setSignDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!savedId) return;
    setDeleting(true);
    const { error } = await (supabase.from("ersttermin_interessent" as never) as any).delete().eq("id", savedId);
    if (error) { toast({ variant: "destructive", title: "Fehler", description: "Loeschen fehlgeschlagen" }); }
    else { toast({ title: "Geloescht" }); navigate("/ersttermine"); }
    setDeleting(false);
  };

  const handleFinalize = async () => {
    if (!savedId) return;
    setSaving(true);
    const finalPayload: any = {
      status: "abgeschlossen",
      unterschrift_berater: skipSignBerater ? null : signaturBerater,
      unterschrift_interessent: skipSignInteressent ? null : signaturInteressent,
    };
    if (signaturBerater || signaturInteressent) finalPayload.unterschrift_am = new Date().toISOString();
    const { error } = await (supabase.from("ersttermin_interessent" as never) as any).update(finalPayload).eq("id", savedId);
    if (error) { toast({ variant: "destructive", title: "Fehler", description: "Abschliessen fehlgeschlagen" }); }
    else { setStatus("abgeschlossen"); setSignDialogOpen(false); toast({ title: "Abgeschlossen", description: "Ersttermin wurde abgeschlossen" }); }
    setSaving(false);
  };

  const handleProjectCreated = async (project: { id: string; name: string }) => {
    setProjectId(project.id);
    setCreateProjectOpen(false);
    if (savedId) {
      await (supabase.from("ersttermin_interessent" as never) as any).update({ project_id: project.id }).eq("id", savedId);
    }
    toast({ title: "Projekt erstellt", description: `Projekt "${project.name}" verknuepft` });
  };

  const numInput = (val: number | "", set: (v: number | "") => void) => (
    <Input type="number" value={val} onChange={(e) => set(e.target.value === "" ? "" : Number(e.target.value))} />
  );
  const field = (label: string, val: string, set: (v: string) => void, rows = 0, ph = "") => (
    <div className="space-y-1"><Label>{label}</Label>
      {rows > 0 ? <Textarea rows={rows} value={val} onChange={(e) => set(e.target.value)} placeholder={ph} />
        : <Input value={val} onChange={(e) => set(e.target.value)} placeholder={ph} />}
    </div>
  );

  const badge = status === "entwurf" ? <Badge variant="secondary">Entwurf</Badge>
    : status === "abgeschlossen" ? <Badge className="bg-green-500 text-white">Abgeschlossen</Badge>
    : <Badge variant="outline">{status}</Badge>;

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title={isNew ? "Neuer Ersttermin" : `Ersttermin ${nummer || ""}`} backPath="/ersttermine" />

      <main className="container mx-auto px-4 py-6 max-w-4xl space-y-6">
        {/* Status & Actions */}
        <div className="flex flex-wrap gap-2 justify-between items-center">
          <div className="flex items-center gap-2">
            {badge}
            {status === "entwurf" && savedId && (
              <Button variant="outline" size="sm" onClick={() => setSignDialogOpen(true)}>
                <PenLine className="h-4 w-4 mr-1" />Unterschreiben & Abschliessen
              </Button>
            )}
            {savedId && !projectId && (
              <Button variant="outline" size="sm" onClick={() => setCreateProjectOpen(true)}>
                <FolderPlus className="h-4 w-4 mr-1" />Projekt erstellen
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {savedId && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={deleting}><Trash2 className="h-4 w-4 mr-1" />Loeschen</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader><AlertDialogTitle>Ersttermin loeschen?</AlertDialogTitle>
                    <AlertDialogDescription>Dieser Ersttermin wird unwiderruflich geloescht.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>Abbrechen</AlertDialogCancel><AlertDialogAction onClick={handleDelete}>Loeschen</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              <Save className="h-4 w-4" />{saving ? "Speichert..." : "Speichern"}
            </Button>
          </div>
        </div>

        {/* 1. Allgemeine Daten */}
        <Card>
          <CardHeader><CardTitle>Allgemeine Daten</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1"><Label>Kunde</Label>
              <CustomerSelect value={customerId} onChange={(cid, customer) => {
                setCustomerId(cid);
                if (customer) {
                  if (customer.adresse || customer.plz || customer.ort) {
                    setStandort([customer.adresse, [customer.plz, customer.ort].filter(Boolean).join(" ")].filter(Boolean).join(", "));
                  }
                  if (customer.telefon && !telefon) setTelefon(customer.telefon);
                  if (customer.email && !email) setEmail(customer.email);
                }
              }} />
            </div>
            {field("Ansprechpartner vor Ort", ansprechpartner, setAnsprechpartner, 0, "Name des Ansprechpartners")}
            {field("Projektname", projektname, setProjektname, 0, "Projektbezeichnung")}
            {field("Standort / Baustellenadresse", standort, setStandort, 0, "Adresse der Baustelle")}
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
                <SelectTrigger><SelectValue placeholder="Projektart waehlen" /></SelectTrigger>
                <SelectContent>{projektartOptions.map((o) => <SelectItem key={o.id} value={o.wert}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {field("Gewerk (betroffene Bereiche)", gewerk, setGewerk, 0, "z.B. Fassade, Innenausbau...")}
            {field("Leistungsumfang", leistungsumfang, setLeistungsumfang, 3, "Beschreibung des Leistungsumfangs")}
            <div className="space-y-1"><Label>Entscheidungsstatus</Label>
              <Select value={entscheidungsstatus} onValueChange={setEntscheidungsstatus}>
                <SelectTrigger><SelectValue placeholder="Status waehlen" /></SelectTrigger>
                <SelectContent>{entscheidungsOptions.map((o) => <SelectItem key={o.id} value={o.wert}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {field("Zeitrahmen", zeitrahmen, setZeitrahmen, 0, "z.B. Q2 2026")}
            <div className="space-y-1"><Label>Budget</Label>{numInput(budget, setBudget)}</div>
            {field("Quelle / Empfehlung", quelle, setQuelle, 0, "Wie kam der Kontakt zustande?")}
            {field("Prioritaeten", prioritaeten, setPrioritaeten, 0, "z.B. Qualitaet, Preis, Termin")}
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
            {field("Hindernisse / Schutzmassnahmen", hindernisse, setHindernisse, 2)}
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
            {field("Firmen intern", firmenIntern, setFirmenIntern, 2)}
            {field("Firmen extern", firmenExtern, setFirmenExtern, 2)}
            {field("Flaeche / Aufmass", flaecheAufmass, setFlaecheAufmass, 2)}
            {field("Bemerkung / Anmerkungen", anmerkungen, setAnmerkungen, 3)}
          </CardContent>
        </Card>

        {/* 5. Naechste Schritte */}
        <Card>
          <CardHeader><CardTitle>Naechste Schritte</CardTitle></CardHeader>
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
            {field("Zustaendigkeiten intern", zustaendigkeitenIntern, setZustaendigkeitenIntern, 2)}
            {field("Zustaendigkeiten extern", zustaendigkeitenExtern, setZustaendigkeitenExtern, 2)}
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
                {field("Bauleiter", bauleiter, setBauleiter)}
                {field("Beteiligte", beteiligte, setBeteiligte, 2)}
                {field("Benoetigte Materialien", benoetigteMaterialien, setBenoetigteMaterialien, 2)}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="space-y-1"><Label>Stunden-Schaetzung</Label>{numInput(stundenSchaetzung, setStundenSchaetzung)}</div>
                  <div className="space-y-1"><Label>Materialkosten</Label>{numInput(materialkosten, setMaterialkosten)}</div>
                  <div className="space-y-1"><Label>Fremdkosten</Label>{numInput(fremdkosten, setFremdkosten)}</div>
                  <div className="space-y-1"><Label>Gesamtkosten</Label>{numInput(gesamtkosten, setGesamtkosten)}</div>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>

        {/* 7. Fotos */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2"><Camera className="h-5 w-5" />Fotos</CardTitle>
              <Button variant="outline" size="sm" onClick={async () => {
                if (!savedId) {
                  // Auto-save first to get an ID
                  toast({ title: "Wird gespeichert...", description: "Ersttermin wird zuerst gespeichert" });
                  await handleSave();
                  // After save, savedId is set via setSavedId - open file picker on next render
                  setTimeout(() => fileInputRef.current?.click(), 500);
                  return;
                }
                fileInputRef.current?.click();
              }} disabled={uploading || saving} className="gap-2">
                <Upload className="h-4 w-4" />{uploading ? "Laedt..." : "Foto hinzufuegen"}
              </Button>
            </div>
            {savedId && <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoUpload} />}
          </CardHeader>
            <CardContent>
              {!savedId ? (
              <div className="text-center py-8 text-muted-foreground">Bitte zuerst speichern, um Fotos hochladen zu können.</div>
            ) : photosLoading ? (
              <div className="text-center py-8 text-muted-foreground">Laedt Fotos...</div>
            ) : photos.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">Keine Fotos vorhanden</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {photos.map((photo) => (
                  <div key={photo.id} className="space-y-1">
                    <div className="relative group aspect-square">
                      <img src={getPhotoUrl(photo.file_path)} alt={photo.file_name} className="w-full h-full object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity" onClick={() => setSelectedPhoto(getPhotoUrl(photo.file_path))} />
                      <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-7 w-7 bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70" onClick={() => setSelectedPhoto(getPhotoUrl(photo.file_path))}><ZoomIn className="h-4 w-4" /></Button>
                      <Button variant="destructive" size="icon" className="absolute bottom-1 right-1 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handlePhotoDelete(photo)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            </CardContent>
          </Card>

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

        {/* Signatures summary */}
        {savedId && (signaturBerater || signaturInteressent) && (
          <Card>
            <CardHeader><CardTitle className="text-base">Unterschriften</CardTitle></CardHeader>
            <CardContent className="flex gap-6">
              {signaturBerater && <div><Label className="text-xs text-muted-foreground">Berater</Label><img src={signaturBerater} alt="Unterschrift Berater" className="border rounded-lg max-h-20 mt-1" /></div>}
              {signaturInteressent && <div><Label className="text-xs text-muted-foreground">Interessent</Label><img src={signaturInteressent} alt="Unterschrift Interessent" className="border rounded-lg max-h-20 mt-1" /></div>}
            </CardContent>
          </Card>
        )}

        {/* Bottom save */}
        <div className="flex justify-end gap-2">
          <Button onClick={handleSave} disabled={saving} className="gap-2"><Save className="h-4 w-4" />{saving ? "Speichert..." : "Speichern"}</Button>
        </div>

        {/* 9. Signature Dialog */}
        <Dialog open={signDialogOpen} onOpenChange={setSignDialogOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Unterschriften & Abschluss</DialogTitle></DialogHeader>
            <div className="space-y-6 py-2">
              {([["Berater", signaturBerater, setSignaturBerater, skipSignBerater, setSkipSignBerater],
                ["Interessent", signaturInteressent, setSignaturInteressent, skipSignInteressent, setSkipSignInteressent],
              ] as const).map(([label, sig, setSig, skip, setSkip], i) => (
                <div key={label}>
                  {i > 0 && <Separator className="mb-6" />}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="font-medium">Unterschrift {label}</Label>
                      <Button variant="ghost" size="sm" className="text-xs" onClick={() => { (setSig as any)(null); (setSkip as any)((p: boolean) => !p); }}>
                        {skip ? "Unterschrift hinzufuegen" : "Keine Unterschrift erforderlich"}
                      </Button>
                    </div>
                    {skip ? <div className="border rounded-lg p-3 bg-muted/50 text-sm text-muted-foreground text-center">Keine Unterschrift erforderlich</div>
                      : sig ? <div className="space-y-2"><img src={sig as string} alt={`Unterschrift ${label}`} className="border rounded-lg max-h-32" /><Button variant="outline" size="sm" onClick={() => (setSig as any)(null)}>Neu unterschreiben</Button></div>
                      : <SignaturePad onSignatureChange={setSig as any} />}
                  </div>
                </div>
              ))}
            </div>
            <DialogFooter className="flex flex-col sm:flex-row gap-2 mt-4">
              <Button variant="outline" onClick={() => setSignDialogOpen(false)}>Spaeter abschliessen</Button>
              <Button onClick={handleFinalize} disabled={saving} className="bg-green-600 hover:bg-green-700 gap-2">
                <CheckCircle className="h-4 w-4" />{saving ? "Wird abgeschlossen..." : "Ersttermin abschliessen"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Photo lightbox */}
        <Dialog open={!!selectedPhoto} onOpenChange={() => setSelectedPhoto(null)}>
          <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 overflow-hidden">
            <DialogClose className="absolute right-4 top-4 z-10 rounded-sm bg-black/50 p-2 opacity-70 hover:opacity-100"><X className="h-5 w-5 text-white" /></DialogClose>
            {selectedPhoto && <img src={selectedPhoto} alt="Vollbild" className="w-full h-full object-contain max-h-[90vh]" />}
          </DialogContent>
        </Dialog>

        {/* 10. Create Project Dialog */}
        <CreateProjectDialog
          open={createProjectOpen}
          onClose={() => setCreateProjectOpen(false)}
          onCreated={handleProjectCreated}
          defaultName={projektname}
          defaultCustomerId={customerId}
          defaultAdresse={standort}
        />
      </main>
    </div>
  );
}

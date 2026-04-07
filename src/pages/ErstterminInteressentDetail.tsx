import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Save, Trash2, CheckCircle, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useConfigOptions } from "@/hooks/useConfigOptions";
import { PageHeader } from "@/components/PageHeader";
import { BautagesberichtPhotos } from "@/components/BautagesberichtPhotos";
import { CustomerSelect } from "@/components/CustomerSelect";

const CHECKLISTE_ITEMS = [
  { key: "unterlagen_erhalten", label: "Unterlagen erhalten" },
  { key: "bestandsaufnahme", label: "Bestandsaufnahme" },
  { key: "fotos_gemacht", label: "Fotos gemacht" },
  { key: "masse_aufgenommen", label: "Masse aufgenommen" },
  { key: "anforderungen_geklaert", label: "Anforderungen geklaert" },
  { key: "termin_vereinbart", label: "Termin vereinbart" },
  { key: "angebot_besprochen", label: "Angebot besprochen" },
  { key: "naechste_schritte", label: "Naechste Schritte" },
];
const defaultCheckliste = () => Object.fromEntries(CHECKLISTE_ITEMS.map((i) => [i.key, false]));

const ErstterminInteressentDetail = () => {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "neu";
  const navigate = useNavigate();
  const { toast } = useToast();
  const { options: projektartOptions } = useConfigOptions("projektart");
  const { options: entscheidungsOptions } = useConfigOptions("entscheidungsstatus");
  const [customerId, setCustomerId] = useState("");
  const [datum, setDatum] = useState(new Date().toISOString().slice(0, 10));
  const [nummer, setNummer] = useState("");
  const [berater, setBerater] = useState("");
  const [projektname, setProjektname] = useState("");
  const [telefon, setTelefon] = useState("");
  const [email, setEmail] = useState("");
  const [standort, setStandort] = useState("");
  const [projektart, setProjektart] = useState("");
  const [umfang, setUmfang] = useState("");
  const [entscheidungsstatus, setEntscheidungsstatus] = useState("");
  const [zeitrahmen, setZeitrahmen] = useState("");
  const [budget, setBudget] = useState("");
  const [quelle, setQuelle] = useState("");
  const [prioritaeten, setPrioritaeten] = useState("");
  const [checkliste, setCheckliste] = useState<Record<string, boolean>>(defaultCheckliste());
  const [zufahrt, setZufahrt] = useState("");
  const [infrastruktur, setInfrastruktur] = useState("");
  const [materialien, setMaterialien] = useState("");
  const [sicherheit, setSicherheit] = useState("");
  const [hindernisse, setHindernisse] = useState("");
  const [entsorgung, setEntsorgung] = useState("");
  const [leistungsbeschreibung, setLeistungsbeschreibung] = useState("");
  const [firmenIntern, setFirmenIntern] = useState("");
  const [firmenExtern, setFirmenExtern] = useState("");
  const [aufmasse, setAufmasse] = useState("");
  const [status, setStatus] = useState("entwurf");
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(isNew ? null : id || null);

  useEffect(() => { init(); }, [id]);

  const init = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { navigate("/auth"); return; }
    if (!isNew && id) await fetchTermin(id);
    setLoading(false);
  };

  const fetchTermin = async (terminId: string) => {
    const { data, error } = await (supabase.from("ersttermin_interessent" as never) as any)
      .select("*").eq("id", terminId).single();
    if (error || !data) {
      toast({ variant: "destructive", title: "Fehler", description: "Termin nicht gefunden" });
      navigate("/ersttermine-interessent"); return;
    }
    const t = data as any;
    setCustomerId(t.customer_id || ""); setDatum(t.datum || ""); setNummer(t.nummer || "");
    setBerater(t.berater || ""); setProjektname(t.projektname || "");
    setTelefon(t.telefon || ""); setEmail(t.email || ""); setStandort(t.standort || "");
    setProjektart(t.projektart || ""); setUmfang(t.umfang || "");
    setEntscheidungsstatus(t.entscheidungsstatus || ""); setZeitrahmen(t.zeitrahmen || "");
    setBudget(t.budget || ""); setQuelle(t.quelle || ""); setPrioritaeten(t.prioritaeten || "");
    setCheckliste(t.checkliste || defaultCheckliste());
    setZufahrt(t.zufahrt_parkplatz || ""); setInfrastruktur(t.infrastruktur || "");
    setMaterialien(t.materialien || ""); setSicherheit(t.sicherheit || "");
    setHindernisse(t.hindernisse || ""); setEntsorgung(t.entsorgung || "");
    setLeistungsbeschreibung(t.leistungsbeschreibung || "");
    setFirmenIntern(t.firmen_intern || ""); setFirmenExtern(t.firmen_extern || "");
    setAufmasse(t.aufmasse || ""); setStatus(t.status || "entwurf"); setSavedId(terminId);
  };

  const handleSave = async () => {
    if (!customerId) {
      toast({ variant: "destructive", title: "Fehler", description: "Bitte Kunde waehlen" }); return;
    }
    setSaving(true);
    let terminNummer = nummer;
    if (!terminNummer) {
      const { data: nextNum } = await supabase.rpc("next_document_number" as never, { p_typ: "ersttermin" } as never);
      if (nextNum) terminNummer = String(nextNum);
    }
    const payload = {
      customer_id: customerId, datum, nummer: terminNummer,
      berater: berater || null, projektname: projektname || null,
      telefon: telefon || null, email: email || null, standort: standort || null,
      projektart: projektart || null, umfang: umfang || null,
      entscheidungsstatus: entscheidungsstatus || null, zeitrahmen: zeitrahmen || null,
      budget: budget || null, quelle: quelle || null, prioritaeten: prioritaeten || null,
      checkliste, zufahrt_parkplatz: zufahrt || null, infrastruktur: infrastruktur || null,
      materialien: materialien || null, sicherheit: sicherheit || null,
      hindernisse: hindernisse || null, entsorgung: entsorgung || null,
      leistungsbeschreibung: leistungsbeschreibung || null,
      firmen_intern: firmenIntern || null, firmen_extern: firmenExtern || null,
      aufmasse: aufmasse || null, status,
    };
    let terminId = savedId;
    if (savedId) {
      const { error } = await (supabase.from("ersttermin_interessent" as never) as any).update(payload).eq("id", savedId);
      if (error) { toast({ variant: "destructive", title: "Fehler", description: "Speichern fehlgeschlagen" }); setSaving(false); return; }
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: inserted, error } = await (supabase.from("ersttermin_interessent" as never) as any)
        .insert({ ...payload, erstellt_von: user?.id }).select("id").single();
      if (error || !inserted) { toast({ variant: "destructive", title: "Fehler", description: "Erstellen fehlgeschlagen" }); setSaving(false); return; }
      terminId = (inserted as any).id; setSavedId(terminId); setNummer(terminNummer);
    }
    toast({ title: "Gespeichert", description: "Ersttermin wurde gespeichert" });
    if (isNew && terminId) navigate(`/ersttermine-interessent/${terminId}`, { replace: true });
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!savedId) return;
    setDeleting(true);
    const { error } = await (supabase.from("ersttermin_interessent" as never) as any).delete().eq("id", savedId);
    if (error) { toast({ variant: "destructive", title: "Fehler", description: "Loeschen fehlgeschlagen" }); }
    else { toast({ title: "Geloescht", description: "Ersttermin wurde geloescht" }); navigate("/ersttermine-interessent"); }
    setDeleting(false);
  };

  const getStatusBadge = (s: string) => {
    switch (s) {
      case "entwurf": return <Badge variant="secondary">Entwurf</Badge>;
      case "abgeschlossen": return <Badge className="bg-blue-500 text-white">Abgeschlossen</Badge>;
      case "unterschrieben": return <Badge className="bg-green-500 text-white">Unterschrieben</Badge>;
      default: return <Badge variant="outline">{s}</Badge>;
    }
  };

  if (loading) {
    return (<div className="min-h-screen bg-background flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>);
  }

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title={isNew ? "Neuer Ersttermin" : `Ersttermin ${nummer || ""}`} backPath="/ersttermine-interessent" />
      <main className="container mx-auto px-4 py-6 max-w-4xl space-y-6">
        <div className="flex flex-wrap gap-2 justify-between items-center">
          <div className="flex items-center gap-2">
            {getStatusBadge(status)}
            {status === "entwurf" && (<Button variant="outline" size="sm" onClick={() => setStatus("abgeschlossen")}><CheckCircle className="h-4 w-4 mr-1" />Abschliessen</Button>)}
            {status === "abgeschlossen" && (<Button variant="outline" size="sm" onClick={() => setStatus("unterschrieben")}><PenLine className="h-4 w-4 mr-1" />Als unterschrieben markieren</Button>)}
          </div>
          <div className="flex gap-2">
            {savedId && (
              <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="destructive" size="sm" disabled={deleting}><Trash2 className="h-4 w-4 mr-1" />Loeschen</Button></AlertDialogTrigger>
                <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Ersttermin loeschen?</AlertDialogTitle><AlertDialogDescription>Dieser Ersttermin wird unwiderruflich geloescht.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Abbrechen</AlertDialogCancel><AlertDialogAction onClick={handleDelete}>Loeschen</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
              </AlertDialog>
            )}
            <Button onClick={handleSave} disabled={saving} className="gap-2"><Save className="h-4 w-4" />{saving ? "Speichert..." : "Speichern"}</Button>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle>Allgemeine Daten</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1"><Label>Kunde *</Label>
                <CustomerSelect
                  value={customerId}
                  onChange={(id, customer) => {
                    setCustomerId(id || "");
                    if (customer) {
                      if (customer.telefon) setTelefon(customer.telefon);
                      if (customer.email) setEmail(customer.email);
                      if (customer.adresse || customer.plz || customer.ort) {
                        setStandort([customer.adresse, customer.plz, customer.ort].filter(Boolean).join(", "));
                      }
                    }
                  }}
                  required
                /></div>
              <div className="space-y-1"><Label>Datum</Label><Input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} /></div>
              <div className="space-y-1"><Label>Nr.</Label><Input value={nummer} readOnly placeholder="Wird automatisch vergeben" className="bg-muted" /></div>
              <div className="space-y-1"><Label>Berater</Label><Input value={berater} onChange={(e) => setBerater(e.target.value)} placeholder="Name des Beraters" /></div>
              <div className="space-y-1"><Label>Projektname</Label><Input value={projektname} onChange={(e) => setProjektname(e.target.value)} placeholder="Projektname" /></div>
              <div className="space-y-1"><Label>Telefon</Label><Input value={telefon} onChange={(e) => setTelefon(e.target.value)} placeholder="Telefonnummer" /></div>
              <div className="space-y-1"><Label>E-Mail</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-Mail-Adresse" /></div>
              <div className="space-y-1"><Label>Standort</Label><Input value={standort} onChange={(e) => setStandort(e.target.value)} placeholder="Adresse / Standort" /></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Projekt & Bedarf</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1"><Label>Projektart</Label>
                <Select value={projektart} onValueChange={setProjektart}><SelectTrigger><SelectValue placeholder="Projektart waehlen" /></SelectTrigger><SelectContent>{projektartOptions.map((opt) => (<SelectItem key={opt.id} value={opt.wert}>{opt.label}</SelectItem>))}</SelectContent></Select></div>
              <div className="space-y-1"><Label>Umfang</Label><Input value={umfang} onChange={(e) => setUmfang(e.target.value)} placeholder="Projektumfang" /></div>
              <div className="space-y-1"><Label>Entscheidungsstatus</Label>
                <Select value={entscheidungsstatus} onValueChange={setEntscheidungsstatus}><SelectTrigger><SelectValue placeholder="Status waehlen" /></SelectTrigger><SelectContent>{entscheidungsOptions.map((opt) => (<SelectItem key={opt.id} value={opt.wert}>{opt.label}</SelectItem>))}</SelectContent></Select></div>
              <div className="space-y-1"><Label>Zeitrahmen</Label><Input value={zeitrahmen} onChange={(e) => setZeitrahmen(e.target.value)} placeholder="Gewuenschter Zeitrahmen" /></div>
              <div className="space-y-1"><Label>Budget</Label><Input value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Budget-Vorstellung" /></div>
              <div className="space-y-1"><Label>Quelle</Label><Input value={quelle} onChange={(e) => setQuelle(e.target.value)} placeholder="Wie auf uns aufmerksam?" /></div>
            </div>
            <div className="space-y-1"><Label>Prioritaeten</Label><Textarea rows={3} value={prioritaeten} onChange={(e) => setPrioritaeten(e.target.value)} placeholder="Prioritaeten des Kunden..." /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Checkliste</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {CHECKLISTE_ITEMS.map((item) => (
                <div key={item.key} className="flex items-center space-x-2">
                  <Checkbox id={item.key} checked={!!checkliste[item.key]} onCheckedChange={() => setCheckliste((prev) => ({ ...prev, [item.key]: !prev[item.key] }))} />
                  <Label htmlFor={item.key} className="cursor-pointer">{item.label}</Label>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Technische Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1"><Label>Zufahrt</Label><Textarea rows={2} value={zufahrt} onChange={(e) => setZufahrt(e.target.value)} placeholder="Zufahrtsmoeglichkeiten..." /></div>
              <div className="space-y-1"><Label>Infrastruktur</Label><Textarea rows={2} value={infrastruktur} onChange={(e) => setInfrastruktur(e.target.value)} placeholder="Vorhandene Infrastruktur..." /></div>
              <div className="space-y-1"><Label>Materialien</Label><Textarea rows={2} value={materialien} onChange={(e) => setMaterialien(e.target.value)} placeholder="Benoetigte Materialien..." /></div>
              <div className="space-y-1"><Label>Sicherheit</Label><Textarea rows={2} value={sicherheit} onChange={(e) => setSicherheit(e.target.value)} placeholder="Sicherheitshinweise..." /></div>
              <div className="space-y-1"><Label>Hindernisse</Label><Textarea rows={2} value={hindernisse} onChange={(e) => setHindernisse(e.target.value)} placeholder="Moegliche Hindernisse..." /></div>
              <div className="space-y-1"><Label>Entsorgung</Label><Textarea rows={2} value={entsorgung} onChange={(e) => setEntsorgung(e.target.value)} placeholder="Entsorgungsmoeglichkeiten..." /></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Angebotsvorbereitung</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1"><Label>Leistungsbeschreibung</Label><Textarea rows={4} value={leistungsbeschreibung} onChange={(e) => setLeistungsbeschreibung(e.target.value)} placeholder="Beschreibung der zu erbringenden Leistungen..." /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1"><Label>Firmen intern</Label><Textarea rows={3} value={firmenIntern} onChange={(e) => setFirmenIntern(e.target.value)} placeholder="Interne Ausfuehrung..." /></div>
              <div className="space-y-1"><Label>Firmen extern</Label><Textarea rows={3} value={firmenExtern} onChange={(e) => setFirmenExtern(e.target.value)} placeholder="Externe Subunternehmer..." /></div>
            </div>
            <div className="space-y-1"><Label>Aufmasse</Label><Textarea rows={3} value={aufmasse} onChange={(e) => setAufmasse(e.target.value)} placeholder="Aufmasse und Mengenermittlung..." /></div>
          </CardContent>
        </Card>

        {savedId && <BautagesberichtPhotos berichtId={savedId} />}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} className="gap-2"><Save className="h-4 w-4" />{saving ? "Speichert..." : "Speichern"}</Button>
        </div>
      </main>
    </div>
  );
};

export default ErstterminInteressentDetail;

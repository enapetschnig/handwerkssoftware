import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Save, Trash2, CheckCircle, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/PageHeader";
import { SignaturePad } from "@/components/SignaturePad";

type Project = { id: string; name: string; customer_id: string | null };
type Customer = { id: string; name: string };

const ErstterminProjektDetail = () => {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "neu";
  const navigate = useNavigate();
  const { toast } = useToast();
  const [projectId, setProjectId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [datum, setDatum] = useState(new Date().toISOString().slice(0, 10));
  const [nummer, setNummer] = useState("");
  const [bauleiter, setBauleiter] = useState("");
  const [beteiligte, setBeteiligte] = useState("");
  const [benoetigteMaterialien, setBenoetigteMaterialien] = useState("");
  const [stundenSchaetzung, setStundenSchaetzung] = useState<number | "">("");
  const [materialkosten, setMaterialkosten] = useState<number | "">("");
  const [fremdkosten, setFremdkosten] = useState<number | "">("");
  const [gesamtkosten, setGesamtkosten] = useState<number | "">("");
  const [freigabeIntern, setFreigabeIntern] = useState(false);
  const [freigabeKunde, setFreigabeKunde] = useState(false);
  const [freigabeBehoerde, setFreigabeBehoerde] = useState(false);
  const [freigabeBemerkung, setFreigabeBemerkung] = useState("");
  const [bekannteRisiken, setBekannteRisiken] = useState("");
  const [besondereAnforderungen, setBesondereAnforderungen] = useState("");
  const [freigabeDatum, setFreigabeDatum] = useState("");
  const [signaturFreigabe, setSignaturFreigabe] = useState<string | null>(null);
  const [status, setStatus] = useState("entwurf");
  const [projects, setProjects] = useState<Project[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(isNew ? null : id || null);

  useEffect(() => { init(); }, [id]);

  const init = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { navigate("/auth"); return; }
    const [projRes, custRes] = await Promise.all([
      supabase.from("projects").select("id, name, customer_id").order("name"),
      supabase.from("customers").select("id, name").order("name"),
    ]);
    if (projRes.data) setProjects(projRes.data as Project[]);
    if (custRes.data) setCustomers(custRes.data as Customer[]);
    if (!isNew && id) await fetchTermin(id);
    setLoading(false);
  };

  const handleProjectChange = (newProjectId: string) => {
    setProjectId(newProjectId);
    const project = projects.find((p) => p.id === newProjectId);
    if (project?.customer_id) {
      const customer = customers.find((c) => c.id === project.customer_id);
      setCustomerName(customer?.name || "");
    } else { setCustomerName(""); }
  };

  const fetchTermin = async (terminId: string) => {
    const { data, error } = await (supabase.from("ersttermin_projekt" as never) as any)
      .select("*").eq("id", terminId).single();
    if (error || !data) {
      toast({ variant: "destructive", title: "Fehler", description: "Termin nicht gefunden" });
      navigate("/ersttermine-projekt"); return;
    }
    const t = data as any;
    setProjectId(t.project_id || ""); setDatum(t.datum || ""); setNummer(t.nummer || "");
    setBauleiter(t.bauleiter || ""); setBeteiligte(t.beteiligte || "");
    setBenoetigteMaterialien(t.benoetigte_materialien || "");
    setStundenSchaetzung(t.stunden_schaetzung ?? ""); setMaterialkosten(t.materialkosten ?? "");
    setFremdkosten(t.fremdkosten ?? ""); setGesamtkosten(t.gesamtkosten ?? "");
    setFreigabeIntern(t.freigabe_intern || false); setFreigabeKunde(t.freigabe_kunde || false);
    setFreigabeBehoerde(t.freigabe_behoerde || false); setFreigabeBemerkung(t.freigabe_bemerkung || "");
    setBekannteRisiken(t.bekannte_risiken || ""); setBesondereAnforderungen(t.besondere_anforderungen || "");
    setFreigabeDatum(t.freigabe_datum || ""); setSignaturFreigabe(t.freigabe_unterschrift || null);
    setStatus(t.status || "entwurf"); setSavedId(terminId);
    if (t.project_id) {
      const proj = projects.find((p) => p.id === t.project_id);
      if (proj?.customer_id) { const c = customers.find((c) => c.id === proj.customer_id); if (c) setCustomerName(c.name); }
    }
  };

  const handleSave = async () => {
    if (!projectId) { toast({ variant: "destructive", title: "Fehler", description: "Bitte Projekt waehlen" }); return; }
    setSaving(true);
    let terminNummer = nummer;
    if (!terminNummer) {
      const { data: nextNum } = await supabase.rpc("next_document_number" as never, { p_typ: "ersttermin" } as never);
      if (nextNum) terminNummer = String(nextNum);
    }
    const payload = {
      project_id: projectId, datum, nummer: terminNummer,
      bauleiter: bauleiter || null, beteiligte: beteiligte || null,
      benoetigte_materialien: benoetigteMaterialien || null,
      stunden_schaetzung: stundenSchaetzung === "" ? null : stundenSchaetzung,
      materialkosten: materialkosten === "" ? null : materialkosten,
      fremdkosten: fremdkosten === "" ? null : fremdkosten,
      gesamtkosten: gesamtkosten === "" ? null : gesamtkosten,
      freigabe_intern: freigabeIntern, freigabe_kunde: freigabeKunde, freigabe_behoerde: freigabeBehoerde,
      freigabe_bemerkung: freigabeBemerkung || null,
      bekannte_risiken: bekannteRisiken || null, besondere_anforderungen: besondereAnforderungen || null,
      freigabe_datum: freigabeDatum || null, freigabe_unterschrift: signaturFreigabe, status,
    };
    let terminId = savedId;
    if (savedId) {
      const { error } = await (supabase.from("ersttermin_projekt" as never) as any).update(payload).eq("id", savedId);
      if (error) { toast({ variant: "destructive", title: "Fehler", description: "Speichern fehlgeschlagen" }); setSaving(false); return; }
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: inserted, error } = await (supabase.from("ersttermin_projekt" as never) as any)
        .insert({ ...payload, erstellt_von: user?.id }).select("id").single();
      if (error || !inserted) { toast({ variant: "destructive", title: "Fehler", description: "Erstellen fehlgeschlagen" }); setSaving(false); return; }
      terminId = (inserted as any).id; setSavedId(terminId); setNummer(terminNummer);
    }
    toast({ title: "Gespeichert", description: "Ersttermin wurde gespeichert" });
    if (isNew && terminId) navigate(`/ersttermine-projekt/${terminId}`, { replace: true });
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!savedId) return;
    setDeleting(true);
    const { error } = await (supabase.from("ersttermin_projekt" as never) as any).delete().eq("id", savedId);
    if (error) { toast({ variant: "destructive", title: "Fehler", description: "Loeschen fehlgeschlagen" }); }
    else { toast({ title: "Geloescht", description: "Ersttermin wurde geloescht" }); navigate("/ersttermine-projekt"); }
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
      <PageHeader title={isNew ? "Neuer Projekt-Ersttermin" : `Ersttermin ${nummer || ""}`} backPath="/ersttermine-projekt" />
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
          <CardHeader><CardTitle>Projektdaten</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1"><Label>Projekt *</Label>
                <Select value={projectId} onValueChange={handleProjectChange}><SelectTrigger><SelectValue placeholder="Projekt waehlen" /></SelectTrigger><SelectContent>{projects.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}</SelectContent></Select></div>
              <div className="space-y-1"><Label>Kunde</Label><Input value={customerName} readOnly placeholder="Wird automatisch befuellt" className="bg-muted" /></div>
              <div className="space-y-1"><Label>Datum</Label><Input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} /></div>
              <div className="space-y-1"><Label>Nr.</Label><Input value={nummer} readOnly placeholder="Wird automatisch vergeben" className="bg-muted" /></div>
              <div className="space-y-1"><Label>Bauleiter</Label><Input value={bauleiter} onChange={(e) => setBauleiter(e.target.value)} placeholder="Name des Bauleiters" /></div>
              <div className="space-y-1"><Label>Beteiligte</Label><Input value={beteiligte} onChange={(e) => setBeteiligte(e.target.value)} placeholder="Weitere Beteiligte" /></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Ressourcen & Kosten</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1"><Label>Benoetigte Materialien</Label><Textarea rows={4} value={benoetigteMaterialien} onChange={(e) => setBenoetigteMaterialien(e.target.value)} placeholder="Auflistung der benoetigten Materialien..." /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1"><Label>Stunden-Schaetzung</Label><Input type="number" min="0" value={stundenSchaetzung} onChange={(e) => setStundenSchaetzung(e.target.value === "" ? "" : Number(e.target.value))} placeholder="Geschaetzte Stunden" /></div>
              <div className="space-y-1"><Label>Materialkosten</Label><Input type="number" min="0" step="0.01" value={materialkosten} onChange={(e) => setMaterialkosten(e.target.value === "" ? "" : Number(e.target.value))} placeholder="0.00" /></div>
              <div className="space-y-1"><Label>Fremdkosten</Label><Input type="number" min="0" step="0.01" value={fremdkosten} onChange={(e) => setFremdkosten(e.target.value === "" ? "" : Number(e.target.value))} placeholder="0.00" /></div>
              <div className="space-y-1"><Label>Gesamtkosten</Label><Input type="number" min="0" step="0.01" value={gesamtkosten} onChange={(e) => setGesamtkosten(e.target.value === "" ? "" : Number(e.target.value))} placeholder="0.00" /></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Freigaben</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-center space-x-2"><Checkbox id="freigabe_intern" checked={freigabeIntern} onCheckedChange={(v) => setFreigabeIntern(!!v)} /><Label htmlFor="freigabe_intern" className="cursor-pointer">Freigabe Intern</Label></div>
              <div className="flex items-center space-x-2"><Checkbox id="freigabe_kunde" checked={freigabeKunde} onCheckedChange={(v) => setFreigabeKunde(!!v)} /><Label htmlFor="freigabe_kunde" className="cursor-pointer">Freigabe Kunde</Label></div>
              <div className="flex items-center space-x-2"><Checkbox id="freigabe_behoerde" checked={freigabeBehoerde} onCheckedChange={(v) => setFreigabeBehoerde(!!v)} /><Label htmlFor="freigabe_behoerde" className="cursor-pointer">Freigabe Behoerde</Label></div>
            </div>
            <div className="space-y-1"><Label>Bemerkung</Label><Textarea rows={3} value={freigabeBemerkung} onChange={(e) => setFreigabeBemerkung(e.target.value)} placeholder="Bemerkungen zu Freigaben..." /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Risiken</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1"><Label>Bekannte Risiken</Label><Textarea rows={3} value={bekannteRisiken} onChange={(e) => setBekannteRisiken(e.target.value)} placeholder="Bekannte Risiken und Gefahren..." /></div>
            <div className="space-y-1"><Label>Besondere Anforderungen</Label><Textarea rows={3} value={besondereAnforderungen} onChange={(e) => setBesondereAnforderungen(e.target.value)} placeholder="Besondere Anforderungen an das Projekt..." /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Projektfreigabe</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1"><Label>Freigabe-Datum</Label><Input type="date" value={freigabeDatum} onChange={(e) => setFreigabeDatum(e.target.value)} /></div>
            <Separator />
            <div>
              <Label className="mb-2 block">Unterschrift Freigabe</Label>
              {signaturFreigabe ? (
                <div className="space-y-2">
                  <img src={signaturFreigabe} alt="Unterschrift Freigabe" className="border rounded-lg max-h-32" />
                  <Button variant="outline" size="sm" onClick={() => setSignaturFreigabe(null)}>Neu unterschreiben</Button>
                </div>
              ) : (<SignaturePad onSignatureChange={setSignaturFreigabe} />)}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} className="gap-2"><Save className="h-4 w-4" />{saving ? "Speichert..." : "Speichern"}</Button>
        </div>
      </main>
    </div>
  );
};

export default ErstterminProjektDetail;

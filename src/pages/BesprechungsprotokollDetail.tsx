import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/DictateButton";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useConfigOptions } from "@/hooks/useConfigOptions";
import { PageHeader } from "@/components/PageHeader";
import { ProtokollMassnahmen, type Massnahme } from "@/components/ProtokollMassnahmen";
import { CustomerSelect } from "@/components/CustomerSelect";

type Project = { id: string; name: string; customer_id: string | null };

const BesprechungsprotokollDetail = () => {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "neu";
  const navigate = useNavigate();
  const { toast } = useToast();
  const { options: typOptions } = useConfigOptions("besprechungstyp");

  // Form state
  const [typ, setTyp] = useState("");
  const [datum, setDatum] = useState(new Date().toISOString().slice(0, 10));
  const [zeitVon, setZeitVon] = useState("09:00");
  const [zeitBis, setZeitBis] = useState("10:00");
  const [ort, setOrt] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [protokollant, setProtokollant] = useState("");
  const [nummer, setNummer] = useState("");
  const [status, setStatus] = useState("entwurf");

  // Content
  const [teilnehmer, setTeilnehmer] = useState("");
  const [inhalt, setInhalt] = useState("");
  const [vereinbarungen, setVereinbarungen] = useState("");
  const [offeneFragen, setOffeneFragen] = useState("");

  // Massnahmen
  const [massnahmen, setMassnahmen] = useState<Massnahme[]>([]);

  // Reference data
  const [projects, setProjects] = useState<Project[]>([]);

  // UI state
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(isNew ? null : id || null);

  useEffect(() => { init(); }, [id]);

  const init = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { navigate("/auth"); return; }

    const { data: projData } = await supabase.from("projects").select("id, name, customer_id").order("name");
    if (projData) setProjects(projData as Project[]);

    if (!isNew && id) await fetchProtokoll(id);
    setLoading(false);
  };

  const fetchProtokoll = async (protokollId: string) => {
    const { data, error } = await (supabase.from("besprechungsprotokolle" as never) as any)
      .select("*").eq("id", protokollId).single();

    if (error || !data) {
      toast({ variant: "destructive", title: "Fehler", description: "Protokoll nicht gefunden" });
      navigate("/besprechungsprotokolle");
      return;
    }

    const p = data as any;
    setTyp(p.typ || "");
    setDatum(p.datum || "");
    setZeitVon(p.zeit_von || "09:00");
    setZeitBis(p.zeit_bis || "10:00");
    setOrt(p.ort || "");
    setCustomerId(p.customer_id || "");
    setProjectId(p.project_id || "");
    setProtokollant(p.protokollant || "");
    setNummer(p.nummer || "");
    setStatus(p.status || "entwurf");
    setTeilnehmer(p.teilnehmer || "");
    setInhalt(p.inhalt || "");
    setVereinbarungen(p.vereinbarungen || "");
    setOffeneFragen(p.offene_fragen || "");
    setSavedId(protokollId);

    // Load massnahmen
    const { data: mData } = await (supabase.from("besprechungsprotokoll_massnahmen" as never) as any)
      .select("*").eq("protokoll_id", protokollId).order("created_at");

    if (mData) {
      setMassnahmen((mData as any[]).map((m) => ({
        id: m.id,
        aufgabe: m.aufgabe || "",
        verantwortlich: m.verantwortlich || "",
        frist: m.frist || "",
        erledigt: m.erledigt || false,
      })));
    }
  };

  const handleSave = async () => {
    setSaving(true);

    let protokollNummer = nummer;
    if (!protokollNummer) {
      const { data: nextNum } = await supabase.rpc("next_document_number" as never, {
        p_typ: "besprechungsprotokoll",
      } as never);
      if (nextNum) protokollNummer = String(nextNum);
    }

    const payload = {
      typ: typ || "persoenlich",
      datum: datum || new Date().toISOString().split("T")[0],
      zeit_von: zeitVon || null,
      zeit_bis: zeitBis || null,
      ort: ort || null,
      customer_id: customerId || null,
      project_id: projectId || null,
      protokollant: protokollant || null,
      nummer: protokollNummer || null,
      status: "abgeschlossen",
      teilnehmer: teilnehmer || null,
      inhalt: inhalt || null,
      vereinbarungen: vereinbarungen || null,
      offene_fragen: offeneFragen || null,
    };

    let protokollId = savedId;

    if (savedId) {
      const { error } = await (supabase.from("besprechungsprotokolle" as never) as any)
        .update(payload).eq("id", savedId);
      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: "Speichern fehlgeschlagen" });
        setSaving(false);
        return;
      }
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: inserted, error } = await (supabase.from("besprechungsprotokolle" as never) as any)
        .insert({ ...payload, erstellt_von: user?.id }).select("id").single();
      if (error || !inserted) {
        console.error("Insert error:", error);
        toast({ variant: "destructive", title: "Fehler", description: error?.message || "Erstellen fehlgeschlagen" });
        setSaving(false);
        return;
      }
      protokollId = (inserted as any).id;
      setSavedId(protokollId);
      setNummer(protokollNummer);
    }

    // Save massnahmen: delete + reinsert
    if (protokollId) {
      await (supabase.from("besprechungsprotokoll_massnahmen" as never) as any)
        .delete().eq("protokoll_id", protokollId);

      const rows = massnahmen.filter((m) => m.aufgabe).map((m) => ({
        protokoll_id: protokollId,
        aufgabe: m.aufgabe,
        verantwortlich: m.verantwortlich || null,
        frist: m.frist || null,
        erledigt: m.erledigt,
      }));

      if (rows.length > 0) {
        await (supabase.from("besprechungsprotokoll_massnahmen" as never) as any).insert(rows);
      }
    }

    toast({ title: "Gespeichert", description: "Protokoll wurde gespeichert" });
    if (isNew && protokollId) navigate(`/besprechungsprotokolle/${protokollId}`, { replace: true });
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!savedId) return;
    await (supabase.from("besprechungsprotokoll_massnahmen" as never) as any).delete().eq("protokoll_id", savedId);
    const { error } = await (supabase.from("besprechungsprotokolle" as never) as any).delete().eq("id", savedId);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Löschen fehlgeschlagen" });
      return;
    }
    toast({ title: "Gelöscht" });
    navigate("/besprechungsprotokolle");
  };

  const filteredProjects = customerId
    ? projects.filter((p) => p.customer_id === customerId)
    : projects;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title={isNew ? "Neues Protokoll" : `Protokoll ${nummer || ""}`} />
      <main className="container mx-auto px-4 py-6 max-w-4xl space-y-6">
        {/* Action bar */}
        <div className="flex justify-end items-center">
          <div className="flex gap-2">
            {savedId && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm"><Trash2 className="h-4 w-4" /></Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Protokoll löschen?</AlertDialogTitle>
                    <AlertDialogDescription>Diese Aktion kann nicht rückgängig gemacht werden.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete}>Löschen</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              <Save className="h-4 w-4" />
              {saving ? "Speichert..." : "Speichern"}
            </Button>
          </div>
        </div>

        {/* Besprechungsdaten */}
        <Card>
          <CardHeader><CardTitle className="text-base">Besprechungsdaten</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Typ</Label>
                <Select value={typ} onValueChange={setTyp}>
                  <SelectTrigger><SelectValue placeholder="Typ wählen..." /></SelectTrigger>
                  <SelectContent>
                    {typOptions.map((o) => (
                      <SelectItem key={o.wert} value={o.wert}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Datum</Label>
                <Input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} />
              </div>
              <div>
                <Label>Zeit von</Label>
                <Input type="time" value={zeitVon} onChange={(e) => setZeitVon(e.target.value)} />
              </div>
              <div>
                <Label>Zeit bis</Label>
                <Input type="time" value={zeitBis} onChange={(e) => setZeitBis(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label>Ort</Label>
                <Input value={ort} onChange={(e) => setOrt(e.target.value)} placeholder="Besprechungsort" />
              </div>
              <div>
                <Label>Kunde</Label>
                <CustomerSelect
                  value={customerId}
                  onChange={(id) => { setCustomerId(id || ""); setProjectId(""); }}
                />
              </div>
              <div>
                <Label>Projekt</Label>
                <Select
                  value={projectId}
                  onValueChange={(id) => {
                    setProjectId(id);
                    // Auto-Fill: Kunde aus Projekt setzen, wenn Kunde noch leer ist
                    if (id && !customerId) {
                      const p = projects.find((x) => x.id === id);
                      if (p?.customer_id) setCustomerId(p.customer_id);
                    }
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Projekt wählen..." /></SelectTrigger>
                  <SelectContent>
                    {filteredProjects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label>Protokollant</Label>
                <Input value={protokollant} onChange={(e) => setProtokollant(e.target.value)} placeholder="Name des Protokollanten" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Teilnehmer */}
        <Card>
          <CardHeader><CardTitle className="text-base">Teilnehmer</CardTitle></CardHeader>
          <CardContent>
            <Textarea
              value={teilnehmer}
              onChange={(e) => setTeilnehmer(e.target.value)}
              rows={4}
              placeholder="Ein Name pro Zeile"
            />
          </CardContent>
        </Card>

        {/* Inhalt & Vereinbarungen */}
        <Card>
          <CardHeader><CardTitle className="text-base">Inhalt &amp; Vereinbarungen</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <Label>Inhalt</Label>
                <DictateButton value={inhalt} onResult={setInhalt} />
              </div>
              <Textarea
                value={inhalt}
                onChange={(e) => setInhalt(e.target.value)}
                rows={8}
                placeholder="Besprochene Themen und Inhalte..."
              />
            </div>
            <Separator />
            <div>
              <div className="flex items-center justify-between">
                <Label>Vereinbarungen</Label>
                <DictateButton value={vereinbarungen} onResult={setVereinbarungen} />
              </div>
              <Textarea
                value={vereinbarungen}
                onChange={(e) => setVereinbarungen(e.target.value)}
                rows={4}
                placeholder="Getroffene Vereinbarungen..."
              />
            </div>
            <Separator />
            <div>
              <div className="flex items-center justify-between">
                <Label>Offene Fragen</Label>
                <DictateButton value={offeneFragen} onResult={setOffeneFragen} />
              </div>
              <Textarea
                value={offeneFragen}
                onChange={(e) => setOffeneFragen(e.target.value)}
                rows={4}
                placeholder="Noch offene Punkte und Fragen..."
              />
            </div>
          </CardContent>
        </Card>

        {/* Massnahmen */}
        <ProtokollMassnahmen massnahmen={massnahmen} onChange={setMassnahmen} />
      </main>
    </div>
  );
};

export default BesprechungsprotokollDetail;

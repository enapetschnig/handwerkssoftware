import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Save, Trash2, CheckCircle, PenLine } from "lucide-react";
import { DictateButton } from "@/components/DictateButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useConfigOptions } from "@/hooks/useConfigOptions";
import { PageHeader } from "@/components/PageHeader";
import { SignaturePad } from "@/components/SignaturePad";
import { BautagesberichtWorkers, type Worker, type Employee } from "@/components/BautagesberichtWorkers";
import { BautagesberichtPhotos } from "@/components/BautagesberichtPhotos";

type Project = { id: string; name: string; customer_id: string | null };

const BautagesberichtDetail = () => {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "neu";
  const navigate = useNavigate();
  const { toast } = useToast();
  const { options: wetterOptions } = useConfigOptions("wetter");

  // Form state
  const [projectId, setProjectId] = useState("");
  const [datum, setDatum] = useState(new Date().toISOString().slice(0, 10));
  const [nummer, setNummer] = useState("");
  const [bauleiter, setBauleiter] = useState("");
  const [wetter, setWetter] = useState("");
  const [tempMin, setTempMin] = useState<number | "">("");
  const [tempMax, setTempMax] = useState<number | "">("");
  const [arbeitszeitVon, setArbeitszeitVon] = useState("07:00");
  const [arbeitszeitBis, setArbeitszeitBis] = useState("16:00");
  const [pause, setPause] = useState<number | "">(30);
  const [ausgefuehrteArbeiten, setAusgefuehrteArbeiten] = useState("");
  const [besondereVorkommnisse, setBesondereVorkommnisse] = useState("");
  const [status, setStatus] = useState("entwurf");
  const [signaturBauleiter, setSignaturBauleiter] = useState<string | null>(null);
  const [signaturKunde, setSignaturKunde] = useState<string | null>(null);

  // Workers
  const [workers, setWorkers] = useState<Worker[]>([]);

  // Reference data
  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  // UI state
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Warnung bei Navigation mit ungespeicherten Änderungen
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Ungespeicherte Änderungen gehen verloren.";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [skipSignBauleiter, setSkipSignBauleiter] = useState(false);
  const [skipSignKunde, setSkipSignKunde] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(isNew ? null : id || null);

  useEffect(() => {
    init();
  }, [id]);

  // Dirty-Flag: nach Initial-Load jede Feld-Änderung markiert das Formular als "geändert"
  useEffect(() => {
    if (loading) return;
    setHasUnsavedChanges(true);
  }, [projectId, datum]); // Reference-Werte, die User aktiv ändert

  const init = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { navigate("/auth"); return; }

    // Fetch projects and employees in parallel
    const [projRes, empRes] = await Promise.all([
      supabase.from("projects").select("id, name, customer_id").not("status", "eq", "Abgeschlossen").order("name"),
      (supabase.from("employees" as never) as any).select("id, vorname, nachname, user_id").order("nachname"),
    ]);

    if (projRes.data) setProjects(projRes.data as Project[]);
    const loadedEmployees = (empRes.data || []) as (Employee & { user_id?: string })[];
    setEmployees(loadedEmployees);

    if (!isNew && id) {
      await fetchBericht(id);
    } else if (isNew && loadedEmployees.length > 0) {
      // Pre-select the current user as first worker
      const currentEmployee = loadedEmployees.find((e: any) => e.user_id === session.user.id);
      if (currentEmployee) {
        setWorkers([{
          id: crypto.randomUUID(),
          employee_id: currentEmployee.id,
          stunden: 0,
          taetigkeit: "",
        }]);
      }
    }
    setLoading(false);
  };

  const fetchBericht = async (berichtId: string) => {
    const { data, error } = await (supabase.from("bautagesberichte" as never) as any)
      .select("*")
      .eq("id", berichtId)
      .single();

    if (error || !data) {
      toast({ variant: "destructive", title: "Fehler", description: "Bericht nicht gefunden" });
      navigate("/bautagesberichte");
      return;
    }

    const b = data as any;
    setProjectId(b.project_id || "");
    setDatum(b.datum || "");
    setNummer(b.nummer || "");
    setBauleiter(b.bauleiter || "");
    setWetter(b.wetter || "");
    setTempMin(b.temperatur_min ?? "");
    setTempMax(b.temperatur_max ?? "");
    setArbeitszeitVon(b.arbeitszeit_von || "07:00");
    setArbeitszeitBis(b.arbeitszeit_bis || "16:00");
    setPause(b.pause_minuten ?? 30);
    setAusgefuehrteArbeiten(b.ausgefuehrte_arbeiten || "");
    setBesondereVorkommnisse(b.besondere_vorkommnisse || "");
    setStatus(b.status || "entwurf");
    setSignaturBauleiter(b.unterschrift_bauleiter || null);
    setSignaturKunde(b.unterschrift_kunde || null);
    setSavedId(berichtId);

    // Fetch workers
    const { data: workersData } = await (supabase.from("bautagesbericht_workers" as never) as any)
      .select("*")
      .eq("bautagesbericht_id", berichtId);

    if (workersData) {
      setWorkers(
        (workersData as any[]).map((w) => ({
          id: w.id,
          employee_id: w.employee_id || "",
          stunden: w.stunden || 0,
          taetigkeit: w.taetigkeit || "",
        }))
      );
    }
  };

  const handleSave = async () => {
    if (saving) return; // Doppelklick-Schutz
    if (!projectId) {
      toast({ variant: "destructive", title: "Projekt fehlt", description: "Bitte wählen Sie ein Projekt aus (Pflichtfeld)." });
      // Scroll zu Projekt-Feld + Highlight
      const el = document.getElementById("btb-project-field");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-destructive", "rounded");
        setTimeout(() => el.classList.remove("ring-2", "ring-destructive", "rounded"), 3000);
      }
      return;
    }

    setSaving(true);

    let berichtNummer = nummer;
    // Get next number on first save
    if (!berichtNummer) {
      const { data: nextNum } = await supabase.rpc("next_document_number" as never, {
        p_typ: "bautagesbericht",
      } as never);
      if (nextNum) berichtNummer = String(nextNum);
    }

    const payload = {
      project_id: projectId,
      datum,
      nummer: berichtNummer,
      bauleiter,
      wetter: wetter || null,
      temperatur_min: tempMin === "" ? null : tempMin,
      temperatur_max: tempMax === "" ? null : tempMax,
      arbeitszeit_von: arbeitszeitVon,
      arbeitszeit_bis: arbeitszeitBis,
      pause_minuten: pause === "" ? null : pause,
      ausgefuehrte_arbeiten: ausgefuehrteArbeiten,
      besondere_vorkommnisse: besondereVorkommnisse,
      status,
      unterschrift_bauleiter: signaturBauleiter,
      unterschrift_kunde: signaturKunde,
    };

    let berichtId = savedId;

    if (savedId) {
      // Update
      const { error } = await (supabase.from("bautagesberichte" as never) as any)
        .update(payload)
        .eq("id", savedId);

      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: "Speichern fehlgeschlagen" });
        setSaving(false);
        return;
      }
    } else {
      // Insert
      const { data: { user } } = await supabase.auth.getUser();
      const { data: inserted, error } = await (supabase.from("bautagesberichte" as never) as any)
        .insert({ ...payload, erstellt_von: user?.id })
        .select("id")
        .single();

      if (error || !inserted) {
        toast({ variant: "destructive", title: "Fehler", description: "Erstellen fehlgeschlagen" });
        setSaving(false);
        return;
      }

      berichtId = (inserted as any).id;
      setSavedId(berichtId);
      setNummer(berichtNummer);
    }

    // Save workers: delete all then re-insert
    if (berichtId) {
      await (supabase.from("bautagesbericht_workers" as never) as any)
        .delete()
        .eq("bautagesbericht_id", berichtId);

      const workerRows = workers
        .filter((w) => w.employee_id)
        .map((w) => ({
          bautagesbericht_id: berichtId,
          employee_id: w.employee_id,
          stunden: w.stunden,
          taetigkeit: w.taetigkeit,
        }));

      if (workerRows.length > 0) {
        await (supabase.from("bautagesbericht_workers" as never) as any).insert(workerRows);
      }
    }

    setHasUnsavedChanges(false);
    toast({ title: "Gespeichert", description: "Bautagesbericht wurde gespeichert" });

    // Navigate to detail view if was new
    if (isNew && berichtId) {
      navigate(`/bautagesberichte/${berichtId}`, { replace: true });
    }

    setSaving(false);

    // Open signature dialog after save (only if not already finalized)
    if (status === "entwurf") {
      setSignDialogOpen(true);
    }
  };

  const handleDelete = async () => {
    if (!savedId) return;
    setDeleting(true);

    // Delete workers first
    await (supabase.from("bautagesbericht_workers" as never) as any)
      .delete()
      .eq("bautagesbericht_id", savedId);

    const { error } = await (supabase.from("bautagesberichte" as never) as any)
      .delete()
      .eq("id", savedId);

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Löschen fehlgeschlagen" });
    } else {
      toast({ title: "Gelöscht", description: "Bericht wurde gelöscht" });
      navigate("/bautagesberichte");
    }
    setDeleting(false);
  };

  const handleStatusChange = (newStatus: string) => {
    setStatus(newStatus);
  };

  const handleFinalize = async () => {
    if (!savedId) return;
    setSaving(true);

    const finalPayload: any = {
      status: "abgeschlossen",
      unterschrift_bauleiter: skipSignBauleiter ? null : signaturBauleiter,
      unterschrift_kunde: skipSignKunde ? null : signaturKunde,
    };

    // Set unterschrift_am if at least one signature exists
    if (signaturBauleiter || signaturKunde) {
      finalPayload.unterschrift_am = new Date().toISOString();
    }

    const { error } = await (supabase.from("bautagesberichte" as never) as any)
      .update(finalPayload)
      .eq("id", savedId);

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Abschließen fehlgeschlagen" });
    } else {
      setStatus("abgeschlossen");
      setSignDialogOpen(false);
      toast({ title: "Abgeschlossen", description: "Bautagesbericht wurde erfolgreich abgeschlossen" });
    }
    setSaving(false);
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
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title={isNew ? "Neuer Bautagesbericht" : `Bericht ${nummer || ""}`} backPath="/bautagesberichte" />

      <main className="container mx-auto px-4 py-6 max-w-4xl space-y-6">
        {/* Status & Actions */}
        <div className="flex flex-wrap gap-2 justify-between items-center">
          <div className="flex items-center gap-2">
            {getStatusBadge(status)}
            {status === "entwurf" && savedId && (
              <Button variant="outline" size="sm" onClick={() => setSignDialogOpen(true)}>
                <PenLine className="h-4 w-4 mr-1" />
                Unterschreiben & Abschließen
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {savedId && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={deleting}>
                    <Trash2 className="h-4 w-4 mr-1" />
                    Löschen
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Bericht löschen?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Dieser Bericht wird unwiderruflich gelöscht.
                    </AlertDialogDescription>
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

        {/* Main form */}
        <Card>
          <CardHeader>
            <CardTitle>Allgemeine Daten</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Projekt */}
              <div className="space-y-1" id="btb-project-field">
                <Label>Projekt *</Label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Projekt wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Datum */}
              <div className="space-y-1">
                <Label>Datum</Label>
                <Input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} />
              </div>

              {/* Bericht-Nr */}
              <div className="space-y-1">
                <Label>Bericht-Nr.</Label>
                <Input value={nummer} readOnly placeholder="Wird automatisch vergeben" className="bg-muted" />
              </div>

              {/* Bauleiter */}
              <div className="space-y-1">
                <Label>Bauleiter</Label>
                <Input value={bauleiter} onChange={(e) => setBauleiter(e.target.value)} placeholder="Name des Bauleiters" />
              </div>

              {/* Wetter */}
              <div className="space-y-1">
                <Label>Wetter</Label>
                <Select value={wetter} onValueChange={setWetter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Wetter wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {wetterOptions.map((opt) => (
                      <SelectItem key={opt.id} value={opt.wert}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Temperatur */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Temp. Min (C)</Label>
                  <Input
                    type="number"
                    value={tempMin}
                    onChange={(e) => setTempMin(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="-5"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Temp. Max (C)</Label>
                  <Input
                    type="number"
                    value={tempMax}
                    onChange={(e) => setTempMax(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="15"
                  />
                </div>
              </div>

              {/* Arbeitszeit */}
              <div className="space-y-1">
                <Label>Arbeitszeit von</Label>
                <Input type="time" value={arbeitszeitVon} onChange={(e) => setArbeitszeitVon(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Arbeitszeit bis</Label>
                <Input type="time" value={arbeitszeitBis} onChange={(e) => setArbeitszeitBis(e.target.value)} />
              </div>

              {/* Pause */}
              <div className="space-y-1">
                <Label>Pause (Minuten)</Label>
                <Input
                  type="number"
                  min="0"
                  value={pause}
                  onChange={(e) => setPause(e.target.value === "" ? "" : Number(e.target.value))}
                  placeholder="30"
                />
              </div>
            </div>

            <Separator />

            {/* Ausgefuehrte Arbeiten */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label>Ausgefuehrte Arbeiten</Label>
                <DictateButton value={ausgefuehrteArbeiten} onResult={setAusgefuehrteArbeiten} />
              </div>
              <Textarea
                rows={4}
                value={ausgefuehrteArbeiten}
                onChange={(e) => setAusgefuehrteArbeiten(e.target.value)}
                placeholder="Beschreibung der ausgefuehrten Arbeiten..."
              />
            </div>

            {/* Besondere Vorkommnisse */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label>Besondere Vorkommnisse</Label>
                <DictateButton value={besondereVorkommnisse} onResult={setBesondereVorkommnisse} />
              </div>
              <Textarea
                rows={3}
                value={besondereVorkommnisse}
                onChange={(e) => setBesondereVorkommnisse(e.target.value)}
                placeholder="Besondere Vorkommnisse, Stoerungen, Verzoegerungen..."
              />
            </div>
          </CardContent>
        </Card>

        {/* Workers */}
        <BautagesberichtWorkers workers={workers} onChange={setWorkers} employees={employees} />

        {/* Photos - only after first save */}
        {savedId && <BautagesberichtPhotos berichtId={savedId} />}

        {/* Signatures summary (read-only, shown only if already signed) */}
        {savedId && (signaturBauleiter || signaturKunde) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Unterschriften</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-6">
              {signaturBauleiter && (
                <div>
                  <Label className="text-xs text-muted-foreground">Bauleiter</Label>
                  <img src={signaturBauleiter} alt="Unterschrift Bauleiter" className="border rounded-lg max-h-20 mt-1" />
                </div>
              )}
              {signaturKunde && (
                <div>
                  <Label className="text-xs text-muted-foreground">Kunde</Label>
                  <img src={signaturKunde} alt="Unterschrift Kunde" className="border rounded-lg max-h-20 mt-1" />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Bottom actions */}
        <div className="flex justify-end gap-2">
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            <Save className="h-4 w-4" />
            {saving ? "Speichert..." : "Speichern"}
          </Button>
        </div>

        {/* Signature & Finalize Dialog - opens after save */}
        <Dialog open={signDialogOpen} onOpenChange={setSignDialogOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Unterschriften & Abschluss</DialogTitle>
            </DialogHeader>

            <div className="space-y-6 py-2">
              {/* Bauleiter Signature */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="font-medium">Unterschrift Bauleiter</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => { setSignaturBauleiter(null); setSkipSignBauleiter(prev => !prev); }}
                  >
                    {skipSignBauleiter ? "Unterschrift hinzufügen" : "Keine Unterschrift erforderlich"}
                  </Button>
                </div>
                {skipSignBauleiter ? (
                  <div className="border rounded-lg p-3 bg-muted/50 text-sm text-muted-foreground text-center">
                    Keine Unterschrift erforderlich
                  </div>
                ) : signaturBauleiter ? (
                  <div className="space-y-2">
                    <img src={signaturBauleiter} alt="Unterschrift Bauleiter" className="border rounded-lg max-h-32" />
                    <Button variant="outline" size="sm" onClick={() => setSignaturBauleiter(null)}>
                      Neu unterschreiben
                    </Button>
                  </div>
                ) : (
                  <SignaturePad onSignatureChange={setSignaturBauleiter} />
                )}
              </div>

              <Separator />

              {/* Kunde Signature */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="font-medium">Unterschrift Kunde / Auftraggeber</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => { setSignaturKunde(null); setSkipSignKunde(prev => !prev); }}
                  >
                    {skipSignKunde ? "Unterschrift hinzufügen" : "Keine Unterschrift erforderlich"}
                  </Button>
                </div>
                {skipSignKunde ? (
                  <div className="border rounded-lg p-3 bg-muted/50 text-sm text-muted-foreground text-center">
                    Keine Unterschrift erforderlich
                  </div>
                ) : signaturKunde ? (
                  <div className="space-y-2">
                    <img src={signaturKunde} alt="Unterschrift Kunde" className="border rounded-lg max-h-32" />
                    <Button variant="outline" size="sm" onClick={() => setSignaturKunde(null)}>
                      Neu unterschreiben
                    </Button>
                  </div>
                ) : (
                  <SignaturePad onSignatureChange={setSignaturKunde} />
                )}
              </div>
            </div>

            <DialogFooter className="flex flex-col sm:flex-row gap-2 mt-4">
              <Button variant="outline" onClick={() => setSignDialogOpen(false)}>
                Später abschließen
              </Button>
              <Button
                onClick={handleFinalize}
                disabled={saving}
                className="bg-green-600 hover:bg-green-700 gap-2"
              >
                <CheckCircle className="h-4 w-4" />
                {saving ? "Wird abgeschlossen..." : "Bautagesbericht abschließen"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
};

export default BautagesberichtDetail;

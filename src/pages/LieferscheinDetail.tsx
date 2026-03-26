import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Trash2, Package, ArrowDown, ArrowUp, RotateCcw, Plus, Mic, FileText, HelpCircle, ChevronDown, ChevronUp, Lock, LockOpen } from "lucide-react";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useEinheiten } from "@/hooks/useEinheiten";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";

type MaterialEntry = {
  id: string;
  material: string;
  menge: string | null;
  einheit: string | null;
  typ: string | null;
  datum: string | null;
  notizen: string | null;
  created_at: string;
  user_id: string;
  profiles?: { vorname: string; nachname: string } | null;
};

type MaterialSummary = {
  material: string;
  einheit: string;
  entnommen: number;
  zurueck: number;
  verbraucht: number;
};

export default function LieferscheinDetail() {
  const { id } = useParams();
  const { toast } = useToast();
  const einheiten = useEinheiten();
  const [lsName, setLsName] = useState("");
  const [lsProjectId, setLsProjectId] = useState<string | null>(null);
  const [lsProject, setLsProject] = useState<string | null>(null);
  const [lsDatum, setLsDatum] = useState("");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [entries, setEntries] = useState<MaterialEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Form
  const [showForm, setShowForm] = useState(false);
  const [formTyp, setFormTyp] = useState<string>("entnahme");
  const [formMaterial, setFormMaterial] = useState("");
  const [formMenge, setFormMenge] = useState("");
  const [formEinheit, setFormEinheit] = useState("Stk.");
  const [formNotizen, setFormNotizen] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [returningEntry, setReturningEntry] = useState<MaterialEntry | null>(null);
  const [voiceTyp, setVoiceTyp] = useState<"entnahme" | "rueckgabe" | null>(null);
  const [angebotPositionen, setAngebotPositionen] = useState<{position: number; beschreibung: string; menge: number; einheit: string}[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  const [lsStatus, setLsStatus] = useState<string>("offen");
  const [positionenOpen, setPositionenOpen] = useState(true);
  const isAbgeschlossen = lsStatus === "abgeschlossen";

  useEffect(() => {
    init();
  }, [id]);

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setCurrentUserId(user.id);
    const { data: roleData } = await supabase.from("user_roles").select("role").eq("user_id", user.id).single();
    setIsAdmin(roleData?.role === "administrator");
    const { data: prjData } = await supabase.from("projects").select("id, name").eq("status", "aktiv").order("name");
    if (prjData) setProjects(prjData);
    await fetchData();
    setLoading(false);
  };

  const fetchData = async () => {
    if (!id) return;

    // Fetch lieferschein
    const { data: ls } = await supabase.from("lieferscheine").select("*, projects(name)").eq("id", id).single();
    if (ls) {
      setLsName(ls.name || (ls.projects as any)?.name || "Lieferschein");
      setLsProjectId(ls.project_id || null);
      setLsProject((ls.projects as any)?.name || null);
      setLsDatum(ls.datum || "");
      setLsStatus((ls as any).status || "offen");
      await fetchAngebotPositionen(ls.project_id || null);
    }

    // Fetch entries
    const { data: entryData } = await supabase
      .from("material_entries")
      .select("*")
      .eq("lieferschein_id", id)
      .order("created_at", { ascending: false });

    if (entryData) {
      const userIds = [...new Set(entryData.map(e => e.user_id))];
      const { data: profiles } = await supabase.from("profiles").select("id, vorname, nachname").in("id", userIds);
      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

      setEntries(entryData.map(e => ({
        ...e,
        profiles: profileMap.get(e.user_id) || null,
      })));
    }
  };

  const fetchAngebotPositionen = async (projectId: string | null) => {
    if (!projectId) { setAngebotPositionen([]); return; }
    try {
      // Get ALL angebote for this project (not just the latest)
      const { data: angebote, error: angebotError } = await supabase.from("invoices")
        .select("id, nummer")
        .eq("project_id", projectId)
        .eq("typ", "angebot")
        .not("status", "eq", "storniert")
        .order("datum", { ascending: false });

      if (angebotError || !angebote?.length) {
        console.warn("Keine Angebote für Projekt:", projectId, angebotError);
        setAngebotPositionen([]);
        return;
      }

      // Load items from the latest Angebot
      const { data: items, error: itemsError } = await supabase.from("invoice_items")
        .select("position, beschreibung, kurztext, menge, einheit")
        .eq("invoice_id", angebote[0].id)
        .order("position");

      if (itemsError) {
        console.warn("Fehler beim Laden der Angebotspositionen:", itemsError);
        setAngebotPositionen([]);
        return;
      }

      setAngebotPositionen((items || []).map(i => ({
        ...i,
        beschreibung: (i as any).kurztext || i.beschreibung,
        menge: Number(i.menge),
      })));
    } catch (err) {
      console.error("fetchAngebotPositionen Fehler:", err);
      setAngebotPositionen([]);
    }
  };

  // Calculate summary
  const summary: MaterialSummary[] = (() => {
    const map = new Map<string, MaterialSummary>();
    entries.forEach(e => {
      const key = e.material.toLowerCase().trim();
      if (!map.has(key)) {
        map.set(key, { material: e.material, einheit: e.einheit || "Stk.", entnommen: 0, zurueck: 0, verbraucht: 0 });
      }
      const s = map.get(key)!;
      const menge = parseFloat(e.menge || "0") || 0;
      if (e.typ === "entnahme") s.entnommen += menge;
      else if (e.typ === "rueckgabe") s.zurueck += menge;
      s.verbraucht = s.entnommen - s.zurueck;
    });
    return Array.from(map.values()).sort((a, b) => a.material.localeCompare(b.material));
  })();

  const openForm = (typ: string) => {
    setFormTyp(typ);
    setFormMaterial("");
    setFormMenge("");
    setFormEinheit("Stk.");
    setFormNotizen("");
    setReturningEntry(null);
    setShowForm(true);
  };

  const openReturnForm = (entry: MaterialEntry) => {
    setFormTyp("rueckgabe");
    setFormMaterial(entry.material);
    setFormMenge(entry.menge || "");
    setFormEinheit(entry.einheit || "Stk.");
    setFormNotizen("");
    setReturningEntry(entry);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUserId || !formMaterial.trim() || !id) return;

    // Validate: can't return more than what was taken
    if (formTyp === "rueckgabe" && formMenge.trim()) {
      const returnAmount = parseFloat(formMenge) || 0;
      const materialKey = formMaterial.toLowerCase().trim();
      const s = summary.find(s => s.material.toLowerCase().trim() === materialKey);
      const maxReturn = s ? s.verbraucht : 0;
      if (returnAmount > maxReturn) {
        toast({ variant: "destructive", title: "Zu viel", description: `Maximal ${maxReturn} ${formEinheit} können zurückgegeben werden (${s?.entnommen || 0} entnommen, ${s?.zurueck || 0} bereits zurück)` });
        return;
      }
    }

    setSubmitting(true);

    const { error } = await supabase.from("material_entries").insert({
      lieferschein_id: id,
      project_id: null,
      user_id: currentUserId,
      material: formMaterial.trim(),
      menge: formMenge.trim() || null,
      einheit: formEinheit,
      einzelpreis: 0,
      typ: formTyp,
      notizen: formNotizen.trim() || null,
      datum: new Date().toISOString().split("T")[0],
    });

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Konnte nicht gespeichert werden" });
    } else {
      toast({ title: formTyp === "rueckgabe" ? "Material zurückgebucht" : "Material entnommen" });
      setShowForm(false);
      setReturningEntry(null);
      fetchData();
    }
    setSubmitting(false);
  };

  const handleDelete = async (entryId: string) => {
    const { error } = await supabase.from("material_entries").delete().eq("id", entryId);
    if (!error) {
      toast({ title: "Gelöscht" });
      fetchData();
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><p>Lädt...</p></div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title={lsName} backPath="/material" />

      <main className="container mx-auto px-4 py-6 max-w-4xl space-y-4">
        {/* Info + Projekt-Zuordnung */}
        <div className="flex items-center gap-3 flex-wrap text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Projekt:</span>
            <Select
              value={lsProjectId || "none"}
              onValueChange={async (v) => {
                const newPid = v === "none" ? null : v;
                setLsProjectId(newPid);
                const proj = projects.find(p => p.id === newPid);
                setLsProject(proj?.name || null);
                await supabase.from("lieferscheine").update({ project_id: newPid }).eq("id", id);
                await fetchAngebotPositionen(newPid);
                toast({ title: newPid ? `Projekt: ${proj?.name}` : "Projekt entfernt" });
              }}
            >
              <SelectTrigger className="w-[200px] h-8 text-sm">
                <SelectValue placeholder="Kein Projekt" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Kein Projekt</SelectItem>
                {projects.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {lsDatum && <span className="text-muted-foreground">{new Date(lsDatum).toLocaleDateString("de-AT")}</span>}
          {/* Abschließen / Wieder öffnen */}
          {isAbgeschlossen ? (
            <Button variant="outline" size="sm" className="gap-1.5 text-green-700 border-green-300" onClick={async () => {
              await supabase.from("lieferscheine").update({ status: "offen" } as any).eq("id", id);
              setLsStatus("offen");
              toast({ title: "Lieferschein wieder geöffnet" });
            }}>
              <LockOpen className="h-3.5 w-3.5" /> Wieder öffnen
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => {
              await supabase.from("lieferscheine").update({ status: "abgeschlossen" } as any).eq("id", id);
              setLsStatus("abgeschlossen");
              toast({ title: "Lieferschein abgeschlossen" });
            }}>
              <Lock className="h-3.5 w-3.5" /> Lieferschein abschließen
            </Button>
          )}
        </div>

        {/* Abgeschlossen-Hinweis */}
        {isAbgeschlossen && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-gray-50 border rounded-md p-2.5">
            <Lock className="h-4 w-4 shrink-0" />
            <span>Dieser Lieferschein ist abgeschlossen. Es können keine Buchungen mehr vorgenommen werden.</span>
          </div>
        )}

        {/* Hilfe */}
        <div>
          <Button variant="ghost" size="sm" onClick={() => setShowHelp(!showHelp)} className="gap-1.5 text-muted-foreground">
            <HelpCircle className="h-4 w-4" />
            Wie funktioniert's?
            {showHelp ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
          {showHelp && (
            <Card className="mt-2 border-blue-200 bg-blue-50/50">
              <CardContent className="pt-4 pb-3 text-sm space-y-1.5">
                <p className="font-medium">So funktioniert die Materialentnahme:</p>
                <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                  <li><strong>Projekt auswählen</strong> — Angebotspositionen werden automatisch geladen</li>
                  <li><strong>Material entnehmen</strong> — Per Klick auf eine Angebotsposition oder manuell eingeben</li>
                  <li><strong>Per Sprache</strong> — Einfach sagen: "Position 1, 25 Quadratmeter" oder neues Material nennen</li>
                  <li><strong>Rückgabe</strong> — Nicht verbrauchtes Material zurückbuchen</li>
                  <li><strong>Übersicht</strong> — Zeigt immer den aktuellen Stand (Entnommen / Zurück / Verbraucht)</li>
                </ol>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Action Buttons */}
        {!showForm && !voiceTyp && !isAbgeschlossen && (
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => setVoiceTyp("entnahme")} className="gap-2 bg-orange-600 hover:bg-orange-700">
              <Mic className="h-4 w-4" />
              Per Sprache entnehmen
            </Button>
            <Button onClick={() => setVoiceTyp("rueckgabe")} variant="outline" className="gap-2">
              <Mic className="h-4 w-4" />
              Per Sprache zurückgeben
            </Button>
            <Button onClick={() => openForm("entnahme")} variant="outline" className="gap-2">
              <Plus className="h-4 w-4" />
              Manuell eingeben
            </Button>
          </div>
        )}

        {/* Voice Recorder — stays at top, visible while scrolling positions below */}
        {voiceTyp && (
          <VoiceRecorder
            typ={voiceTyp}
            existingItems={
              angebotPositionen.length > 0
                ? angebotPositionen.map(p => ({
                    position: p.position,
                    material: p.beschreibung,
                    menge: voiceTyp === "rueckgabe"
                      ? String(summary.find(s => s.material.toLowerCase().trim() === p.beschreibung.toLowerCase().trim())?.verbraucht || 0)
                      : String(p.menge),
                    einheit: p.einheit,
                  }))
                : summary.map((s, idx) => ({
                    position: idx + 1,
                    material: s.material,
                    menge: String(s.verbraucht),
                    einheit: s.einheit,
                  }))
            }
            onAccept={async (voiceItems) => {
              if (!currentUserId || !id) return;
              let skipped = 0;
              for (const item of voiceItems) {
                if (voiceTyp === "rueckgabe") {
                  const s = summary.find(s => s.material.toLowerCase().trim() === item.material.toLowerCase().trim());
                  const maxReturn = s ? s.verbraucht : 0;
                  if (item.menge > maxReturn) { skipped++; continue; }
                }
                await supabase.from("material_entries").insert({
                  lieferschein_id: id, project_id: null, user_id: currentUserId,
                  material: item.material, menge: String(item.menge), einheit: item.einheit,
                  einzelpreis: 0, typ: voiceTyp, notizen: null,
                  datum: new Date().toISOString().split("T")[0],
                });
              }
              toast({
                title: voiceTyp === "entnahme" ? "Material entnommen" : "Material zurückgebucht",
                description: `${voiceItems.length} Positionen per Sprache erfasst`,
              });
              setVoiceTyp(null);
              setShowForm(false);
              fetchData();
            }}
            onCancel={() => setVoiceTyp(null)}
          />
        )}

        {/* Hinweis wenn Projekt aber keine Angebotspositionen */}
        {lsProjectId && angebotPositionen.length === 0 && !isAbgeschlossen && (
          <div className="text-sm text-muted-foreground bg-yellow-50 border border-yellow-200 rounded-md p-2.5">
            Kein Angebot für dieses Projekt gefunden. Erstelle zuerst ein Angebot mit Positionen und weise es diesem Projekt zu.
          </div>
        )}

        {/* Angebotspositionen — collapsible, open by default */}
        {angebotPositionen.length > 0 && !isAbgeschlossen && (
          <Card>
            <CardHeader className="pb-2 cursor-pointer" onClick={() => setPositionenOpen(!positionenOpen)}>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4" />
                  Angebotspositionen — Material entnehmen ({angebotPositionen.length})
                </CardTitle>
                {positionenOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
              <CardDescription>Menge eingeben und auf "Entnehmen" klicken</CardDescription>
            </CardHeader>
            {positionenOpen && <CardContent className="space-y-2 pt-0">
              {angebotPositionen.map((p) => (
                <div key={p.position} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-muted-foreground font-medium">Pos {String(p.position).padStart(2, "0")}</span>
                      <p className="font-medium text-sm leading-tight">{p.beschreibung}</p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{p.menge} {p.einheit}</span>
                  </div>
                  <div className="flex gap-2 items-center">
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      placeholder="Menge"
                      className="h-9 text-sm flex-1"
                      id={`menge-${p.position}`}
                    />
                    <span className="text-xs text-muted-foreground shrink-0 w-10">{p.einheit}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-orange-700 border-orange-300 hover:bg-orange-50 h-9 shrink-0"
                      onClick={async () => {
                        const input = document.getElementById(`menge-${p.position}`) as HTMLInputElement;
                        const menge = input?.value?.trim();
                        if (!menge || !currentUserId || !id) {
                          toast({ variant: "destructive", title: "Menge eingeben" });
                          return;
                        }
                        const { error } = await supabase.from("material_entries").insert({
                          lieferschein_id: id, project_id: null, user_id: currentUserId,
                          material: p.beschreibung, menge, einheit: p.einheit || "Stk.",
                          einzelpreis: 0, typ: "entnahme", notizen: null,
                          datum: new Date().toISOString().split("T")[0],
                        });
                        if (error) {
                          toast({ variant: "destructive", title: "Fehler", description: error.message });
                        } else {
                          toast({ title: `${menge} ${p.einheit} ${p.beschreibung} entnommen` });
                          if (input) input.value = "";
                          fetchData();
                        }
                      }}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                      Entnehmen
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>}
          </Card>
        )}

        {/* Manual Form — for additional material not in Angebot */}
        {showForm && !voiceTyp && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                {formTyp === "entnahme" ? (
                  <><ArrowUp className="h-5 w-5 text-red-500" /> Material manuell eingeben</>
                ) : (
                  <><ArrowDown className="h-5 w-5 text-green-500" /> Material zurückbringen</>
                )}
              </CardTitle>
              {returningEntry && <CardDescription>Vorausgefüllt — Menge anpassen falls nötig</CardDescription>}
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-sm font-medium">Material *</label>
                    <Input value={formMaterial} onChange={(e) => setFormMaterial(e.target.value)} placeholder="z.B. Fliese 30x60 anthrazit" required />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Menge</label>
                    <Input value={formMenge} onChange={(e) => setFormMenge(e.target.value)} placeholder="z.B. 25" type="number" step="0.1" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Einheit</label>
                    <Select value={formEinheit} onValueChange={setFormEinheit}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {einheiten.map(e => (
                          <SelectItem key={e} value={e}>{e}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <label className="text-sm font-medium">Notizen</label>
                    <Input value={formNotizen} onChange={(e) => setFormNotizen(e.target.value)} placeholder="Optionale Bemerkung" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={submitting || !formMaterial.trim()} className={formTyp === "entnahme" ? "bg-orange-600 hover:bg-orange-700" : "bg-green-600 hover:bg-green-700"}>
                    {submitting ? "Speichert..." : formTyp === "entnahme" ? "Entnehmen" : "Zurückbuchen"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => { setShowForm(false); setReturningEntry(null); }}>Abbrechen</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}


        {/* Verbrauchsübersicht */}
        {summary.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4" />
                Materialübersicht
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">Pos</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead className="text-right">Entnommen</TableHead>
                    <TableHead className="text-right">Zurück</TableHead>
                    <TableHead className="text-right font-bold">Verbraucht</TableHead>
                    <TableHead className="text-right w-[100px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.map((s, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="text-muted-foreground text-center font-medium">{idx + 1}</TableCell>
                      <TableCell className="font-medium">{s.material}</TableCell>
                      <TableCell className="text-right text-red-600">{s.entnommen} {s.einheit}</TableCell>
                      <TableCell className="text-right text-green-600">{s.zurueck} {s.einheit}</TableCell>
                      <TableCell className="text-right font-bold">{s.verbraucht} {s.einheit}</TableCell>
                      <TableCell className="text-right">
                        {s.verbraucht > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1 text-green-700 border-green-300 hover:bg-green-50"
                            onClick={() => {
                              setFormTyp("rueckgabe");
                              setFormMaterial(s.material);
                              setFormMenge("");
                              setFormEinheit(s.einheit);
                              setFormNotizen("");
                              setReturningEntry(null);
                              setShowForm(true);
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Zurück</span>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Einzelne Buchungen — kompakter */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Buchungen ({entries.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {entries.length === 0 ? (
              <div className="text-center py-6">
                <Package className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Noch keine Einträge</p>
              </div>
            ) : (
              <div className="space-y-2">
                {entries.map((entry) => (
                  <div key={entry.id} className="p-3 rounded-lg border bg-card flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {entry.typ === "entnahme" ? (
                        <ArrowUp className="h-3.5 w-3.5 text-red-500 shrink-0" />
                      ) : (
                        <ArrowDown className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-sm truncate">{entry.material}</p>
                          <Badge variant="secondary" className={`text-xs shrink-0 ${entry.typ === "entnahme" ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}`}>
                            {entry.typ === "entnahme" ? "Entnommen" : "Zurückgebracht"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {entry.menge && `${entry.menge} ${entry.einheit || ""}`}
                          {entry.profiles ? ` · ${entry.profiles.vorname} ${entry.profiles.nachname}` : ""}
                          {" · "}
                          {entry.datum ? new Date(entry.datum).toLocaleDateString("de-AT") : new Date(entry.created_at).toLocaleDateString("de-AT")}
                        </p>
                        {entry.notizen && <p className="text-xs text-muted-foreground italic mt-0.5">{entry.notizen}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {entry.typ === "entnahme" && (
                        <Button variant="outline" size="sm" onClick={() => openReturnForm(entry)} className="gap-1 text-green-700 border-green-300 hover:bg-green-50">
                          <RotateCcw className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Zurückgeben</span>
                        </Button>
                      )}
                      {(isAdmin || entry.user_id === currentUserId) && (
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(entry.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

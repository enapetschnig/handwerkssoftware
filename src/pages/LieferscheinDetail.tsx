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

  // Build unified material list: Angebotspositionen + extra entnommene Materialien
  const materialList = (() => {
    const list: { pos: number; material: string; soll: number; einheit: string; entnommen: number; zurueck: number; verbraucht: number; isAngebot: boolean }[] = [];

    // 1. Angebotspositionen with their entnahme status
    angebotPositionen.forEach(p => {
      const s = summary.find(s => s.material.toLowerCase().trim() === p.beschreibung.toLowerCase().trim());
      list.push({
        pos: p.position,
        material: p.beschreibung,
        soll: p.menge,
        einheit: p.einheit,
        entnommen: s?.entnommen || 0,
        zurueck: s?.zurueck || 0,
        verbraucht: s?.verbraucht || 0,
        isAngebot: true,
      });
    });

    // 2. Extra materials (entnommen but not in Angebot)
    summary.forEach(s => {
      const inAngebot = angebotPositionen.some(p => p.beschreibung.toLowerCase().trim() === s.material.toLowerCase().trim());
      if (!inAngebot) {
        list.push({
          pos: list.length + 1,
          material: s.material,
          soll: 0,
          einheit: s.einheit,
          entnommen: s.entnommen,
          zurueck: s.zurueck,
          verbraucht: s.verbraucht,
          isAngebot: false,
        });
      }
    });

    return list;
  })();

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title={lsName} backPath="/material" />

      <main className="container mx-auto px-4 py-4 max-w-lg space-y-3">
        {/* 1. Header: Projekt + Datum + Status */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
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
              <SelectTrigger className="flex-1 h-9 text-sm">
                <SelectValue placeholder="Projekt wählen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Kein Projekt</SelectItem>
                {projects.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {lsDatum && <span className="text-xs text-muted-foreground">{new Date(lsDatum).toLocaleDateString("de-AT")}</span>}
          </div>
          {isAbgeschlossen && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-gray-50 border rounded-md p-2">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              <span>Abgeschlossen — keine Buchungen mehr möglich</span>
              <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs gap-1 text-green-700" onClick={async () => {
                await supabase.from("lieferscheine").update({ status: "offen" } as any).eq("id", id);
                setLsStatus("offen");
                toast({ title: "Wieder geöffnet" });
              }}>
                <LockOpen className="h-3 w-3" /> Öffnen
              </Button>
            </div>
          )}
        </div>

        {/* 2. Action Buttons — prominent */}
        {!isAbgeschlossen && !voiceTyp && !showForm && (
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => setVoiceTyp("entnahme")} className="gap-2 bg-orange-600 hover:bg-orange-700 h-12 text-sm">
              <Mic className="h-5 w-5" />
              Entnehmen
            </Button>
            <Button onClick={() => setVoiceTyp("rueckgabe")} variant="outline" className="gap-2 h-12 text-sm">
              <Mic className="h-5 w-5" />
              Zurückgeben
            </Button>
          </div>
        )}

        {/* 3. Voice Recorder */}
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
              for (const item of voiceItems) {
                if (voiceTyp === "rueckgabe") {
                  const s = summary.find(s => s.material.toLowerCase().trim() === item.material.toLowerCase().trim());
                  if (item.menge > (s?.verbraucht || 0)) continue;
                }
                await supabase.from("material_entries").insert({
                  lieferschein_id: id, project_id: null, user_id: currentUserId,
                  material: item.material, menge: String(item.menge), einheit: item.einheit,
                  einzelpreis: 0, typ: voiceTyp, notizen: null,
                  datum: new Date().toISOString().split("T")[0],
                });
              }
              toast({ title: `${voiceItems.length} Positionen erfasst` });
              setVoiceTyp(null); setShowForm(false); fetchData();
            }}
            onCancel={() => setVoiceTyp(null)}
          />
        )}

        {/* 4. Materialliste — EINE einzige Liste */}
        {(materialList.length > 0 || !isAbgeschlossen) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Materialliste</CardTitle>
              {materialList.some(m => m.entnommen > 0) && (
                <CardDescription>{materialList.filter(m => m.entnommen > 0).length} von {materialList.length} entnommen</CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-1.5 pt-0">
              {materialList.map((m) => {
                const done = m.isAngebot && m.verbraucht >= m.soll && m.soll > 0;
                return (
                  <div key={`${m.isAngebot ? "a" : "e"}-${m.pos}`} className={`border rounded-lg p-2.5 ${done ? "bg-green-50/50 border-green-200" : ""}`}>
                    {/* Row 1: Position + Material + Status */}
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-muted-foreground font-mono mt-0.5 shrink-0 w-5">{String(m.pos).padStart(2, "0")}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium leading-tight ${done ? "text-green-700" : ""}`}>{m.material}</p>
                        <div className="flex gap-2 mt-0.5 text-xs text-muted-foreground">
                          {m.isAngebot && <span>Soll: {m.soll} {m.einheit}</span>}
                          {m.entnommen > 0 && <span className="text-orange-600">↑ {m.entnommen}</span>}
                          {m.zurueck > 0 && <span className="text-green-600">↓ {m.zurueck}</span>}
                          {m.verbraucht > 0 && <span className="font-medium text-foreground">= {m.verbraucht} {m.einheit}</span>}
                        </div>
                      </div>
                      {done && <span className="text-green-600 text-sm shrink-0">✓</span>}
                    </div>
                    {/* Row 2: Input + Button (only if not closed) */}
                    {!isAbgeschlossen && (
                      <div className="flex gap-2 items-center mt-2">
                        <Input
                          type="number" step="0.1" min="0"
                          placeholder="Menge"
                          className="h-8 text-sm flex-1"
                          id={`ml-${m.isAngebot ? "a" : "e"}-${m.pos}`}
                        />
                        <span className="text-xs text-muted-foreground shrink-0 w-10">{m.einheit}</span>
                        <Button
                          size="sm"
                          className="gap-1 h-8 shrink-0 bg-orange-600 hover:bg-orange-700 text-xs"
                          onClick={async () => {
                            const input = document.getElementById(`ml-${m.isAngebot ? "a" : "e"}-${m.pos}`) as HTMLInputElement;
                            const menge = input?.value?.trim();
                            if (!menge || !currentUserId || !id) { toast({ variant: "destructive", title: "Menge eingeben" }); return; }
                            const { error } = await supabase.from("material_entries").insert({
                              lieferschein_id: id, project_id: null, user_id: currentUserId,
                              material: m.material, menge, einheit: m.einheit || "Stk.",
                              einzelpreis: 0, typ: "entnahme", notizen: null,
                              datum: new Date().toISOString().split("T")[0],
                            });
                            if (error) { toast({ variant: "destructive", title: "Fehler" }); }
                            else { toast({ title: `${menge} ${m.einheit} entnommen` }); if (input) input.value = ""; fetchData(); }
                          }}
                        >
                          <ArrowUp className="h-3 w-3" /> Entnehmen
                        </Button>
                        {m.verbraucht > 0 && (
                          <Button
                            variant="outline" size="sm"
                            className="gap-1 h-8 shrink-0 text-green-700 border-green-300 text-xs"
                            onClick={() => {
                              setFormTyp("rueckgabe"); setFormMaterial(m.material); setFormMenge("");
                              setFormEinheit(m.einheit); setFormNotizen(""); setReturningEntry(null);
                              setShowForm(true); window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                          >
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* + Material hinzufügen */}
              {!isAbgeschlossen && (
                <Button
                  variant="ghost" size="sm"
                  className="w-full gap-1.5 text-muted-foreground mt-1"
                  onClick={() => openForm("entnahme")}
                >
                  <Plus className="h-3.5 w-3.5" /> Weiteres Material hinzufügen
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Hinweis wenn Projekt aber keine Angebotspositionen */}
        {lsProjectId && angebotPositionen.length === 0 && summary.length === 0 && !isAbgeschlossen && (
          <div className="text-xs text-muted-foreground bg-yellow-50 border border-yellow-200 rounded-md p-2">
            Kein Angebot gefunden. Erstelle ein Angebot und weise es diesem Projekt zu.
          </div>
        )}

        {/* Manual Form — slides in when needed */}
        {showForm && !voiceTyp && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                {formTyp === "entnahme" ? <><ArrowUp className="h-4 w-4 text-orange-500" /> Material eingeben</> : <><ArrowDown className="h-4 w-4 text-green-500" /> Zurückgeben</>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-2">
                <Input value={formMaterial} onChange={(e) => setFormMaterial(e.target.value)} placeholder="Material *" required />
                <div className="flex gap-2">
                  <Input value={formMenge} onChange={(e) => setFormMenge(e.target.value)} placeholder="Menge" type="number" step="0.1" className="flex-1" />
                  <Select value={formEinheit} onValueChange={setFormEinheit}>
                    <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {einheiten.map(e => (<SelectItem key={e} value={e}>{e}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={submitting || !formMaterial.trim()} className={`flex-1 ${formTyp === "entnahme" ? "bg-orange-600 hover:bg-orange-700" : "bg-green-600 hover:bg-green-700"}`}>
                    {submitting ? "..." : formTyp === "entnahme" ? "Entnehmen" : "Zurückbuchen"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => { setShowForm(false); setReturningEntry(null); }}>Abbrechen</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Abschließen-Button am Ende */}
        {!isAbgeschlossen && entries.length > 0 && (
          <Button variant="outline" className="w-full gap-2" onClick={async () => {
            await supabase.from("lieferscheine").update({ status: "abgeschlossen" } as any).eq("id", id);
            setLsStatus("abgeschlossen");
            toast({ title: "Lieferschein abgeschlossen" });
          }}>
            <Lock className="h-4 w-4" /> Lieferschein abschließen
          </Button>
        )}

        {/* Buchungen — eingeklappt */}
        {entries.length > 0 && (
          <Card>
            <CardHeader className="pb-0 cursor-pointer" onClick={() => setShowHelp(!showHelp)}>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm text-muted-foreground">Buchungen ({entries.length})</CardTitle>
                {showHelp ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
              </div>
            </CardHeader>
            {showHelp && <CardContent className="pt-2">
              <div className="space-y-1.5">
                {entries.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between gap-2 text-xs py-1.5 border-b last:border-0">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {entry.typ === "entnahme" ? <ArrowUp className="h-3 w-3 text-orange-500 shrink-0" /> : <ArrowDown className="h-3 w-3 text-green-500 shrink-0" />}
                      <span className="truncate">{entry.material}</span>
                      <span className="text-muted-foreground shrink-0">{entry.menge} {entry.einheit}</span>
                    </div>
                    {(isAdmin || entry.user_id === currentUserId) && (
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleDelete(entry.id)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>}
          </Card>
        )}
      </main>
    </div>
  );
}

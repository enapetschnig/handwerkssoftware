import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, FolderKanban, Merge, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Proj {
  id: string;
  name: string;
  customer_id: string | null;
  status: string | null;
  created_at: string;
  projektnummer: string | null;
  customer_name?: string | null;
}

interface DupGroup {
  key: string;
  name: string;
  customer_id: string | null;
  customer_name: string | null;
  projects: Proj[];
}

/** Tabellen mit project_id FK, die beim Mergen umgebogen werden müssen. */
const FK_TABLES: { table: string; col: string }[] = [
  { table: "einsaetze", col: "project_id" },
  { table: "board_projects", col: "project_id" },
  { table: "bautagesberichte", col: "project_id" },
  { table: "besprechungsprotokolle", col: "project_id" },
  { table: "ersttermin_interessent", col: "project_id" },
  { table: "time_entries", col: "project_id" },
  { table: "disturbances", col: "project_id" },
  { table: "invoices", col: "project_id" },
  { table: "documents", col: "project_id" },
  { table: "project_daily_targets", col: "project_id" },
  { table: "assignment_resources", col: "project_id" },
  { table: "purchase_invoices", col: "project_id" },
];

/** Storage-Buckets mit {project_id}/... Struktur, deren Dateien umziehen müssen. */
const STORAGE_BUCKETS = ["project-photos", "project-plans", "project-reports", "project-materials"];

function groupKey(name: string, customerId: string | null): string {
  return `${(name || "").trim().toLowerCase()}|${customerId || "null"}`;
}

export function DuplicateProjectsManager() {
  const { toast } = useToast();
  const [groups, setGroups] = useState<DupGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [mergingGroup, setMergingGroup] = useState<DupGroup | null>(null);
  const [primaryId, setPrimaryId] = useState<string>("");
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    scan();
  }, []);

  const scan = async () => {
    setLoading(true);
    const { data: projs } = await supabase
      .from("projects")
      .select("id, name, customer_id, status, created_at, projektnummer")
      .order("created_at", { ascending: true });

    if (!projs) {
      setGroups([]);
      setLoading(false);
      return;
    }

    // Customer-Namen laden (für Anzeige)
    const custIds = Array.from(new Set((projs as any[]).map((p) => p.customer_id).filter(Boolean)));
    let custMap = new Map<string, string>();
    if (custIds.length > 0) {
      const { data: custs } = await supabase
        .from("customers")
        .select("id, name")
        .in("id", custIds);
      if (custs) {
        custMap = new Map((custs as any[]).map((c) => [c.id, c.name]));
      }
    }

    // Gruppieren
    const map = new Map<string, DupGroup>();
    for (const p of projs as any[]) {
      const key = groupKey(p.name, p.customer_id);
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: p.name,
          customer_id: p.customer_id,
          customer_name: p.customer_id ? custMap.get(p.customer_id) || null : null,
          projects: [],
        });
      }
      map.get(key)!.projects.push({
        ...p,
        customer_name: p.customer_id ? custMap.get(p.customer_id) || null : null,
      });
    }

    const dups = Array.from(map.values())
      .filter((g) => g.projects.length >= 2)
      .sort((a, b) => a.name.localeCompare(b.name));

    setGroups(dups);
    setLoading(false);
  };

  const openMerge = (group: DupGroup) => {
    setMergingGroup(group);
    // Default: primary = ältestes Projekt (erster Eintrag, da asc sortiert)
    setPrimaryId(group.projects[0].id);
  };

  const performMerge = async () => {
    if (!mergingGroup || !primaryId) return;
    setMerging(true);

    const losers = mergingGroup.projects.filter((p) => p.id !== primaryId);

    try {
      for (const loser of losers) {
        // 1. FK-Tabellen umbiegen
        for (const { table, col } of FK_TABLES) {
          await (supabase.from(table as never) as any)
            .update({ [col]: primaryId })
            .eq(col, loser.id);
        }

        // 2. Storage-Dateien umbenennen (von loser-ID-Ordner in primary-ID-Ordner)
        for (const bucket of STORAGE_BUCKETS) {
          try {
            const { data: files } = await supabase.storage.from(bucket).list(loser.id);
            if (files && files.length > 0) {
              for (const f of files) {
                const from = `${loser.id}/${f.name}`;
                const to = `${primaryId}/${f.name}`;
                await supabase.storage.from(bucket).move(from, to);
              }
            }
          } catch { /* bucket evtl. nicht verfügbar */ }
        }

        // 3. Loser-Projekt löschen
        await supabase.from("projects").delete().eq("id", loser.id);
      }

      toast({
        title: "Projekte zusammengeführt",
        description: `${losers.length} Duplikat${losers.length > 1 ? "e" : ""} wurde${losers.length > 1 ? "n" : ""} in "${mergingGroup.name}" integriert.`,
      });
      setMergingGroup(null);
      setPrimaryId("");
      await scan();
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Fehler beim Zusammenführen",
        description: err?.message || String(err),
      });
    } finally {
      setMerging(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          Doppelte Projekte
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Projekte mit identischem Namen beim gleichen Kunden. Kann beim Anlegen von Ersttermin-Projekten
          entstehen, wenn ein Projekt mehrfach erstellt wird.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-between items-center">
          <p className="text-sm">
            {loading ? "Suche läuft…" : groups.length === 0
              ? "Keine Duplikate gefunden."
              : `${groups.length} Duplikat-Gruppe${groups.length > 1 ? "n" : ""} gefunden`}
          </p>
          <Button variant="outline" size="sm" onClick={scan} disabled={loading} className="gap-2">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Erneut prüfen
          </Button>
        </div>

        {groups.map((group) => (
          <div key={group.key} className="border rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium text-sm flex items-center gap-2">
                  <FolderKanban className="h-4 w-4 text-primary" />
                  {group.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {group.customer_name ? `Kunde: ${group.customer_name}` : "Ohne Kunde"} ·
                  {" " + group.projects.length} Projekte
                </p>
              </div>
              <Button size="sm" onClick={() => openMerge(group)} className="gap-1">
                <Merge className="h-3.5 w-3.5" />
                Zusammenführen
              </Button>
            </div>
            <div className="text-xs text-muted-foreground pl-6 space-y-0.5">
              {group.projects.map((p) => (
                <div key={p.id} className="flex gap-2">
                  <span className="font-mono">{p.id.slice(0, 8)}</span>
                  <span>·</span>
                  <span>{new Date(p.created_at).toLocaleDateString("de-AT")}</span>
                  {p.projektnummer && <><span>·</span><Badge variant="outline" className="text-[10px] h-4 px-1">Nr. {p.projektnummer}</Badge></>}
                  {p.status && <span>· {p.status}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>

      <AlertDialog open={!!mergingGroup} onOpenChange={(open) => !open && !merging && setMergingGroup(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Projekte zusammenführen</AlertDialogTitle>
            <AlertDialogDescription>
              Wähle, welches Projekt behalten wird. Alle anderen werden gelöscht, ihre Zuweisungen
              (Einsätze, Bautagesberichte, Protokolle, Rechnungen, Zeiterfassung usw.) sowie Storage-Dateien
              werden auf das gewählte Projekt übertragen.
              <br /><br />
              <strong className="text-destructive">Diese Aktion kann nicht rückgängig gemacht werden.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {mergingGroup && (
            <RadioGroup value={primaryId} onValueChange={setPrimaryId} className="my-3 space-y-2">
              {mergingGroup.projects.map((p) => (
                <div key={p.id} className="flex items-start gap-2 border rounded-md p-2">
                  <RadioGroupItem value={p.id} id={`merge-${p.id}`} className="mt-1" />
                  <Label htmlFor={`merge-${p.id}`} className="flex-1 cursor-pointer">
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      erstellt am {new Date(p.created_at).toLocaleDateString("de-AT")}
                      {p.projektnummer && ` · Nr. ${p.projektnummer}`}
                      {p.status && ` · Status: ${p.status}`}
                    </div>
                    <div className="text-[11px] font-mono text-muted-foreground">{p.id}</div>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={merging}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); performMerge(); }}
              disabled={merging || !primaryId}
              className="bg-primary"
            >
              {merging ? "Zusammenführen…" : "Jetzt zusammenführen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

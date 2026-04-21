// Helper für projektbasierte Zugriffssteuerung.
// Quelle der Wahrheit: projects.zugewiesene_mitarbeiter (JSONB-Array
// von employee.id als String). Admin + Vorarbeiter sehen immer alles
// via RLS-Funktion user_can_access_project — keine Einträge nötig.
import { supabase } from "@/integrations/supabase/client";

export interface ProjectLite {
  id: string;
  name: string;
  status?: string | null;
}

/** Lädt alle aktiven Projekte (nicht abgeschlossen). Für Auswahl-UI. */
export async function listAllActiveProjects(): Promise<ProjectLite[]> {
  const { data } = await supabase
    .from("projects")
    .select("id, name, status")
    .not("status", "eq", "Abgeschlossen")
    .order("name");
  return (data as ProjectLite[]) || [];
}

/** Lädt die IDs aller Projekte, in denen dieser Mitarbeiter (employee.id)
 *  in zugewiesene_mitarbeiter steht. */
export async function getEmployeeAccessibleProjectIds(employeeId: string): Promise<string[]> {
  const { data } = await (supabase.from("projects" as never) as any)
    .select("id, zugewiesene_mitarbeiter")
    .contains("zugewiesene_mitarbeiter", [employeeId]);
  return ((data as any[]) || []).map(p => p.id);
}

export type ProjectAccessSource = "assigned" | "bauleiter" | "verantwortlicher";

export interface EmployeeProjectRelation {
  projectId: string;
  name: string;
  sources: ProjectAccessSource[]; // Mehrfachzuordnung möglich
}

/** Lädt alle aktiven Projekte und markiert für den gegebenen Mitarbeiter,
 *  aus welcher Quelle er Zugang hat (als Bauleiter, Verantwortlicher
 *  und/oder via zugewiesene_mitarbeiter). Projekte ohne Zugang haben
 *  sources = [] und können in der UI weiterhin angehakt werden. */
export async function loadEmployeeProjectRelations(
  employeeId: string,
): Promise<EmployeeProjectRelation[]> {
  const { data } = await (supabase.from("projects" as never) as any)
    .select("id, name, status, verantwortlicher_id, bauleiter_id, zugewiesene_mitarbeiter")
    .not("status", "eq", "Abgeschlossen")
    .order("name");
  return ((data as any[]) || []).map((p: any) => {
    const sources: ProjectAccessSource[] = [];
    if (p.verantwortlicher_id === employeeId) sources.push("verantwortlicher");
    if (p.bauleiter_id === employeeId) sources.push("bauleiter");
    if (Array.isArray(p.zugewiesene_mitarbeiter) && p.zugewiesene_mitarbeiter.includes(employeeId)) {
      sources.push("assigned");
    }
    return { projectId: p.id, name: p.name, sources };
  });
}

/** Synchronisiert die Projekt-Zugänge eines Mitarbeiters:
 *  - fügt employeeId zu allen Projekten in nextIds hinzu, sofern noch nicht drin
 *  - entfernt employeeId aus allen aktuellen Zuordnungen, die nicht in nextIds sind.
 *  Liefert { added, removed } zurück für Feedback. */
export async function syncEmployeeProjectAccess(
  employeeId: string,
  nextProjectIds: string[],
): Promise<{ added: number; removed: number }> {
  const nextSet = new Set(nextProjectIds);

  // Aktuelle Projekt-Zuordnungen des Mitarbeiters holen
  const { data: assigned } = await (supabase.from("projects" as never) as any)
    .select("id, zugewiesene_mitarbeiter")
    .contains("zugewiesene_mitarbeiter", [employeeId]);
  const currentIds = new Set(((assigned as any[]) || []).map(p => p.id));

  // Entfernen: aktuell zugeordnet, aber nicht mehr gewünscht
  const toRemove = [...currentIds].filter(id => !nextSet.has(id));
  // Hinzufügen: gewünscht, aber nicht aktuell zugeordnet
  const toAdd = nextProjectIds.filter(id => !currentIds.has(id));

  // Für Add-/Remove-Operationen müssen wir das JSONB-Array manuell aktualisieren
  // (Supabase JS hat kein array-contains-modify out-of-box).
  if (toRemove.length > 0) {
    const { data: removeRows } = await (supabase.from("projects" as never) as any)
      .select("id, zugewiesene_mitarbeiter")
      .in("id", toRemove);
    for (const row of (removeRows as any[]) || []) {
      const current: string[] = Array.isArray(row.zugewiesene_mitarbeiter) ? row.zugewiesene_mitarbeiter : [];
      const updated = current.filter((x: string) => x !== employeeId);
      await (supabase.from("projects" as never) as any)
        .update({ zugewiesene_mitarbeiter: updated })
        .eq("id", row.id);
    }
  }

  if (toAdd.length > 0) {
    const { data: addRows } = await (supabase.from("projects" as never) as any)
      .select("id, zugewiesene_mitarbeiter")
      .in("id", toAdd);
    for (const row of (addRows as any[]) || []) {
      const current: string[] = Array.isArray(row.zugewiesene_mitarbeiter) ? row.zugewiesene_mitarbeiter : [];
      if (!current.includes(employeeId)) {
        await (supabase.from("projects" as never) as any)
          .update({ zugewiesene_mitarbeiter: [...current, employeeId] })
          .eq("id", row.id);
      }
    }
  }

  return { added: toAdd.length, removed: toRemove.length };
}

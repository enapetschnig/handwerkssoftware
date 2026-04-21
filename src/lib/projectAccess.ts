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

/** Lädt alle aktiven Projekte (nicht abgeschlossen). Für Admin-UI (sieht alles). */
export async function listAllActiveProjects(): Promise<ProjectLite[]> {
  const { data } = await supabase
    .from("projects")
    .select("id, name, status")
    .not("status", "eq", "Abgeschlossen")
    .order("name");
  return (data as ProjectLite[]) || [];
}

/**
 * Lädt die für den eingeloggten User sichtbaren + aktiven Projekte.
 * Nutzt das zentrale RPC list_accessible_project_ids_for_user → funktioniert
 * unabhängig von RLS-Konfiguration und berücksichtigt immer live die
 * aktuellen Zuweisungen (zugewiesene_mitarbeiter / bauleiter / verantwortlicher).
 *
 * Ergebnis: id, name, status. Weitere Felder müssen bei Bedarf nachgeladen werden.
 */
export async function fetchMyAccessibleProjects(opts: { onlyActive?: boolean } = {}): Promise<ProjectLite[]> {
  const onlyActive = opts.onlyActive !== false;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await (supabase.rpc as any)("list_accessible_project_ids_for_user", {
    p_user_id: user.id,
    p_only_active: onlyActive,
  });
  if (error) {
    console.error("fetchMyAccessibleProjects RPC failed:", error);
    return [];
  }
  return ((data as any[]) || []).map((p: any) => ({ id: p.id, name: p.name, status: p.status }));
}

/**
 * Wie fetchMyAccessibleProjects, aber lädt zusätzlich die übergebenen
 * Spalten aus der projects-Tabelle für die IDs nach. Für Views, die mehr
 * als nur id+name brauchen (z.B. Zeiterfassung braucht plz, Plantafel
 * braucht customer_id etc.).
 */
export async function fetchMyAccessibleProjectsFull<T extends Record<string, any>>(
  selectColumns: string,
  opts: { onlyActive?: boolean } = {},
): Promise<T[]> {
  const base = await fetchMyAccessibleProjects(opts);
  if (base.length === 0) return [];
  const ids = base.map((p) => p.id);
  const { data } = await supabase
    .from("projects")
    .select(selectColumns)
    .in("id", ids)
    .order("name");
  return ((data as any[]) || []) as T[];
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

/** Synchronisiert die Projekt-Zugänge eines Mitarbeiters via SECURITY-DEFINER-RPC
 *  set_employee_project_access. Das RPC bekommt employee_id + Liste der
 *  gewünschten project_ids und aktualisiert projects.zugewiesene_mitarbeiter
 *  atomar + ohne RLS-Hürden. Der Caller muss Admin/Vorarbeiter sein
 *  (wird in der Funktion geprüft).
 *
 *  Wirft bei Fehlern eine Exception mit Details.
 */
export async function syncEmployeeProjectAccess(
  employeeId: string,
  nextProjectIds: string[],
): Promise<{ added: number; removed: number; failed: number }> {
  const { data, error } = await (supabase.rpc as any)("set_employee_project_access", {
    p_employee_id: employeeId,
    p_project_ids: nextProjectIds,
  });
  if (error) {
    throw new Error(`Projekt-Zuordnung fehlgeschlagen: ${error.message}`);
  }
  return {
    added: Number((data as any)?.added) || 0,
    removed: Number((data as any)?.removed) || 0,
    failed: 0,
  };
}

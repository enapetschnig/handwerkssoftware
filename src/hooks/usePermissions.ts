import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export const FEATURES = [
  'zeiterfassung','projekte','meine_stunden','regieberichte','rechnungen',
  'kalender','plantafel','bautagesberichte','ersttermine','protokolle',
  'kunden','materialien','admin','stundenauswertung'
] as const;
export type FeatureKey = typeof FEATURES[number];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  zeiterfassung: "Zeiterfassung",
  projekte: "Projekte",
  meine_stunden: "Meine Stunden",
  regieberichte: "Regieberichte",
  rechnungen: "Rechnungen & Angebote",
  kalender: "Kalender",
  plantafel: "Plantafel",
  bautagesberichte: "Bautagesberichte",
  ersttermine: "Ersttermine",
  protokolle: "Besprechungsprotokolle",
  kunden: "Kunden",
  materialien: "Materialien",
  admin: "Admin-Bereich",
  stundenauswertung: "Stundenauswertung",
};

// Map routes to features for ProtectedRoute
export const ROUTE_FEATURE_MAP: Record<string, FeatureKey> = {
  '/time-tracking': 'zeiterfassung',
  '/projects': 'projekte',
  '/my-hours': 'meine_stunden',
  '/disturbances': 'regieberichte',
  '/invoices': 'rechnungen',
  '/calendar': 'kalender',
  '/schedule': 'plantafel',
  '/bautagesberichte': 'bautagesberichte',
  '/ersttermine-interessent': 'ersttermine',
  '/ersttermine-projekt': 'ersttermine',
  '/besprechungsprotokolle': 'protokolle',
  '/customers': 'kunden',
  '/materials': 'materialien',
  '/admin': 'admin',
  '/hours-report': 'stundenauswertung',
};

type PermsMap = Record<string, { can_view: boolean; can_edit: boolean }>;

export function usePermissions() {
  const [perms, setPerms] = useState<PermsMap>({});
  const [userRole, setUserRole] = useState<string>("mitarbeiter");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: rd } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    const role = rd?.role || "mitarbeiter";
    setUserRole(role);

    const { data: pd } = await (supabase.from("role_permissions" as never) as any)
      .select("feature, can_view, can_edit")
      .eq("role", role);

    const map: PermsMap = {};
    for (const f of FEATURES) map[f] = { can_view: false, can_edit: false };
    if (pd) {
      for (const r of pd) {
        if (map[r.feature]) {
          map[r.feature] = { can_view: r.can_view, can_edit: r.can_edit };
        }
      }
    }
    setPerms(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel("perms-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "role_permissions" },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const canView = useCallback((f: FeatureKey) => perms[f]?.can_view ?? false, [perms]);
  const canEdit = useCallback((f: FeatureKey) => perms[f]?.can_edit ?? false, [perms]);
  const isAdmin = userRole === "administrator";

  return { canView, canEdit, isAdmin, userRole, loading, refetch: load };
}

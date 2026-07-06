import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import {
  FileText, Receipt, AlertTriangle, Euro, TrendingUp, FileDown,
  FolderKanban, Wrench, UserPlus, Users, Clock,
} from "lucide-react";

type Tile = {
  key: string; label: string; value: string; sub?: string;
  icon: React.ReactNode; accent: string; to?: string;
};

const PAYABLE = new Set(["rechnung", "anzahlungsrechnung", "schlussrechnung"]);
const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const today = () => new Date().toISOString().slice(0, 10);

export default function KpiDashboard() {
  const navigate = useNavigate();
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const t: Tile[] = [];
      const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
        try { return await fn(); } catch { return fallback; }
      };

      // --- invoices (Angebote + Rechnungen + Forderungen + Umsatz) ---
      const yearStart = `${new Date().getFullYear()}-01-01`;
      const invoices = await safe(async () => {
        const { data } = await supabase.from("invoices")
          .select("typ,status,brutto_summe,bezahlt_betrag,faellig_am,datum");
        return data || [];
      }, [] as any[]);

      const offeneAngebote = invoices.filter((i) => i.typ === "angebot" && i.status === "offen").length;
      const offeneRechnungen = invoices.filter((i) => PAYABLE.has(i.typ) && ["offen", "teilbezahlt"].includes(i.status)).length;
      const ueberfaellig = invoices.filter((i) => PAYABLE.has(i.typ) && ["offen", "teilbezahlt"].includes(i.status) && i.faellig_am && i.faellig_am < today()).length;
      const offeneSumme = invoices
        .filter((i) => PAYABLE.has(i.typ) && ["offen", "teilbezahlt"].includes(i.status))
        .reduce((s, i) => s + (Number(i.brutto_summe) || 0) - (Number(i.bezahlt_betrag) || 0), 0);
      const umsatzBezahlt = invoices
        .filter((i) => PAYABLE.has(i.typ) && ["bezahlt", "teilbezahlt"].includes(i.status) && i.datum >= yearStart)
        .reduce((s, i) => s + (Number(i.bezahlt_betrag) || 0), 0);

      t.push({ key: "angebote", label: "Offene Angebote", value: String(offeneAngebote), icon: <FileText className="h-5 w-5" />, accent: "text-blue-600 bg-blue-500/10", to: "/invoices" });
      t.push({ key: "rechnungen", label: "Offene Rechnungen", value: String(offeneRechnungen), icon: <Receipt className="h-5 w-5" />, accent: "text-primary bg-primary/10", to: "/invoices" });
      t.push({ key: "ueberfaellig", label: "Überfällige Rechnungen", value: String(ueberfaellig), icon: <AlertTriangle className="h-5 w-5" />, accent: "text-red-600 bg-red-500/10", to: "/invoices" });
      t.push({ key: "forderung", label: "Offener Betrag", value: eur(offeneSumme), icon: <Euro className="h-5 w-5" />, accent: "text-amber-600 bg-amber-500/10", to: "/invoices" });
      t.push({ key: "umsatz", label: "Umsatz bezahlt (Jahr)", value: eur(umsatzBezahlt), icon: <TrendingUp className="h-5 w-5" />, accent: "text-emerald-600 bg-emerald-500/10", to: "/invoices" });

      // --- purchase invoices ---
      const pInv = await safe(async () => {
        const { data } = await supabase.from("purchase_invoices").select("betrag_brutto,status,verrechnet_am");
        return data || [];
      }, [] as any[]);
      const erOffen = pInv.filter((p) => p.status === "offen" && !p.verrechnet_am);
      t.push({ key: "eingang", label: "Eingangsrechn. offen", value: String(erOffen.length), sub: eur(erOffen.reduce((s, p) => s + (Number(p.betrag_brutto) || 0), 0)), icon: <FileDown className="h-5 w-5" />, accent: "text-sky-600 bg-sky-500/10", to: "/eingangsrechnungen" });

      // --- operations ---
      const aktiveProjekte = await safe(async () => {
        const { count } = await supabase.from("projects").select("id", { count: "exact", head: true }).not("status", "eq", "Abgeschlossen");
        return count || 0;
      }, 0);
      t.push({ key: "projekte", label: "Aktive Projekte", value: String(aktiveProjekte), icon: <FolderKanban className="h-5 w-5" />, accent: "text-indigo-600 bg-indigo-500/10", to: "/projects" });

      const offeneStoerungen = await safe(async () => {
        const { count } = await supabase.from("disturbances").select("id", { count: "exact", head: true }).eq("status", "offen");
        return count || 0;
      }, 0);
      t.push({ key: "stoerungen", label: "Offene Regieberichte", value: String(offeneStoerungen), icon: <Wrench className="h-5 w-5" />, accent: "text-yellow-600 bg-yellow-500/10", to: "/disturbances" });

      const ersttermine = await safe(async () => {
        const { count } = await supabase.from("ersttermin_interessent").select("id", { count: "exact", head: true }).gte("datum", today());
        return count || 0;
      }, 0);
      t.push({ key: "ersttermine", label: "Anstehende Ersttermine", value: String(ersttermine), icon: <UserPlus className="h-5 w-5" />, accent: "text-violet-600 bg-violet-500/10", to: "/ersttermine" });

      // --- team ---
      const aktiveMa = await safe(async () => {
        const { count } = await supabase.from("employees").select("id", { count: "exact", head: true }).eq("aktiv", true);
        return count || 0;
      }, 0);
      t.push({ key: "mitarbeiter", label: "Aktive Mitarbeiter", value: String(aktiveMa), icon: <Users className="h-5 w-5" />, accent: "text-primary bg-primary/10", to: "/admin" });

      const stundenHeute = await safe(async () => {
        const { data } = await supabase.from("time_entries").select("stunden").eq("datum", today());
        return (data || []).reduce((s, e: { stunden: number }) => s + (Number(e.stunden) || 0), 0);
      }, 0);
      t.push({ key: "stunden", label: "Stunden heute", value: `${stundenHeute.toLocaleString("de-DE", { maximumFractionDigits: 1 })} h`, icon: <Clock className="h-5 w-5" />, accent: "text-teal-600 bg-teal-500/10", to: "/hours-report" });

      if (alive) { setTiles(t); setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      {tiles.map((tile) => (
        <Card
          key={tile.key}
          className={`transition-all hover:shadow-md ${tile.to ? "cursor-pointer hover:border-primary/40" : ""}`}
          onClick={() => tile.to && navigate(tile.to)}
        >
          <CardContent className="p-3 sm:p-4">
            <div className={`h-9 w-9 rounded-lg flex items-center justify-center mb-2 ${tile.accent}`}>{tile.icon}</div>
            <div className="text-xl sm:text-2xl font-bold leading-tight truncate">{tile.value}</div>
            {tile.sub && <div className="text-xs font-medium text-muted-foreground">{tile.sub}</div>}
            <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{tile.label}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

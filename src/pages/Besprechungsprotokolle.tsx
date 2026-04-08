import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FileText, Plus, Calendar, Filter, Search, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { PageHeader } from "@/components/PageHeader";

type Protokoll = {
  id: string;
  datum: string;
  nummer: string | null;
  typ: string | null;
  customer_id: string | null;
  project_id: string | null;
  ort: string | null;
  status: string;
  created_at: string;
  customer_name?: string;
  project_name?: string;
};

const Besprechungsprotokolle = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectFilter = searchParams.get("project");
  const { toast } = useToast();
  const [protokolle, setProtokolle] = useState<Protokoll[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("alle");

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { navigate("/auth"); return; }
    fetchProtokolle();
  };

  const fetchProtokolle = async () => {
    setLoading(true);
    let query = (supabase.from("besprechungsprotokolle" as never) as any)
      .select("*")
      .order("datum", { ascending: false });
    if (projectFilter) query = query.eq("project_id", projectFilter);
    const { data, error } = await query;

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Protokolle konnten nicht geladen werden" });
      setLoading(false);
      return;
    }

    if (data && data.length > 0) {
      const items = data as Protokoll[];
      const customerIds = [...new Set(items.map((p) => p.customer_id).filter(Boolean))];
      const projectIds = [...new Set(items.map((p) => p.project_id).filter(Boolean))];

      let customerMap = new Map<string, string>();
      let projectMap = new Map<string, string>();

      if (customerIds.length > 0) {
        const { data: customers } = await supabase.from("customers").select("id, name").in("id", customerIds as string[]);
        customerMap = new Map(customers?.map((c) => [c.id, c.name]) || []);
      }
      if (projectIds.length > 0) {
        const { data: projects } = await supabase.from("projects").select("id, name").in("id", projectIds as string[]);
        projectMap = new Map(projects?.map((p) => [p.id, p.name]) || []);
      }

      setProtokolle(items.map((p) => ({
        ...p,
        customer_name: p.customer_id ? customerMap.get(p.customer_id) || "" : "",
        project_name: p.project_id ? projectMap.get(p.project_id) || "" : "",
      })));
    } else {
      setProtokolle([]);
    }
    setLoading(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "entwurf": return <Badge variant="secondary">Entwurf</Badge>;
      case "abgeschlossen": return <Badge className="bg-blue-500 text-white">Abgeschlossen</Badge>;
      case "versendet": return <Badge className="bg-green-500 text-white">Versendet</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getTypBadge = (typ: string | null) => {
    if (!typ) return null;
    return <Badge variant="outline" className="text-xs">{typ}</Badge>;
  };

  const filtered = protokolle.filter((p) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      (p.customer_name || "").toLowerCase().includes(q) ||
      (p.project_name || "").toLowerCase().includes(q) ||
      (p.nummer || "").toLowerCase().includes(q) ||
      (p.ort || "").toLowerCase().includes(q);
    const matchesStatus = true;
    return matchesSearch && matchesStatus;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Besprechungsprotokolle" />
      <main className="container mx-auto px-4 py-6 max-w-4xl">
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileText className="h-6 w-6 text-primary" />
              Besprechungsprotokolle
            </h1>
            <p className="text-muted-foreground">Protokolle erfassen und verwalten</p>
          </div>
          <Button onClick={() => navigate("/besprechungsprotokolle/neu")} className="gap-2">
            <Plus className="h-4 w-4" />
            Neues Protokoll
          </Button>
        </div>

        <Card className="mb-6">
          <CardContent className="pt-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Suche nach Kunde, Projekt, Nummer, Ort..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="alle">Alle Status</SelectItem>
                  <SelectItem value="entwurf">Entwurf</SelectItem>
                  <SelectItem value="abgeschlossen">Abgeschlossen</SelectItem>
                  <SelectItem value="versendet">Versendet</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">Keine Protokolle gefunden</h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery || statusFilter !== "alle"
                  ? "Keine Protokolle entsprechen Ihren Filterkriterien"
                  : "Erstellen Sie Ihr erstes Besprechungsprotokoll"}
              </p>
              {!searchQuery && statusFilter === "alle" && (
                <Button onClick={() => navigate("/besprechungsprotokolle/neu")} variant="outline">
                  <Plus className="h-4 w-4 mr-2" />
                  Erstes Protokoll erstellen
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filtered.map((p) => (
              <Card
                key={p.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(`/besprechungsprotokolle/${p.id}`)}
              >
                <CardContent className="pt-4">
                  <div className="flex flex-col sm:flex-row gap-4 justify-between">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold text-lg">
                            {p.customer_name || p.project_name || "Ohne Zuordnung"}
                          </h3>
                          {p.nummer && <p className="text-sm text-muted-foreground">Nr. {p.nummer}</p>}
                        </div>
                        <div className="flex gap-2">
                          {getTypBadge(p.typ)}
                          {getStatusBadge(p.status)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          {format(new Date(p.datum), "dd.MM.yyyy", { locale: de })}
                        </span>
                        {p.project_name && p.customer_name && (
                          <span className="text-sm">{p.project_name}</span>
                        )}
                        {p.ort && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-4 w-4" />
                            {p.ort}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Besprechungsprotokolle;

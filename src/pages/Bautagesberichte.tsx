import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, Plus, Calendar, Cloud, Filter, Search } from "lucide-react";
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

type Bautagesbericht = {
  id: string;
  datum: string;
  nummer: string | null;
  project_id: string | null;
  wetter: string | null;
  status: string;
  bauleiter: string | null;
  created_at: string;
  project_name?: string;
};

const Bautagesberichte = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [berichte, setBerichte] = useState<Bautagesbericht[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("alle");

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/auth");
      return;
    }
    fetchBerichte();
  };

  const fetchBerichte = async () => {
    setLoading(true);

    const { data, error } = await (supabase.from("bautagesberichte" as never) as any)
      .select("*")
      .order("datum", { ascending: false });

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Bautagesberichte konnten nicht geladen werden",
      });
      setLoading(false);
      return;
    }

    if (data && data.length > 0) {
      const projectIds = [...new Set((data as Bautagesbericht[]).map((b) => b.project_id).filter(Boolean))];
      let projectMap = new Map<string, string>();

      if (projectIds.length > 0) {
        const { data: projects } = await supabase
          .from("projects")
          .select("id, name")
          .in("id", projectIds as string[]);
        projectMap = new Map(projects?.map((p) => [p.id, p.name]) || []);
      }

      const enriched = (data as Bautagesbericht[]).map((b) => ({
        ...b,
        project_name: b.project_id ? projectMap.get(b.project_id) || "" : "",
      }));
      setBerichte(enriched);
    } else {
      setBerichte([]);
    }

    setLoading(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "entwurf":
        return <Badge variant="secondary">Entwurf</Badge>;
      case "abgeschlossen":
        return <Badge className="bg-blue-500 text-white">Abgeschlossen</Badge>;
      case "unterschrieben":
        return <Badge className="bg-green-500 text-white">Unterschrieben</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const filteredBerichte = berichte.filter((b) => {
    const matchesSearch =
      (b.project_name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (b.nummer || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (b.bauleiter || "").toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === "alle" || b.status === statusFilter;

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
      <PageHeader title="Bautagesberichte" />

      <main className="container mx-auto px-4 py-6 max-w-4xl">
        {/* Header with action button */}
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ClipboardList className="h-6 w-6 text-primary" />
              Bautagesberichte
            </h1>
            <p className="text-muted-foreground">Tagesberichte erfassen und verwalten</p>
          </div>
          <Button onClick={() => navigate("/bautagesberichte/neu")} className="gap-2">
            <Plus className="h-4 w-4" />
            Neuer Bericht
          </Button>
        </div>

        {/* Filter Section */}
        <Card className="mb-6">
          <CardContent className="pt-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Suche nach Projekt, Nummer, Bauleiter..."
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
                  <SelectItem value="unterschrieben">Unterschrieben</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Berichte List */}
        {filteredBerichte.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <ClipboardList className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">Keine Berichte gefunden</h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery || statusFilter !== "alle"
                  ? "Keine Berichte entsprechen Ihren Filterkriterien"
                  : "Erstellen Sie Ihren ersten Bautagesbericht"}
              </p>
              {!searchQuery && statusFilter === "alle" && (
                <Button onClick={() => navigate("/bautagesberichte/neu")} variant="outline">
                  <Plus className="h-4 w-4 mr-2" />
                  Ersten Bericht erfassen
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredBerichte.map((bericht) => (
              <Card
                key={bericht.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(`/bautagesberichte/${bericht.id}`)}
              >
                <CardContent className="pt-4">
                  <div className="flex flex-col sm:flex-row gap-4 justify-between">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold text-lg">
                            {bericht.project_name || "Kein Projekt"}
                          </h3>
                          {bericht.nummer && (
                            <p className="text-sm text-muted-foreground">Nr. {bericht.nummer}</p>
                          )}
                        </div>
                        {getStatusBadge(bericht.status)}
                      </div>

                      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          {format(new Date(bericht.datum), "dd.MM.yyyy", { locale: de })}
                        </span>
                        {bericht.wetter && (
                          <span className="flex items-center gap-1">
                            <Cloud className="h-4 w-4" />
                            {bericht.wetter}
                          </span>
                        )}
                        {bericht.bauleiter && (
                          <span className="text-sm">{bericht.bauleiter}</span>
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

export default Bautagesberichte;

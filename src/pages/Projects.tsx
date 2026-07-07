import { useEffect, useState, useRef } from "react";
import { ArrowLeft, FolderOpen, Plus, FileText, Image, Package, Lock, Search, Upload, Camera, Trash2, ChevronDown, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { QuickUploadDialog } from "@/components/QuickUploadDialog";
import { MobilePhotoCapture } from "@/components/MobilePhotoCapture";
import { useProjectStatuses, type ProjectStatus } from "@/hooks/useProjectStatuses";
import { useConfigOptions } from "@/hooks/useConfigOptions";
import { mergeDuplicateProjects } from "@/lib/mergeDuplicateProjects";

type Project = {
  id: string;
  name: string;
  beschreibung: string | null;
  adresse: string | null;
  plz: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  projektart: string | null;
  prioritaet: string | null;
  geplanter_start: string | null;
  geplantes_ende: string | null;
  budget: number | null;
  auftragsvolumen: number | null;
  bauleiter_id: string | null;
  ort: string | null;
  kategorie?: string | null;
  // Haupt-/Unterprojekt-Verknüpfung (Migration 20260615200000)
  projekt_typ?: string | null;
  parent_project_id?: string | null;
};

/**
 * Status, bei denen ein Projekt als „archiviert" gilt und aus der aktiven
 * Liste in den Archiv-Reiter wandert (User-Feedback 26.06.2026).
 */
const ARCHIVED_STATUSES = new Set(["abgeschlossen", "storniert"]);
const isArchivedStatus = (status?: string | null) =>
  ARCHIVED_STATUSES.has((status || "").toLowerCase());

/** Geschäftsbereich → Google-Kalender. 7 Kategorien + Default. */
const KATEGORIE_META: Record<string, { label: string; color: string; bg: string }> = {
  montipro:     { label: "ePower GmbH",     color: "#166534", bg: "#dcfce7" },
  bks:          { label: "ePower",           color: "#1e40af", bg: "#dbeafe" },
  gartenmacher: { label: "Gartenmacher",  color: "#3f6212", bg: "#ecfccb" },
  fensterwerk:  { label: "Fensterwerk",   color: "#155e75", bg: "#cffafe" },
  ladenbau:     { label: "Ladenbau",      color: "#92400e", bg: "#fef3c7" },
  portas:       { label: "Portas",        color: "#9a3412", bg: "#ffedd5" },
  chef:         { label: "CHEF",          color: "#6b21a8", bg: "#f3e8ff" },
};

const Projects = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [newProject, setNewProject] = useState({
    name: "",
    beschreibung: "",
    adresse: "",
    plz: "",
  });
  const [quickUploadProject, setQuickUploadProject] = useState<{
    projectId: string;
    documentType: 'photos' | 'plans' | 'reports' | 'materials';
  } | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<{id: string, name: string} | null>(null);
  const [showCameraDialog, setShowCameraDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [bereichFilter, setBereichFilter] = useState<string>("all");
  // Reiter "Aktiv" vs "Archiv" (abgeschlossene/stornierte Projekte).
  const [archiveTab, setArchiveTab] = useState<"aktiv" | "archiv">("aktiv");
  // Aufgeklappte Hauptprojekte — zeigen ihre Unterprojekte inline.
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Sortierung der Projektliste — clientseitig (Daten sind eh schon geladen).
  // Default „created_desc" entspricht dem heutigen Server-Order.
  type SortKey = "created_desc" | "start_asc" | "start_desc" | "name_asc";
  const [sortKey, setSortKey] = useState<SortKey>("created_desc");
  const { statuses: projectStatuses, findByName } = useProjectStatuses();
  const { options: bereichOptions } = useConfigOptions("projekt_bereich");

  useEffect(() => {
    checkAdminStatus();

    // Einmal beim Öffnen der Projekte-Seite: Duplikate automatisch
    // zusammenführen (gleicher Name + gleicher Kunde). Danach Projekte laden.
    (async () => {
      try {
        const result = await mergeDuplicateProjects();
        if (result.projectsRemoved > 0) {
          toast({
            title: "Duplikate zusammengeführt",
            description: `${result.projectsRemoved} doppelte${result.projectsRemoved === 1 ? "s" : ""} Projekt${result.projectsRemoved === 1 ? "" : "e"} wurde${result.projectsRemoved === 1 ? "" : "n"} automatisch mit dem ältesten Eintrag verknüpft${result.details.length > 0 ? ": " + result.details.slice(0, 3).join(", ") + (result.details.length > 3 ? " …" : "") : ""}`,
          });
        }
      } catch { /* silent — schlägt Cleanup fehl, normal weitermachen */ }
      fetchProjects();
    })();

    // Realtime subscription
    const channel = supabase
      .channel('projects-list-changes')
      .on('postgres_changes', { event: '*', schema: 'hws', table: 'projects' }, () => {
        fetchProjects();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const checkAdminStatus = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Base role only determines admin actions (no overrides)

    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    setIsAdmin(data?.role === "administrator");
  };

  const fetchProjects = async () => {
    // Zentrales RPC: liefert die für den eingeloggten User sichtbaren
    // Projekte. Admin/Vorarbeiter sehen alle; Mitarbeiter nur ihre
    // zugewiesenen. Auch abgeschlossene werden geladen — der Status-
    // Toggle in der UI filtert clientseitig und braucht die Daten.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: rpcData, error: rpcErr } = await (supabase.rpc as any)(
      "list_accessible_project_ids_for_user",
      { p_user_id: user.id, p_only_active: false },
    );
    if (rpcErr) {
      console.error("list_accessible_project_ids_for_user:", rpcErr);
      // Fallback: RLS-gefilterter Direktzugriff
      const { data } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
      setProjects(data || []);
      setLoading(false);
      return;
    }
    const ids = ((rpcData as any[]) || []).map((p: any) => p.id);
    if (ids.length === 0) {
      setProjects([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("projects")
      .select("*")
      .in("id", ids)
      .order("created_at", { ascending: false });
    setProjects(data || []);
    setLoading(false);
  };

  const handleCreateProject = async () => {
    if (!newProject.name.trim()) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Projektname ist erforderlich",
      });
      return;
    }

    if (!newProject.plz.trim()) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "PLZ ist erforderlich",
      });
      return;
    }

    if (!/^\d{4,5}$/.test(newProject.plz.trim())) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "PLZ muss 4-5 Ziffern enthalten",
      });
      return;
    }

    const { error } = await supabase
      .from("projects")
      .insert({
        name: newProject.name.trim(),
        beschreibung: newProject.beschreibung.trim() || null,
        adresse: newProject.adresse.trim() || null,
        plz: newProject.plz.trim(),
      });

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Projekt konnte nicht erstellt werden",
      });
    } else {
      toast({
        title: "Erfolg",
        description: "Projekt wurde erstellt",
      });
      setNewProject({ name: "", beschreibung: "", adresse: "", plz: "" });
      setShowNewDialog(false);
      fetchProjects();
    }
  };

  const updateProjectStatus = async (projectId: string, newStatus: string, projectName: string) => {
    if (togglingStatus) return;
    setTogglingStatus(projectId);

    const { error } = await supabase
      .from("projects")
      .update({ status: newStatus })
      .eq("id", projectId);

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Projekt konnte nicht aktualisiert werden",
      });
      setTogglingStatus(null);
    } else {
      toast({
        title: "Status aktualisiert",
        description: `${projectName} → ${newStatus}`,
      });
      fetchProjects();
      setTogglingStatus(null);
    }
  };

  const handleDeleteProject = async () => {
    if (!projectToDelete || deleting) return;
    setDeleting(true);

    const { id, name } = projectToDelete;
    
    try {
      // Delete all files from storage buckets
      const buckets = ['project-plans', 'project-reports', 'project-materials', 'project-photos'];
      
      for (const bucket of buckets) {
        const { data: files } = await supabase.storage
          .from(bucket)
          .list(id);
        
        if (files && files.length > 0) {
          const filePaths = files.map(file => `${id}/${file.name}`);
          await supabase.storage
            .from(bucket)
            .remove(filePaths);
        }
      }

      // Delete documents entries
      await supabase
        .from('documents')
        .delete()
        .eq('project_id', id);

      // Set project_id to null in time_entries and reports
      await supabase
        .from('time_entries')
        .update({ project_id: null })
        .eq('project_id', id);

      await supabase
        .from('reports')
        .update({ project_id: null })
        .eq('project_id', id);

      // Finally delete the project
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Erfolg",
        description: `Projekt "${name}" wurde erfolgreich gelöscht`,
      });
    } catch (error) {
      console.error('Delete error:', error);
      toast({
        title: "Fehler",
        description: "Projekt konnte nicht vollständig gelöscht werden",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
      setProjectToDelete(null);
    }
  };

  const handlePhotoCapture = async (file: File) => {
    if (!quickUploadProject) {
      throw new Error("Kein Projekt ausgewählt");
    }

    const timestamp = Date.now();
    const filePath = `${quickUploadProject.projectId}/${timestamp}_${file.name}`;
    
    const { error: uploadError } = await supabase
      .storage
      .from('project-photos')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase
      .storage
      .from('project-photos')
      .getPublicUrl(filePath);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Nicht angemeldet");

    const { error: dbError } = await supabase
      .from('documents')
      .insert({
        user_id: user.id,
        project_id: quickUploadProject.projectId,
        typ: 'photos',
        name: file.name,
        file_url: publicUrl,
        beschreibung: 'Foto hochgeladen',
      });

    if (dbError) throw dbError;

    setQuickUploadProject(null);
    fetchProjects();
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 60) return `vor ${diffMins} Min.`;
    if (diffMins < 1440) return `vor ${Math.floor(diffMins / 60)} Std.`;
    if (diffMins < 2880) return "Gestern";
    return date.toLocaleDateString("de-DE");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Lädt...</p>
      </div>
    );
  }

  // Aktiv- vs Archiv-Reiter: abgeschlossene/stornierte Projekte gehören ins Archiv.
  const activeProjects = projects.filter((p) => !isArchivedStatus(p.status));
  const archivedProjects = projects.filter((p) => isArchivedStatus(p.status));
  const tabProjects = archiveTab === "archiv" ? archivedProjects : activeProjects;

  // Ein Unterprojekt wird nur dann als Top-Level-Karte AUSGEBLENDET, wenn sein
  // Hauptprojekt IM SELBEN Reiter sichtbar ist (dann klappt es dort auf). Liegt
  // das Hauptprojekt im anderen Reiter, ist es kein Hauptprojekt (mehr) oder
  // fehlt ganz (Waise), erscheint das Unterprojekt als eigene Karte im
  // passenden Reiter — sonst wäre es dort unauffindbar.
  const hauptIdsInList = (list: Project[]) =>
    new Set(list.filter((p) => p.projekt_typ === "hauptprojekt").map((p) => p.id));
  const activeHauptIds = hauptIdsInList(activeProjects);
  const archivedHauptIds = hauptIdsInList(archivedProjects);
  const tabHauptIds = archiveTab === "archiv" ? archivedHauptIds : activeHauptIds;
  const isTopLevel = (p: Project, hauptSet: Set<string>) =>
    p.projekt_typ !== "unterprojekt" ||
    !(p.parent_project_id && hauptSet.has(p.parent_project_id));
  // Zähler = tatsächlich sichtbare Top-Level-Karten (nicht inkl. eingeklappter Subs).
  const activeTopLevelCount = activeProjects.filter((p) => isTopLevel(p, activeHauptIds)).length;
  const archivedTopLevelCount = archivedProjects.filter((p) => isTopLevel(p, archivedHauptIds)).length;
  const tabTopLevel = tabProjects.filter((p) => isTopLevel(p, tabHauptIds));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
                <Home className="h-5 w-5" />
              </Button>
              <h1 className="text-lg sm:text-xl font-bold">Projekte</h1>
            </div>
            <Button size="sm" className="gap-1 sm:gap-2" onClick={() => setShowNewDialog(true)}>
              <Plus className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Neues Projekt</span>
              <span className="sm:hidden">Neu</span>
            </Button>
            <CreateProjectDialog
              open={showNewDialog}
              onClose={() => setShowNewDialog(false)}
              onCreated={() => { setShowNewDialog(false); fetchProjects(); }}
            />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 max-w-6xl">
        <div className="mb-4 sm:mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold mb-1 sm:mb-2">Projekte</h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Bauvorhaben verwalten und dokumentieren
          </p>
        </div>

        {/* Reiter: Aktiv / Archiv */}
        <div className="mb-3 flex items-center gap-1 border-b">
          <button
            type="button"
            onClick={() => { setArchiveTab("aktiv"); setStatusFilter("all"); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              archiveTab === "aktiv"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Aktiv <span className="opacity-70">({activeTopLevelCount})</span>
          </button>
          <button
            type="button"
            onClick={() => { setArchiveTab("archiv"); setStatusFilter("all"); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              archiveTab === "archiv"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            🗄️ Archiv <span className="opacity-70">({archivedTopLevelCount})</span>
          </button>
        </div>

        {/* Status-Filter (nur Status, die im aktuellen Reiter vorkommen) */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge
            variant={statusFilter === "all" ? "default" : "outline"}
            className="cursor-pointer select-none"
            onClick={() => setStatusFilter("all")}
          >
            Alle
            <span className="ml-1.5 opacity-70">({tabTopLevel.length})</span>
          </Badge>
          {projectStatuses.map((s) => {
            const count = tabTopLevel.filter((p) => (p.status || "").toLowerCase() === s.name.toLowerCase()).length;
            if (count === 0 && statusFilter !== s.name) return null;
            const isActive = statusFilter === s.name;
            return (
              <Badge
                key={s.id}
                className="cursor-pointer select-none border"
                style={
                  isActive
                    ? { backgroundColor: s.farbe_bg, color: s.farbe_text, borderColor: s.farbe_bg }
                    : { backgroundColor: "transparent", color: s.farbe_bg, borderColor: s.farbe_bg }
                }
                onClick={() => setStatusFilter(s.name)}
              >
                {s.name}
                <span className="ml-1.5 opacity-70">({count})</span>
              </Badge>
            );
          })}
        </div>
        {/* Bereich-Filter (nur anzeigen wenn Projekte mit bereich existieren) */}
        {projects.some((p) => (p as any).bereich) && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Bereich:</span>
            <Badge
              variant={bereichFilter === "all" ? "default" : "outline"}
              className="cursor-pointer select-none"
              onClick={() => setBereichFilter("all")}
            >
              Alle
            </Badge>
            {bereichOptions.map((o) => {
              const count = projects.filter((p) => (p as any).bereich === o.wert).length;
              if (count === 0 && bereichFilter !== o.wert) return null;
              return (
                <Badge
                  key={o.id}
                  variant={bereichFilter === o.wert ? "default" : "outline"}
                  className="cursor-pointer select-none"
                  onClick={() => setBereichFilter(o.wert)}
                >
                  {o.label}
                  <span className="ml-1.5 opacity-70">({count})</span>
                </Badge>
              );
            })}
          </div>
        )}

        <div className="mb-4 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Projekte durchsuchen..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger className="w-full sm:w-[260px]">
              <SelectValue placeholder="Sortierung" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created_desc">Zuletzt erstellt</SelectItem>
              <SelectItem value="start_asc">Projektbeginn (frühester zuerst)</SelectItem>
              <SelectItem value="start_desc">Projektbeginn (spätester zuerst)</SelectItem>
              <SelectItem value="name_asc">Projektname (A–Z)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-3 sm:gap-4 lg:gap-6">
          {(() => {
            const filtered = tabProjects.filter((project) => {
              // Unterprojekte nur ausblenden, wenn ihr Hauptprojekt IM SELBEN
              // Reiter sichtbar ist (dann erscheinen sie dort aufgeklappt).
              // Sonst als eigene Karte zeigen, damit nichts unauffindbar wird.
              if (!isTopLevel(project, tabHauptIds)) return false;

              const q = searchQuery.toLowerCase();
              const matchesSearch =
                project.name.toLowerCase().includes(q) ||
                (project.adresse || "").toLowerCase().includes(q) ||
                (project.beschreibung || "").toLowerCase().includes(q);
              const matchesStatus =
                statusFilter === "all" || (project.status || "").toLowerCase() === statusFilter.toLowerCase();
              const matchesBereich =
                bereichFilter === "all" || (project as any).bereich === bereichFilter;
              return matchesSearch && matchesStatus && matchesBereich;
            }).slice().sort((a, b) => {
              switch (sortKey) {
                case "start_asc":
                case "start_desc": {
                  // NULL-Daten ans Ende — Projekte ohne geplanten Start zuletzt.
                  const av = a.geplanter_start || null;
                  const bv = b.geplanter_start || null;
                  if (!av && !bv) return 0;
                  if (!av) return 1;
                  if (!bv) return -1;
                  return sortKey === "start_asc"
                    ? av.localeCompare(bv)
                    : bv.localeCompare(av);
                }
                case "name_asc":
                  return (a.name || "").localeCompare(b.name || "", "de");
                case "created_desc":
                default:
                  return (b.created_at || "").localeCompare(a.created_at || "");
              }
            });

            if (filtered.length === 0) {
              return (
                <Card>
                  <CardContent className="py-12 text-center">
                    <FolderOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                    <p className="text-lg font-semibold mb-2">
                      {statusFilter === "all"
                        ? "Keine Projekte gefunden"
                        : `Keine Projekte mit Status "${statusFilter}"`}
                    </p>
                    <p className="text-sm text-muted-foreground mb-4">
                      {searchQuery ? "Kein Treffer für deine Suche" : "Erstelle dein erstes Projekt"}
                    </p>
                    <Button onClick={() => setShowNewDialog(true)}>
                      <Plus className="w-4 h-4 mr-2" />
                      Neues Projekt
                    </Button>
                  </CardContent>
                </Card>
              );
            }

            return filtered.map((project) => {
              const sColor = findByName(project.status);
              const isClosed = (project.status || "").toLowerCase() === "abgeschlossen";
              // Unterprojekte dieses Hauptprojekts (aus bereits geladenen Daten).
              const children = project.projekt_typ === "hauptprojekt"
                ? projects.filter((p) => p.parent_project_id === project.id)
                : [];
              const isExpanded = expandedParents.has(project.id);
              return (
                <div key={project.id}>
                <Card
                  className="border-2 hover:shadow-lg transition-all cursor-pointer"
                  onClick={() => navigate(`/projects/${project.id}`)}
                >
                  <CardHeader className="bg-primary/5 pb-3 sm:pb-4">
                    <div className="flex flex-col sm:flex-row sm:justify-between gap-3">
                      <div className="flex gap-2 sm:gap-3">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                          {isClosed ? (
                            <Lock className="w-5 h-5 sm:w-6 sm:h-6" />
                          ) : (
                            <FolderOpen className="w-5 h-5 sm:w-6 sm:h-6" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-base sm:text-xl truncate">{project.name}</CardTitle>
                            {children.length > 0 && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); toggleExpand(project.id); }}
                                className="shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
                                title={isExpanded ? "Unterprojekte einklappen" : "Unterprojekte anzeigen"}
                              >
                                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                                {children.length} {children.length === 1 ? "Unterprojekt" : "Unterprojekte"}
                              </button>
                            )}
                          </div>
                          {project.adresse && (
                            <CardDescription className="text-xs sm:text-sm">{project.adresse}</CardDescription>
                          )}
                          {(project as any).ort && !(project.adresse || "").includes((project as any).ort) && (
                            <CardDescription className="text-xs text-muted-foreground">{(project as any).ort}</CardDescription>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 self-start sm:self-center">
                        {(project as any).kategorie && KATEGORIE_META[(project as any).kategorie] && (
                          <Badge
                            className="whitespace-nowrap text-xs border-0"
                            style={{
                              backgroundColor: KATEGORIE_META[(project as any).kategorie].bg,
                              color: KATEGORIE_META[(project as any).kategorie].color,
                            }}
                          >
                            {KATEGORIE_META[(project as any).kategorie].label}
                          </Badge>
                        )}
                        {(project as any).bereich && (
                          <Badge variant="secondary" className="whitespace-nowrap text-xs">
                            {bereichOptions.find((o) => o.wert === (project as any).bereich)?.label || (project as any).bereich}
                          </Badge>
                        )}
                        {(project as any).projektart && (
                          <Badge variant="outline" className="whitespace-nowrap text-xs">
                            {(project as any).projektart}
                          </Badge>
                        )}
                        {(project as any).prioritaet && (project as any).prioritaet !== "normal" && (
                          <Badge
                            variant={
                              (project as any).prioritaet === "hoch" || (project as any).prioritaet === "dringend"
                                ? "destructive"
                                : "secondary"
                            }
                            className="whitespace-nowrap text-xs"
                          >
                            {(project as any).prioritaet}
                          </Badge>
                        )}
                        <Badge
                          className="whitespace-nowrap border-0"
                          style={
                            sColor
                              ? { backgroundColor: sColor.farbe_bg, color: sColor.farbe_text }
                              : { backgroundColor: "#e5e7eb", color: "#374151" }
                          }
                        >
                          {project.status || "–"}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-4 sm:pt-6">
                    {project.beschreibung && (
                      <p className="text-xs sm:text-sm text-muted-foreground mb-4 line-clamp-2">
                        {project.beschreibung}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2 sm:gap-3 mb-4">
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/5">
                        <FileText className="w-4 h-4 text-primary" />
                        <span className="text-xs font-medium">Pläne</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/5">
                        <FileText className="w-4 h-4 text-primary" />
                        <span className="text-xs font-medium">Berichte</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/5">
                        <Package className="w-4 h-4 text-primary" />
                        <span className="text-xs font-medium">Material</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/5">
                        <Image className="w-4 h-4 text-primary" />
                        <span className="text-xs font-medium">Fotos</span>
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/5">
                          <Lock className="w-4 h-4 text-primary" />
                          <span className="text-xs font-medium">Chef</span>
                        </div>
                      )}
                    </div>

                    {!isClosed && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full gap-2 mt-3"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Upload className="w-4 h-4" />
                            + Dateien hochladen
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-56 bg-background z-50">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setQuickUploadProject({ projectId: project.id, documentType: 'photos' }); setShowCameraDialog(true); }}>
                            <Camera className="w-4 h-4 mr-2" />
                            📸 Foto aufnehmen
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setQuickUploadProject({ projectId: project.id, documentType: 'photos' }); }}>
                            <Camera className="w-4 h-4 mr-2" />
                            📷 Fotos hochladen
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setQuickUploadProject({ projectId: project.id, documentType: 'plans' }); }}>
                            <FileText className="w-4 h-4 mr-2" />
                            📋 Pläne hochladen
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setQuickUploadProject({ projectId: project.id, documentType: 'reports' }); }}>
                            <FileText className="w-4 h-4 mr-2" />
                            📄 Regieberichte hochladen
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setQuickUploadProject({ projectId: project.id, documentType: 'materials' }); }}>
                            <Package className="w-4 h-4 mr-2" />
                            📦 Materiallisten hochladen
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}

                    <div
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t mt-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="text-xs text-muted-foreground">
                        Aktualisiert: {formatDate(project.updated_at)}
                      </p>
                      {isAdmin && projectStatuses.length > 0 && (
                        <div className="flex items-center gap-2 self-end sm:self-auto">
                          <Select
                            value={project.status || ""}
                            onValueChange={(val) => {
                              if (val && val !== project.status) {
                                updateProjectStatus(project.id, val, project.name);
                              }
                            }}
                            disabled={togglingStatus === project.id}
                          >
                            <SelectTrigger
                              className="h-8 w-[160px] text-xs"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <SelectValue placeholder="Status wählen" />
                            </SelectTrigger>
                            <SelectContent>
                              {projectStatuses.map((s) => (
                                <SelectItem key={s.id} value={s.name}>
                                  <span className="inline-flex items-center gap-2">
                                    <span
                                      className="h-2 w-2 rounded-full"
                                      style={{ backgroundColor: s.farbe_bg }}
                                    />
                                    {s.name}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {isClosed && (
                            <Button
                              variant="destructive"
                              size="sm"
                              className="text-xs"
                              onClick={() => setProjectToDelete({ id: project.id, name: project.name })}
                              disabled={deleting}
                            >
                              <Trash2 className="w-3 h-3 mr-1" />
                              {deleting ? 'Lösche...' : 'Löschen'}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
                {isExpanded && children.length > 0 && (
                  <div className="ml-6 sm:ml-10 mt-1 mb-1 space-y-1 border-l-2 border-primary/20 pl-3">
                    {children.map((child) => {
                      const cColor = findByName(child.status);
                      return (
                        <div
                          key={child.id}
                          onClick={() => navigate(`/projects/${child.id}`)}
                          className="flex items-center justify-between gap-2 rounded-md bg-muted/40 hover:bg-accent px-3 py-2 cursor-pointer"
                        >
                          <span className="text-sm truncate flex items-center gap-1.5 min-w-0">
                            <FolderOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate">{child.name}</span>
                          </span>
                          <Badge
                            className="whitespace-nowrap text-xs border-0 shrink-0"
                            style={cColor ? { backgroundColor: cColor.farbe_bg, color: cColor.farbe_text } : { backgroundColor: "#e5e7eb", color: "#374151" }}
                          >
                            {child.status || "–"}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
                </div>
              );
            });
          })()}
        </div>
      </main>

      {/* Quick Upload Dialog - Only show when NOT in camera mode */}
      {quickUploadProject && !showCameraDialog && (
        <QuickUploadDialog
          projectId={quickUploadProject.projectId}
          documentType={quickUploadProject.documentType}
          open={!!quickUploadProject}
          onClose={() => setQuickUploadProject(null)}
          onSuccess={() => {
            fetchProjects();
            setQuickUploadProject(null);
          }}
        />
      )}

      {/* Mobile Photo Capture Dialog */}
      <MobilePhotoCapture
        open={showCameraDialog}
        onClose={() => {
          setShowCameraDialog(false);
          setQuickUploadProject(null);
        }}
        onPhotoCapture={handlePhotoCapture}
      />

      {/* AlertDialog für Projekt löschen */}
      <AlertDialog open={!!projectToDelete} onOpenChange={(open) => !open && setProjectToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Projekt endgültig löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Bist du sicher, dass du das Projekt <strong>{projectToDelete?.name}</strong> unwiderruflich löschen möchtest?
              <br /><br />
              <span className="text-destructive font-semibold">Alle zugehörigen Dateien, Dokumente und Zuweisungen werden ebenfalls gelöscht.</span>
              <br /><br />
              Diese Aktion kann nicht rückgängig gemacht werden!
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteProject}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
            >
              {deleting ? 'Wird gelöscht...' : 'Ja, endgültig löschen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Projects;

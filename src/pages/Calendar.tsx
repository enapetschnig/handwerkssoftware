import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { RefreshCw, Plus, Calendar as CalIcon, Clock, MapPin, ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, isSameDay, isSameMonth } from "date-fns";
import { de } from "date-fns/locale";

type CalendarEvent = {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  description: string | null;
  mitarbeiter: string[] | null;
  all_day: boolean;
  calendar_type: string | null;
  google_event_id: string | null;
};

type Assignment = {
  id: string;
  datum: string;
  start_time: string | null;
  end_time: string | null;
  notizen: string | null;
  user_id: string;
  projects: { name: string; kategorie?: string | null } | null;
  profiles: { vorname: string; nachname: string } | null;
  kategorie?: string | null;
};

type EventFormData = {
  title: string;
  start_date: string;
  end_date: string;
  all_day: boolean;
  start_time: string;
  end_time: string;
  description: string;
  calendar_type: string;
};

const emptyFormData: EventFormData = {
  title: "",
  start_date: "",
  end_date: "",
  all_day: true,
  start_time: "08:00",
  end_time: "17:00",
  description: "",
  calendar_type: "allgemein",
};

/**
 * Meta-Info pro Kalender-Kategorie: UI-Label, Stilfarbe.
 * Wird verwendet für Badges, Farb-Streifen und Filter-Chips.
 * Die Keys entsprechen `calendar_type` aus DB/Edge Function.
 */
const KATEGORIE_META: Record<string, { label: string; badgeClass: string; barClass: string }> = {
  montipro:     { label: "Monti.pro",     badgeClass: "bg-green-100 text-green-800",  barClass: "bg-green-500" },
  bks:          { label: "BKS",           badgeClass: "bg-blue-100 text-blue-800",    barClass: "bg-blue-500" },
  gartenmacher: { label: "Gartenmacher",  badgeClass: "bg-lime-100 text-lime-800",    barClass: "bg-lime-500" },
  fensterwerk:  { label: "Fensterwerk",   badgeClass: "bg-cyan-100 text-cyan-800",    barClass: "bg-cyan-500" },
  ladenbau:     { label: "Ladenbau",      badgeClass: "bg-amber-100 text-amber-800",  barClass: "bg-amber-500" },
  portas:       { label: "Portas",        badgeClass: "bg-orange-100 text-orange-800",barClass: "bg-orange-500" },
  chef:         { label: "CHEF",          badgeClass: "bg-purple-100 text-purple-800",barClass: "bg-purple-500" },
  default:      { label: "Default",       badgeClass: "bg-slate-100 text-slate-700",  barClass: "bg-slate-400" },
  // Legacy-Keys (falls Events mit alten Typen noch in der DB sind)
  allgemein:    { label: "Allgemein",     badgeClass: "bg-slate-100 text-slate-700",  barClass: "bg-slate-400" },
  kleinigkeiten:{ label: "Kleinigkeiten", badgeClass: "bg-slate-100 text-slate-700",  barClass: "bg-slate-400" },
  baustellen:   { label: "Baustellen",    badgeClass: "bg-slate-100 text-slate-700",  barClass: "bg-slate-400" },
};

const katMeta = (type: string | null | undefined) =>
  KATEGORIE_META[type || "default"] || KATEGORIE_META.default;

export default function Calendar() {
  const { toast } = useToast();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [calendarId, setCalendarId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  // Event dialog state
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [formData, setFormData] = useState<EventFormData>(emptyFormData);
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingEvent, setDeletingEvent] = useState<CalendarEvent | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Kategorie-Filter: wenn eine Kategorie ausgeblendet ist, zeigen wir die
  // Events dieser Kategorie nicht. Default: alle aktiv.
  const [hiddenKats, setHiddenKats] = useState<Set<string>>(new Set());
  const toggleKat = (k: string) => {
    setHiddenKats(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };
  const isKatVisible = (k: string | null | undefined) => !hiddenKats.has(k || "default");

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Get role
    const { data: roleData } = await supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
    setUserRole(roleData?.role || null);

    // Get calendar ID from settings
    const { data: setting } = await supabase.from("app_settings").select("value").eq("key", "google_calendar_id").maybeSingle();
    setCalendarId(setting?.value || "");

    const monthStart = format(startOfMonth(currentMonth), "yyyy-MM-dd");
    const monthEnd = format(endOfMonth(currentMonth), "yyyy-MM-dd");

    // Fetch Einsätze (Plantafel-Einsätze) overlapping with month
    // — inkl. Projekt-Kategorie, damit im Viewer das richtige Badge
    // + die Filter-Chips wirken.
    const { data: einsatzData } = await supabase
      .from("einsaetze")
      .select("id, user_id, project_id, start_date, end_date, ganztaegig, start_time, end_time, beschreibung, google_event_id, projects(name, kategorie)")
      .lte("start_date", monthEnd)
      .gte("end_date", monthStart)
      .order("start_date");

    // Fetch calendar events
    const { data: eventData } = await supabase
      .from("calendar_events")
      .select("*")
      .gte("start_date", monthStart)
      .lte("start_date", monthEnd)
      .order("start_date");

    // Fetch profile names for einsaetze
    const userIds = [...new Set((einsatzData || []).map((e: any) => e.user_id))];
    let profileMap: Record<string, { vorname: string; nachname: string }> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, vorname, nachname")
        .in("id", userIds);
      (profiles || []).forEach((p: any) => {
        profileMap[p.id] = { vorname: p.vorname, nachname: p.nachname };
      });
    }

    // Expand einsaetze to one Assignment per day for existing UI
    const expandedAssignments: any[] = [];
    for (const e of einsatzData || []) {
      const s = new Date((e as any).start_date + "T12:00:00");
      const end = new Date((e as any).end_date + "T12:00:00");
      for (let d = new Date(s); d <= end; d.setDate(d.getDate() + 1)) {
        const datum = d.toISOString().split("T")[0];
        if (datum >= monthStart && datum <= monthEnd) {
          expandedAssignments.push({
            id: `${(e as any).id}_${datum}`,
            datum,
            start_time: (e as any).start_time,
            end_time: (e as any).end_time,
            notizen: (e as any).beschreibung,
            user_id: (e as any).user_id,
            google_event_id: (e as any).google_event_id,
            projects: (e as any).projects,
            profiles: profileMap[(e as any).user_id] || null,
            kategorie: (e as any).projects?.kategorie || "default",
          });
        }
      }
    }
    setAssignments(expandedAssignments);

    // Filter out calendar_events that are already shown as einsaetze
    // (to avoid duplicates when Plantafel syncs to Google and bidirectional sync imports them back)
    const assignmentGoogleIds = new Set(
      (einsatzData || []).map((e: any) => e.google_event_id).filter(Boolean)
    );
    setCalendarEvents(
      ((eventData || []) as CalendarEvent[]).filter(
        (e) => !e.google_event_id || !assignmentGoogleIds.has(e.google_event_id)
      )
    );
    setLoading(false);
  }, [currentMonth]);

  // Auto-sync on page load
  useEffect(() => {
    const autoSync = async () => {
      await loadData();
      // Trigger bidirectional sync in background on page load
      try {
        const { data, error } = await supabase.functions.invoke("google-calendar-sync?action=sync_bidirectional", {
          method: "GET",
        });
        if (!error && data?.success) {
          setLastSyncTime(new Date());
          // Reload data after sync
          await loadData();
        }
      } catch (e) {
        console.error("Auto-sync failed:", e);
      }
    };
    autoSync();
  }, []); // Only on mount

  // Reload data when month changes (but don't re-sync)
  useEffect(() => {
    loadData();
  }, [currentMonth, loadData]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("google-calendar-sync?action=sync_bidirectional", {
        method: "GET",
      });
      if (error) throw error;
      setLastSyncTime(new Date());
      toast({ title: "Kalender synchronisiert", description: `${data?.synced || 0} Events synchronisiert, ${data?.pushedToGoogle || 0} hochgeladen` });
      await loadData();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Sync fehlgeschlagen", description: err.message });
    } finally {
      setSyncing(false);
    }
  };

  // ─── Event CRUD ───────────────────────────────────────────

  const openCreateDialog = (date?: Date) => {
    const dateStr = date ? format(date, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
    setEditingEvent(null);
    setFormData({ ...emptyFormData, start_date: dateStr, end_date: dateStr });
    setEventDialogOpen(true);
  };

  const openEditDialog = (event: CalendarEvent) => {
    setEditingEvent(event);
    setFormData({
      title: event.title,
      start_date: event.start_date,
      end_date: event.end_date || event.start_date,
      all_day: event.all_day,
      start_time: event.start_time || "08:00",
      end_time: event.end_time || "17:00",
      description: event.description || "",
      calendar_type: event.calendar_type || "allgemein",
    });
    setEventDialogOpen(true);
  };

  const handleSaveEvent = async () => {
    if (!formData.title.trim() || !formData.start_date) {
      toast({ variant: "destructive", title: "Titel und Datum sind erforderlich" });
      return;
    }

    // Datum-Validierung: Ende darf nicht vor Start liegen
    if (formData.end_date && formData.end_date < formData.start_date) {
      toast({
        variant: "destructive",
        title: "Ungültiger Datumsbereich",
        description: "Das Enddatum muss gleich oder nach dem Startdatum liegen.",
      });
      return;
    }

    // Zeit-Validierung bei ganztägig=false und gleichem Datum: Endzeit muss nach Startzeit liegen
    if (!formData.all_day &&
        formData.start_date === (formData.end_date || formData.start_date) &&
        formData.start_time && formData.end_time &&
        formData.end_time <= formData.start_time) {
      toast({
        variant: "destructive",
        title: "Ungültige Uhrzeit",
        description: "Die Endzeit muss nach der Startzeit liegen.",
      });
      return;
    }

    setSaving(true);
    try {
      if (editingEvent) {
        // Update existing event
        const { data, error } = await supabase.functions.invoke("google-calendar-sync?action=update_event", {
          method: "POST",
          body: {
            event_id: editingEvent.id,
            title: formData.title,
            start_date: formData.start_date,
            end_date: formData.end_date || formData.start_date,
            all_day: formData.all_day,
            start_time: formData.all_day ? null : formData.start_time,
            end_time: formData.all_day ? null : formData.end_time,
            description: formData.description || null,
            calendar_type: formData.calendar_type,
          },
        });
        if (error) throw error;
        toast({ title: "Termin aktualisiert" });
      } else {
        // Create new event
        const { data, error } = await supabase.functions.invoke("google-calendar-sync?action=create_event", {
          method: "POST",
          body: {
            title: formData.title,
            start_date: formData.start_date,
            end_date: formData.end_date || formData.start_date,
            all_day: formData.all_day,
            start_time: formData.all_day ? null : formData.start_time,
            end_time: formData.all_day ? null : formData.end_time,
            description: formData.description || null,
            calendar_type: formData.calendar_type,
          },
        });
        if (error) throw error;
        toast({ title: "Termin erstellt" });
      }

      setEventDialogOpen(false);
      setEditingEvent(null);
      await loadData();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Fehler beim Speichern", description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEvent = async () => {
    if (!deletingEvent) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("google-calendar-sync?action=delete_event", {
        method: "POST",
        body: { event_id: deletingEvent.id },
      });
      if (error) throw error;
      toast({ title: "Termin gelöscht" });
      setDeleteDialogOpen(false);
      setDeletingEvent(null);
      await loadData();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Fehler beim Löschen", description: err.message });
    } finally {
      setDeleting(false);
    }
  };

  const confirmDelete = (event: CalendarEvent) => {
    setDeletingEvent(event);
    setDeleteDialogOpen(true);
  };

  // ─── Calendar grid ────────────────────────────────────────

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const weeks: Date[][] = [];
  let day = calStart;
  while (day <= calEnd) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(day);
      day = addDays(day, 1);
    }
    weeks.push(week);
  }

  const getAssignmentsForDay = (d: Date) => {
    const dStr = format(d, "yyyy-MM-dd");
    return assignments.filter((a) => a.datum === dStr && isKatVisible(a.kategorie));
  };

  const getEventsForDay = (d: Date) => {
    const dStr = format(d, "yyyy-MM-dd");
    return calendarEvents.filter((e) => e.start_date === dStr && isKatVisible(e.calendar_type));
  };

  // Alle tatsächlich vorkommenden Kategorien (für Filter-Chips) —
  // Assignments (Plantafel-Einsätze) UND Events werden berücksichtigt.
  const presentKats = Array.from(new Set([
    ...assignments.map(a => a.kategorie || "default"),
    ...calendarEvents.map(e => e.calendar_type || "default"),
  ])).sort();

  const selectedAssignments = selectedDate ? getAssignmentsForDay(selectedDate) : [];
  const selectedEvents = selectedDate ? getEventsForDay(selectedDate) : [];

  const isAdmin = userRole === "administrator";

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Kalender" />

      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6">
        {/* Header with navigation */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h2 className="text-xl font-bold min-w-[180px] text-center">
              {format(currentMonth, "MMMM yyyy", { locale: de })}
            </h2>
            <Button variant="outline" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {lastSyncTime && (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                Zuletzt synchronisiert: {format(lastSyncTime, "HH:mm", { locale: de })}
              </span>
            )}
            {isAdmin && (
              <>
                <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
                  Sync
                </Button>
                <Button size="sm" onClick={() => openCreateDialog(selectedDate || new Date())}>
                  <Plus className="h-4 w-4 mr-2" />
                  Neuer Termin
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Kategorie-Filter-Chips (nur wenn Events mit Kategorien vorhanden) */}
        {presentKats.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 my-3">
            <span className="text-xs text-muted-foreground mr-1">Kalender:</span>
            {presentKats.map(kat => {
              const meta = katMeta(kat);
              const hidden = hiddenKats.has(kat);
              return (
                <button
                  key={kat}
                  type="button"
                  onClick={() => toggleKat(kat)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-all ${
                    hidden
                      ? "opacity-40 border-dashed"
                      : meta.badgeClass + " border-transparent"
                  }`}
                  title={hidden ? "Einblenden" : "Ausblenden"}
                >
                  <span className={`inline-block w-2 h-2 rounded-full ${meta.barClass}`} />
                  {meta.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Calendar grid */}
        <Card>
          <CardContent className="p-0 sm:p-2">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 border-b">
              {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => (
                <div key={d} className="p-2 text-center text-xs font-medium text-muted-foreground">
                  {d}
                </div>
              ))}
            </div>

            {/* Weeks */}
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7">
                {week.map((d, di) => {
                  const dayAssignments = getAssignmentsForDay(d);
                  const dayEvents = getEventsForDay(d);
                  const isToday = isSameDay(d, new Date());
                  const isCurrentMonth = isSameMonth(d, currentMonth);
                  const isSelected = selectedDate && isSameDay(d, selectedDate);
                  const hasItems = dayAssignments.length > 0 || dayEvents.length > 0;

                  return (
                    <div
                      key={di}
                      className={`min-h-[60px] sm:min-h-[80px] border-b border-r p-1 cursor-pointer transition-colors
                        ${!isCurrentMonth ? "bg-muted/30 text-muted-foreground" : ""}
                        ${isToday ? "bg-primary/5" : ""}
                        ${isSelected ? "ring-2 ring-primary ring-inset" : ""}
                        ${hasItems ? "hover:bg-accent/10" : "hover:bg-muted/50"}
                      `}
                      onClick={() => setSelectedDate(d)}
                    >
                      <div className={`text-xs font-medium mb-0.5 ${isToday ? "text-primary font-bold" : ""}`}>
                        {format(d, "d")}
                      </div>
                      {/* Event indicators */}
                      <div className="space-y-0.5">
                        {dayAssignments.slice(0, 2).map((a) => {
                          const meta = katMeta(a.kategorie);
                          return (
                            <div
                              key={a.id}
                              className={`text-[10px] leading-tight truncate px-0.5 py-px rounded ${meta.badgeClass}`}
                              title={`${meta.label}: ${a.projects?.name || "?"}`}
                            >
                              {a.profiles ? `${a.profiles.vorname.charAt(0)}.` : ""} {a.projects?.name?.slice(0, 10) || "?"}
                            </div>
                          );
                        })}
                        {dayEvents.slice(0, 2).map((e) => {
                          const meta = katMeta(e.calendar_type);
                          return (
                            <div
                              key={e.id}
                              className={`text-[10px] leading-tight truncate px-0.5 py-px rounded ${meta.badgeClass} border-l-2`}
                              style={{ borderLeftColor: `var(--color-kat, currentColor)` }}
                              title={`${meta.label}: ${e.title}`}
                            >
                              {e.title?.slice(0, 12) || "Termin"}
                            </div>
                          );
                        })}
                        {(dayAssignments.length + dayEvents.length) > 4 && (
                          <div className="text-[10px] text-muted-foreground">+{dayAssignments.length + dayEvents.length - 4}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Selected day detail */}
        {selectedDate && (
          <Card className="mt-4">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">
                    {format(selectedDate, "EEEE, dd. MMMM yyyy", { locale: de })}
                  </CardTitle>
                  <CardDescription>
                    {selectedAssignments.length} Einteilung{selectedAssignments.length !== 1 ? "en" : ""}
                    {selectedEvents.length > 0 && ` · ${selectedEvents.length} Kalender-Event${selectedEvents.length !== 1 ? "s" : ""}`}
                  </CardDescription>
                </div>
                {isAdmin && (
                  <Button size="sm" variant="outline" onClick={() => openCreateDialog(selectedDate)}>
                    <Plus className="h-4 w-4 mr-1" />
                    Termin
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {selectedAssignments.length === 0 && selectedEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine Eintraege fuer diesen Tag.</p>
              ) : (
                <div className="space-y-3">
                  {selectedAssignments.map((a) => {
                    const meta = katMeta(a.kategorie);
                    return (
                      <div key={a.id} className="relative flex items-start gap-3 p-2 rounded-lg border overflow-hidden">
                        <div className={`absolute left-0 top-0 bottom-0 w-1 ${meta.barClass}`} />
                        <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0 ml-1.5" />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-sm">{a.projects?.name || "?"}</p>
                            <Badge className={`text-[10px] px-1.5 py-0 h-4 border-0 ${meta.badgeClass}`}>
                              {meta.label}
                            </Badge>
                            {(a.start_time || a.end_time) && (
                              <Badge variant="secondary" className="text-xs">
                                <Clock className="h-3 w-3 mr-1" />
                                {a.start_time?.slice(0, 5)} – {a.end_time?.slice(0, 5)}
                              </Badge>
                            )}
                          </div>
                          {a.profiles && (
                            <p className="text-xs text-muted-foreground">{a.profiles.vorname} {a.profiles.nachname}</p>
                          )}
                          {a.notizen && (
                            <p className="text-xs text-muted-foreground mt-1">{a.notizen}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {selectedEvents.map((e) => {
                    const meta = katMeta(e.calendar_type);
                    return (
                      <div key={e.id} className="relative flex items-start gap-3 p-2 rounded-lg border overflow-hidden">
                        {/* Farbstreifen links = Kategorie */}
                        <div className={`absolute left-0 top-0 bottom-0 w-1 ${meta.barClass}`} />
                        <CalIcon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0 ml-1.5" />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-sm">{e.title}</p>
                            <Badge className={`text-[10px] px-1.5 py-0 h-4 border-0 ${meta.badgeClass}`}>
                              {meta.label}
                            </Badge>
                          </div>
                          {!e.all_day && e.start_time && (
                            <p className="text-xs text-muted-foreground">
                              {e.start_time} – {e.end_time || "?"}
                            </p>
                          )}
                          {e.description && <p className="text-xs text-muted-foreground mt-1">{e.description}</p>}
                          {e.mitarbeiter && e.mitarbeiter.length > 0 && (
                            <div className="flex gap-1 mt-1 flex-wrap">
                              {e.mitarbeiter.map((m, i) => (
                                <Badge key={i} variant="outline" className="text-xs">{m}</Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        {isAdmin && (
                          <div className="flex gap-1 shrink-0">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEditDialog(e)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => confirmDelete(e)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Google Calendar subscribe info */}
        {calendarId && (
          <Card className="mt-4">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <CalIcon className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Google Kalender abonnieren</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Oeffne Google Kalender &rarr; "Weitere Kalender" &rarr; "Per URL abonnieren" und fuege diese ID ein:
                  </p>
                  <code className="text-xs bg-muted px-2 py-1 rounded mt-1 block break-all select-all">
                    {calendarId}
                  </code>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* ─── Create/Edit Event Dialog ─────────────────────────── */}
      <Dialog open={eventDialogOpen} onOpenChange={setEventDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editingEvent ? "Termin bearbeiten" : "Neuer Termin"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="event-title">Titel</Label>
              <Input
                id="event-title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Termin-Bezeichnung"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="event-start">Startdatum</Label>
                <Input
                  id="event-start"
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value, end_date: formData.end_date || e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-end">Enddatum</Label>
                <Input
                  id="event-end"
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="event-allday"
                checked={formData.all_day}
                onCheckedChange={(checked) => setFormData({ ...formData, all_day: checked })}
              />
              <Label htmlFor="event-allday">Ganztaegig</Label>
            </div>

            {!formData.all_day && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="event-start-time">Startzeit</Label>
                  <Input
                    id="event-start-time"
                    type="time"
                    value={formData.start_time}
                    onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="event-end-time">Endzeit</Label>
                  <Input
                    id="event-end-time"
                    type="time"
                    value={formData.end_time}
                    onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="event-desc">Beschreibung</Label>
              <Textarea
                id="event-desc"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optionale Beschreibung..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEventDialogOpen(false)}>Abbrechen</Button>
            <Button onClick={handleSaveEvent} disabled={saving}>
              {saving ? "Speichern..." : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Confirmation Dialog ───────────────────────── */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Termin löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Der Termin "{deletingEvent?.title}" wird aus dem Kalender und aus Google Calendar entfernt. Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteEvent} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? "Löschen..." : "Löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

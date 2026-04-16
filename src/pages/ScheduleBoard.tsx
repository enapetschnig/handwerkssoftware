import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  startOfISOWeek,
  addDays,
  addWeeks,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  format,
} from "date-fns";

import type { Einsatz, ScheduleMode } from "@/components/schedule/scheduleTypes";
import { getUnteamedProfiles } from "@/components/schedule/scheduleUtils";
import { useScheduleData } from "@/components/schedule/useScheduleData";
import { useSchedulePermissions } from "@/components/schedule/useSchedulePermissions";
import { ScheduleHeader } from "@/components/schedule/ScheduleHeader";
import { TimelineHeader } from "@/components/schedule/TimelineHeader";
import { ProjectBoardSection } from "@/components/schedule/ProjectBoardSection";
import { TeamSection } from "@/components/schedule/TeamSection";
import { MitarbeiterSection } from "@/components/schedule/MitarbeiterSection";
import { AddProjectToBoardDialog } from "@/components/schedule/AddProjectToBoardDialog";
import { CreateTeamDialog } from "@/components/schedule/CreateTeamDialog";
import { EinsatzDialog } from "@/components/schedule/EinsatzDialog";
import { CompanyHolidayManager } from "@/components/schedule/CompanyHolidayManager";
import { YearPlanningView } from "@/components/schedule/YearPlanningView";

export default function ScheduleBoard() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [mode, setMode] = useState<ScheduleMode>("month");
  const [weekStart, setWeekStart] = useState(() => startOfISOWeek(new Date()));

  const {
    profiles,
    projects,
    einsaetze,
    setEinsaetze,
    teams,
    setTeams,
    teamMembers,
    setTeamMembers,
    boardProjects,
    setBoardProjects,
    leaveRequests,
    companyHolidays,
    loading,
    fetchData,
  } = useScheduleData();

  const {
    userId,
    isAdmin,
    isVorarbeiter,
    isExtern,
    canManageHolidays,
    loading: permLoading,
  } = useSchedulePermissions();

  // Calculate visible days
  const weekDays = (() => {
    if (mode === "month") {
      const mStart = startOfMonth(weekStart);
      const mEnd = endOfMonth(weekStart);
      return eachDayOfInterval({ start: mStart, end: mEnd });
    }
    // Week: Mon-Sun (7 days)
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  })();
  const weekEnd = weekDays[weekDays.length - 1] || addDays(weekStart, 6);

  // Dialog states
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [einsatzDialogOpen, setEinsatzDialogOpen] = useState(false);
  const [editEinsatz, setEditEinsatz] = useState<Einsatz | null>(null);
  const [prefillUserId, setPrefillUserId] = useState<string | undefined>();
  const [prefillStartDate, setPrefillStartDate] = useState<string | undefined>();
  const [prefillEndDate, setPrefillEndDate] = useState<string | undefined>();

  useEffect(() => {
    if (!permLoading && !isAdmin && !isVorarbeiter && !isExtern) {
      navigate("/");
    }
  }, [permLoading, isAdmin, isVorarbeiter, isExtern, navigate]);

  useEffect(() => {
    if (!permLoading) {
      fetchData(weekStart, weekEnd, mode);
    }
  }, [weekStart, mode, permLoading]);

  const canEdit = isAdmin || isVorarbeiter;
  const unteamedProfiles = getUnteamedProfiles(profiles, teamMembers);

  // Available projects (not yet on board)
  const boardProjectIds = new Set(boardProjects.map((bp) => bp.project_id));
  const availableProjects = projects.filter((p) => !boardProjectIds.has(p.id));

  // --- Handlers ---

  const handleAddProjectToBoard = async (projectId: string, color: string, colorMode: "status" | "custom") => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from("board_projects")
      .insert({ project_id: projectId, board_color: color, color_mode: colorMode, created_by: user.id })
      .select()
      .single();
    if (error) { toast({ variant: "destructive", title: "Fehler", description: error.message }); return; }
    if (data) setBoardProjects((prev) => [...prev, data as any]);
    setAddProjectOpen(false);
  };

  const handleRemoveBoardProject = async (boardProjectId: string) => {
    await supabase.from("board_projects").delete().eq("id", boardProjectId);
    setBoardProjects((prev) => prev.filter((bp) => bp.id !== boardProjectId));
  };

  const handleCreateTeam = async (name: string, memberIds: string[]) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: team, error } = await supabase
      .from("teams")
      .insert({ name, created_by: user.id })
      .select()
      .single();
    if (error) { toast({ variant: "destructive", title: "Fehler", description: error.message }); return; }
    if (team) {
      setTeams((prev) => [...prev, team as any]);
      if (memberIds.length > 0) {
        const { data: members } = await supabase
          .from("team_members")
          .insert(memberIds.map((uid) => ({ team_id: team.id, user_id: uid })))
          .select();
        if (members) setTeamMembers((prev) => [...prev, ...(members as any[])]);
      }
    }
    setCreateTeamOpen(false);
  };

  const handleSaveEinsatz = async (data: {
    name: string; project_id: string; adresse: string;
    start_date: string; end_date: string; ganztaegig: boolean;
    start_time: string; end_time: string; beschreibung: string; id?: string;
  }) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const payload = {
      user_id: prefillUserId || user.id,
      project_id: data.project_id,
      name: data.name || null,
      adresse: data.adresse || null,
      beschreibung: data.beschreibung || null,
      start_date: data.start_date,
      end_date: data.end_date,
      ganztaegig: data.ganztaegig,
      start_time: data.ganztaegig ? "07:00" : (data.start_time || "07:00"),
      end_time: data.ganztaegig ? "16:00" : (data.end_time || "16:00"),
    };

    if (data.id) {
      // Update
      const { error } = await supabase.from("einsaetze").update(payload).eq("id", data.id);
      if (error) { toast({ variant: "destructive", title: "Fehler", description: error.message }); return; }
      setEinsaetze((prev) => prev.map((e) => e.id === data.id ? { ...e, ...payload } as Einsatz : e));

      // Sync to Google Calendar
      try {
        await supabase.functions.invoke("sync-assignment-to-calendar", {
          body: { action: "sync_einsatz", einsatz_id: data.id },
        });
      } catch {}
    } else {
      // Create
      const { data: created, error } = await supabase
        .from("einsaetze")
        .insert({ ...payload, created_by: user.id })
        .select()
        .single();
      if (error) { toast({ variant: "destructive", title: "Fehler", description: error.message }); return; }
      if (created) {
        setEinsaetze((prev) => [...prev, created as Einsatz]);
        // Sync to Google Calendar
        try {
          await supabase.functions.invoke("sync-assignment-to-calendar", {
            body: { action: "sync_einsatz", einsatz_id: created.id },
          });
        } catch {}
      }
    }

    setEinsatzDialogOpen(false);
    setEditEinsatz(null);
    setPrefillUserId(undefined);
    setPrefillStartDate(undefined);
    setPrefillEndDate(undefined);
  };

  const handleDeleteEinsatz = async (id: string) => {
    const einsatz = einsaetze.find((e) => e.id === id);
    if (einsatz?.google_event_id) {
      try {
        await supabase.functions.invoke("sync-assignment-to-calendar", {
          body: { action: "delete_einsatz", einsatz_id: id },
        });
      } catch {}
    }
    await supabase.from("einsaetze").delete().eq("id", id);
    setEinsaetze((prev) => prev.filter((e) => e.id !== id));
    setEinsatzDialogOpen(false);
    setEditEinsatz(null);
  };

  const handleCellClick = (uid: string, startDate: string, endDate: string) => {
    setPrefillUserId(uid);
    setPrefillStartDate(startDate);
    setPrefillEndDate(endDate);
    setEditEinsatz(null);
    setEinsatzDialogOpen(true);
  };

  const handleEinsatzClick = (einsatz: Einsatz) => {
    setEditEinsatz(einsatz);
    setPrefillUserId(einsatz.user_id);
    setEinsatzDialogOpen(true);
  };

  if (loading || permLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Lade...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b bg-white sticky top-0 z-50 shadow-sm">
        <div className="px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <img
            src="/newmontilogo.png"
            alt="MONTI.PRO"
            className="h-8 w-auto cursor-pointer hover:opacity-80 transition-opacity object-contain"
            onClick={() => navigate("/")}
          />
          <div className="flex-1" />
          {canManageHolidays && (
            <CompanyHolidayManager
              holidays={companyHolidays}
              onUpdate={() => fetchData(weekStart, weekEnd, mode)}
              userId={userId}
            />
          )}
        </div>
      </header>

      <main className="px-4 py-4">
        {/* Navigation Header */}
        <ScheduleHeader
          weekStart={weekStart}
          onWeekChange={setWeekStart}
          mode={mode}
          onModeChange={setMode}
          title="Plantafel"
        />

        {mode !== "year" ? (
          <div className="border rounded-lg overflow-x-auto bg-white mt-3">
            {/* Timeline Header */}
            <TimelineHeader days={weekDays} holidays={companyHolidays} />

            {/* Projekte Section */}
            <ProjectBoardSection
              boardProjects={boardProjects}
              projects={projects}
              days={weekDays}
              onAddClick={canEdit ? () => setAddProjectOpen(true) : undefined}
              onRemove={canEdit ? handleRemoveBoardProject : undefined}
            />

            {/* Teams Section */}
            <TeamSection
              teams={teams}
              teamMembers={teamMembers}
              profiles={profiles}
              einsaetze={einsaetze}
              boardProjects={boardProjects}
              projects={projects}
              days={weekDays}
              leaveRequests={leaveRequests}
              holidays={companyHolidays}
              onAddTeam={canEdit ? () => setCreateTeamOpen(true) : undefined}
              onEditTeam={() => {}}
              onCellClick={canEdit ? handleCellClick : undefined}
              onEinsatzClick={handleEinsatzClick}
            />

            {/* Mitarbeiter Section */}
            <MitarbeiterSection
              profiles={unteamedProfiles}
              einsaetze={einsaetze}
              boardProjects={boardProjects}
              projects={projects}
              days={weekDays}
              leaveRequests={leaveRequests}
              holidays={companyHolidays}
              onManageClick={() => {}}
              onCellClick={canEdit ? handleCellClick : undefined}
              onEinsatzClick={handleEinsatzClick}
            />
          </div>
        ) : (
          <YearPlanningView
            year={weekStart.getFullYear()}
            projects={projects}
            assignments={[]}
            holidays={companyHolidays}
            leaveRequests={leaveRequests}
          />
        )}
      </main>

      {/* Dialogs */}
      <AddProjectToBoardDialog
        open={addProjectOpen}
        onOpenChange={setAddProjectOpen}
        availableProjects={availableProjects}
        onSave={handleAddProjectToBoard}
      />

      <CreateTeamDialog
        open={createTeamOpen}
        onOpenChange={setCreateTeamOpen}
        profiles={profiles}
        existingTeamMemberIds={teamMembers.map((tm) => tm.user_id)}
        onSave={handleCreateTeam}
      />

      <EinsatzDialog
        open={einsatzDialogOpen}
        onOpenChange={(open) => {
          setEinsatzDialogOpen(open);
          if (!open) { setEditEinsatz(null); setPrefillUserId(undefined); }
        }}
        projects={projects}
        editEinsatz={editEinsatz}
        prefillUserId={prefillUserId}
        prefillStartDate={prefillStartDate}
        prefillEndDate={prefillEndDate}
        onSave={handleSaveEinsatz}
        onDelete={handleDeleteEinsatz}
      />
    </div>
  );
}

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Pencil } from "lucide-react";
import { format, parseISO } from "date-fns";
import { EinsatzBar } from "./EinsatzBar";
import {
  getEinsaetzeForUser,
  getEinsatzColumns,
  getTeamProfiles,
  isOnLeave,
  isCompanyHoliday,
  isWeekendDay,
} from "./scheduleUtils";
import { getProjectColor } from "./scheduleUtils";
import type {
  Team,
  TeamMember,
  Profile,
  Einsatz,
  BoardProject,
  Project,
  LeaveRequest,
  CompanyHoliday,
} from "./scheduleTypes";

interface Props {
  teams: Team[];
  teamMembers: TeamMember[];
  profiles: Profile[];
  einsaetze: Einsatz[];
  boardProjects: BoardProject[];
  projects: Project[];
  days: Date[];
  leaveRequests: LeaveRequest[];
  holidays: CompanyHoliday[];
  onAddTeam: () => void;
  onEditTeam: (team: Team) => void;
  onCellClick: (userId: string, startDate: string, endDate: string) => void;
  onEinsatzClick: (einsatz: Einsatz) => void;
}

export function TeamSection({
  teams,
  teamMembers,
  profiles,
  einsaetze,
  boardProjects,
  projects,
  days,
  leaveRequests,
  holidays,
  onAddTeam,
  onEditTeam,
  onCellClick,
  onEinsatzClick,
}: Props) {
  const [sectionCollapsed, setSectionCollapsed] = useState(false);
  const [collapsedTeams, setCollapsedTeams] = useState<Set<string>>(new Set());

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const boardColorMap = new Map(
    boardProjects.map((bp) => [bp.project_id, bp])
  );

  function toggleTeam(teamId: string) {
    setCollapsedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  }

  function getBarColor(projectId: string): string {
    const bp = boardColorMap.get(projectId);
    if (bp?.color_mode === "custom" && bp.board_color) {
      return bp.board_color;
    }
    return getProjectColor(projectId).fill;
  }

  function renderMemberRow(profile: Profile) {
    const userEinsaetze = getEinsaetzeForUser(einsaetze, profile.id);

    return (
      <div
        key={profile.id}
        className="grid border-t"
        style={{
          gridTemplateColumns: `280px 1fr`,
        }}
      >
        {/* Sidebar label */}
        <div className="flex items-center px-3 py-1 border-r bg-white min-h-[36px]">
          <span className="text-sm truncate pl-4">
            {profile.vorname} {profile.nachname}
          </span>
        </div>

        {/* Timeline cells */}
        <div className="relative min-h-[36px]">
          {/* Grid lines + interactive cells */}
          <div
            className="absolute inset-0 grid"
            style={{
              gridTemplateColumns: `repeat(${days.length}, minmax(28px, 1fr))`,
            }}
          >
            {days.map((day) => {
              const dateStr = format(day, "yyyy-MM-dd");
              const holiday = isCompanyHoliday(holidays, day);
              const leave = isOnLeave(leaveRequests, profile.id, day);
              const weekend = isWeekendDay(day);

              let bgClass = "";
              let overlay: React.ReactNode = null;

              if (holiday) {
                bgClass = "bg-gray-50";
                overlay = (
                  <span className="text-[9px] text-gray-400 truncate px-0.5">
                    {holiday.bezeichnung || "Feiertag"}
                  </span>
                );
              } else if (leave) {
                bgClass = "bg-orange-50";
                overlay = (
                  <span className="text-[9px] text-orange-400 truncate px-0.5">
                    {leave.type === "urlaub"
                      ? "Urlaub"
                      : leave.type === "krankenstand"
                      ? "Krank"
                      : leave.type === "za"
                      ? "ZA"
                      : leave.type}
                  </span>
                );
              } else if (weekend) {
                bgClass = "bg-gray-50/50";
              }

              return (
                <div
                  key={dateStr}
                  className={`border-r border-gray-100 flex items-end justify-center pb-0.5 ${bgClass} ${
                    !holiday && !leave
                      ? "cursor-pointer hover:bg-muted/20"
                      : ""
                  }`}
                  onClick={() => {
                    if (!holiday && !leave) {
                      onCellClick(profile.id, dateStr, dateStr);
                    }
                  }}
                >
                  {overlay}
                  {!holiday && !leave && !weekend && (
                    <div className="w-full h-full border border-dashed border-transparent hover:border-gray-200 rounded-sm min-h-[28px]" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Einsatz bars */}
          {userEinsaetze.map((einsatz) => {
            const cols = getEinsatzColumns(einsatz, days);
            if (!cols) return null;
            const project = projectMap.get(einsatz.project_id);
            return (
              <EinsatzBar
                key={einsatz.id}
                einsatz={einsatz}
                projectName={project?.name ?? "–"}
                color={getBarColor(einsatz.project_id)}
                startCol={cols.startCol}
                endCol={cols.endCol}
                totalDays={days.length}
                onClick={() => onEinsatzClick(einsatz)}
              />
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="border-b">
      {/* Section header */}
      <div
        className="grid border-b"
        style={{ gridTemplateColumns: "280px 1fr" }}
      >
        <button
          className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-left border-r"
          onClick={() => setSectionCollapsed(!sectionCollapsed)}
        >
          {sectionCollapsed ? (
            <ChevronRight className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0" />
          )}
          <span className="font-semibold text-sm">Teams</span>
          <span className="text-xs text-muted-foreground">
            {teams.length}
          </span>
        </button>
        <div className="flex items-center px-2">
          <button
            className="p-1 rounded hover:bg-muted/40 transition-colors"
            onClick={onAddTeam}
            title="Neues Team"
          >
            <Plus className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {!sectionCollapsed &&
        teams.map((team) => {
          const teamProfiles = getTeamProfiles(profiles, teamMembers, team.id);
          const isTeamCollapsed = collapsedTeams.has(team.id);

          return (
            <div key={team.id}>
              {/* Team sub-header */}
              <div
                className="grid border-t bg-muted/20"
                style={{ gridTemplateColumns: "280px 1fr" }}
              >
                <button
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/40 transition-colors text-left border-r"
                  onClick={() => toggleTeam(team.id)}
                >
                  {isTeamCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="text-sm font-medium truncate">
                    {team.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {teamProfiles.length}
                  </span>
                  <button
                    className="p-0.5 rounded hover:bg-muted/60 ml-auto"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditTeam(team);
                    }}
                    title="Team bearbeiten"
                  >
                    <Pencil className="h-3 w-3 text-muted-foreground" />
                  </button>
                </button>
                <div />
              </div>

              {/* Team members */}
              {!isTeamCollapsed && teamProfiles.map(renderMemberRow)}

              {!isTeamCollapsed && teamProfiles.length === 0 && (
                <div className="px-3 py-3 text-xs text-muted-foreground text-center border-t">
                  Keine Mitarbeiter in diesem Team
                </div>
              )}
            </div>
          );
        })}

      {!sectionCollapsed && teams.length === 0 && (
        <div className="px-3 py-4 text-sm text-muted-foreground text-center">
          Keine Teams erstellt
        </div>
      )}
    </div>
  );
}

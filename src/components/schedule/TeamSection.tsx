import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, Plus, Pencil } from "lucide-react";
import { format } from "date-fns";
import { EinsatzBar } from "./EinsatzBar";
import {
  getEinsaetzeForUser,
  getEinsatzColumns,
  getTeamProfiles,
  isOnLeave,
  isCompanyHoliday,
  isWeekendDay,
  getProjectColor,
} from "./scheduleUtils";
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

const WEEKEND_BG = "repeating-linear-gradient(-45deg, transparent, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 6px)";

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
  onAddTeam?: () => void;
  onEditTeam: (team: Team) => void;
  onCellClick?: (userId: string, startDate: string, endDate: string) => void;
  onEinsatzClick: (einsatz: Einsatz) => void;
}

export function TeamSection({
  teams, teamMembers, profiles, einsaetze, boardProjects, projects, days,
  leaveRequests, holidays, onAddTeam, onEditTeam, onCellClick, onEinsatzClick,
}: Props) {
  const [sectionCollapsed, setSectionCollapsed] = useState(false);
  const [collapsedTeams, setCollapsedTeams] = useState<Set<string>>(new Set());
  // Drag state
  const [dragUserId, setDragUserId] = useState<string | null>(null);
  const [dragStartIdx, setDragStartIdx] = useState<number | null>(null);
  const [dragEndIdx, setDragEndIdx] = useState<number | null>(null);

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const boardColorMap = new Map(boardProjects.map((bp) => [bp.project_id, bp]));

  function toggleTeam(teamId: string) {
    setCollapsedTeams((prev) => {
      const next = new Set(prev);
      next.has(teamId) ? next.delete(teamId) : next.add(teamId);
      return next;
    });
  }

  function getBarColor(projectId: string): string {
    const bp = boardColorMap.get(projectId);
    if (bp?.board_color) return bp.board_color;
    return getProjectColor(projectId).fill;
  }

  // Mouse up for drag selection
  useEffect(() => {
    const onMouseUp = () => {
      if (dragUserId && dragStartIdx !== null && dragEndIdx !== null && onCellClick) {
        const lo = Math.min(dragStartIdx, dragEndIdx);
        const hi = Math.max(dragStartIdx, dragEndIdx);
        onCellClick(dragUserId, format(days[lo], "yyyy-MM-dd"), format(days[hi], "yyyy-MM-dd"));
      }
      setDragUserId(null);
      setDragStartIdx(null);
      setDragEndIdx(null);
    };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [dragUserId, dragStartIdx, dragEndIdx, days, onCellClick]);

  function renderMemberRow(profile: Profile) {
    const userEinsaetze = getEinsaetzeForUser(einsaetze, profile.id);

    return (
      <div key={profile.id} className="flex border-t" style={{ minHeight: 36 }}>
        <div className="flex items-center px-3 py-1 border-r bg-white shrink-0" style={{ width: 280 }}>
          <span className="text-sm truncate pl-4">{profile.vorname} {profile.nachname}</span>
        </div>

        <div className="flex-1 relative min-h-[36px]">
          <div
            className="absolute inset-0 grid"
            style={{ gridTemplateColumns: `repeat(${days.length}, minmax(28px, 1fr))` }}
          >
            {days.map((day, dayIdx) => {
              const dateStr = format(day, "yyyy-MM-dd");
              const holiday = isCompanyHoliday(holidays, day);
              const leave = isOnLeave(leaveRequests, profile.id, day);
              const weekend = isWeekendDay(day);
              const isDragSelected =
                dragUserId === profile.id &&
                dragStartIdx !== null &&
                dragEndIdx !== null &&
                dayIdx >= Math.min(dragStartIdx, dragEndIdx) &&
                dayIdx <= Math.max(dragStartIdx, dragEndIdx);

              let cellStyle: React.CSSProperties = {};
              if (weekend && !holiday && !leave) cellStyle.background = WEEKEND_BG;

              return (
                <div
                  key={dateStr}
                  className={`border-r border-gray-100 ${
                    holiday ? "bg-gray-50" : leave ? "bg-orange-50" : ""
                  } ${isDragSelected ? "bg-blue-100" : ""} ${
                    !holiday && !leave && onCellClick ? "cursor-crosshair" : ""
                  }`}
                  style={!isDragSelected ? cellStyle : undefined}
                  onMouseDown={() => {
                    if (!holiday && !leave && onCellClick) {
                      setDragUserId(profile.id);
                      setDragStartIdx(dayIdx);
                      setDragEndIdx(dayIdx);
                    }
                  }}
                  onMouseEnter={() => {
                    if (dragUserId === profile.id) setDragEndIdx(dayIdx);
                  }}
                />
              );
            })}
          </div>

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
      <div className="flex items-center border-b">
        <button
          className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-left"
          style={{ width: 280 }}
          onClick={() => setSectionCollapsed(!sectionCollapsed)}
        >
          {sectionCollapsed ? <ChevronRight className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
          <span className="font-semibold text-sm">Teams</span>
          {onAddTeam && (
            <button className="ml-auto p-1 rounded hover:bg-muted/40" onClick={(e) => { e.stopPropagation(); onAddTeam(); }}>
              <Plus className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </button>
      </div>

      {!sectionCollapsed && teams.map((team) => {
        const teamProfiles = getTeamProfiles(profiles, teamMembers, team.id);
        const isTeamCollapsed = collapsedTeams.has(team.id);

        return (
          <div key={team.id}>
            <div className="flex items-center border-t bg-muted/20">
              <button
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/40 transition-colors text-left"
                style={{ width: 280 }}
                onClick={() => toggleTeam(team.id)}
              >
                {isTeamCollapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
                <span className="text-sm font-medium truncate">{team.name}</span>
                <span className="text-xs text-muted-foreground">{teamProfiles.length}</span>
                <button className="p-0.5 rounded hover:bg-muted/60 ml-auto" onClick={(e) => { e.stopPropagation(); onEditTeam(team); }}>
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </button>
              </button>
            </div>
            {!isTeamCollapsed && teamProfiles.map(renderMemberRow)}
            {!isTeamCollapsed && teamProfiles.length === 0 && (
              <div className="px-3 py-3 text-xs text-muted-foreground text-center border-t">Keine Mitarbeiter in diesem Team</div>
            )}
          </div>
        );
      })}

      {!sectionCollapsed && teams.length === 0 && (
        <div className="px-3 py-4 text-sm text-muted-foreground text-center">Keine Teams erstellt</div>
      )}
    </div>
  );
}

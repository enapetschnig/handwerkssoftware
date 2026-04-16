import { useState } from "react";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { format } from "date-fns";
import { EinsatzBar } from "./EinsatzBar";
import {
  getEinsaetzeForUser,
  getEinsatzColumns,
  isOnLeave,
  isCompanyHoliday,
  isWeekendDay,
} from "./scheduleUtils";
import { getProjectColor } from "./scheduleUtils";
import type {
  Profile,
  Einsatz,
  BoardProject,
  Project,
  LeaveRequest,
  CompanyHoliday,
} from "./scheduleTypes";

interface Props {
  profiles: Profile[];
  einsaetze: Einsatz[];
  boardProjects: BoardProject[];
  projects: Project[];
  days: Date[];
  leaveRequests: LeaveRequest[];
  holidays: CompanyHoliday[];
  onManageClick: () => void;
  onCellClick: (userId: string, startDate: string, endDate: string) => void;
  onEinsatzClick: (einsatz: Einsatz) => void;
}

export function MitarbeiterSection({
  profiles,
  einsaetze,
  boardProjects,
  projects,
  days,
  leaveRequests,
  holidays,
  onManageClick,
  onCellClick,
  onEinsatzClick,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const boardColorMap = new Map(
    boardProjects.map((bp) => [bp.project_id, bp])
  );

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
          <span className="text-sm truncate">
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
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0" />
          )}
          <span className="font-semibold text-sm">Mitarbeiter</span>
          <span className="text-xs text-muted-foreground">
            {profiles.length}
          </span>
        </button>
        <div className="flex items-center px-2">
          <button
            className="p-1 rounded hover:bg-muted/40 transition-colors"
            onClick={onManageClick}
            title="Mitarbeiter verwalten"
          >
            <Pencil className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {!collapsed && profiles.map(renderMemberRow)}

      {!collapsed && profiles.length === 0 && (
        <div className="px-3 py-4 text-sm text-muted-foreground text-center">
          Alle Mitarbeiter sind in Teams eingeteilt
        </div>
      )}
    </div>
  );
}

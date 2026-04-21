import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { format } from "date-fns";
import { EinsatzBar } from "./EinsatzBar";
import {
  getEinsaetzeForUser,
  getEinsatzColumns,
  isOnLeave,
  isCompanyHoliday,
  isWeekendDay,
  getProjectColor,
} from "./scheduleUtils";
import type {
  Profile,
  Einsatz,
  BoardProject,
  Project,
  LeaveRequest,
  CompanyHoliday,
  EmployeeColor,
} from "./scheduleTypes";

const WEEKEND_BG = "repeating-linear-gradient(-45deg, transparent, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 6px)";

interface Props {
  profiles: Profile[];
  einsaetze: Einsatz[];
  boardProjects: BoardProject[];
  projects: Project[];
  days: Date[];
  leaveRequests: LeaveRequest[];
  holidays: CompanyHoliday[];
  employeeColors?: Record<string, EmployeeColor>;
  onManageClick: () => void;
  onCellClick?: (userId: string, startDate: string, endDate: string) => void;
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
  employeeColors,
  onManageClick,
  onCellClick,
  onEinsatzClick,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  // Drag state
  const [dragUserId, setDragUserId] = useState<string | null>(null);
  const [dragStartIdx, setDragStartIdx] = useState<number | null>(null);
  const [dragEndIdx, setDragEndIdx] = useState<number | null>(null);

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const boardColorMap = new Map(boardProjects.map((bp) => [bp.project_id, bp]));

  function getBarColor(projectId: string): string {
    const bp = boardColorMap.get(projectId);
    if (bp?.board_color) return bp.board_color;
    return getProjectColor(projectId).fill;
  }

  // Mouse up handler for drag selection
  useEffect(() => {
    const onMouseUp = () => {
      if (dragUserId && dragStartIdx !== null && dragEndIdx !== null && onCellClick) {
        const lo = Math.min(dragStartIdx, dragEndIdx);
        const hi = Math.max(dragStartIdx, dragEndIdx);
        const startDate = format(days[lo], "yyyy-MM-dd");
        const endDate = format(days[hi], "yyyy-MM-dd");
        onCellClick(dragUserId, startDate, endDate);
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

    // Individuelle Farbe aus Admin-Einstellung (falls vorhanden).
    const empColor = employeeColors?.[profile.id];
    const sidebarStyle: React.CSSProperties = empColor
      ? { width: 280, backgroundColor: empColor.bg_color, color: empColor.text_color }
      : { width: 280 };
    return (
      <div key={profile.id} className="flex border-t" style={{ minHeight: 36 }}>
        {/* Sidebar */}
        <div
          className={`flex items-center px-3 py-1 border-r shrink-0 ${empColor ? "" : "bg-white"}`}
          style={sidebarStyle}
        >
          <span className="text-sm truncate font-medium">{profile.vorname} {profile.nachname}</span>
        </div>

        {/* Timeline */}
        <div className="flex-1 relative min-h-[36px]">
          {/* Grid cells (interactive) */}
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
                    if (dragUserId === profile.id) {
                      setDragEndIdx(dayIdx);
                    }
                  }}
                />
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
      {/* Header */}
      <div className="flex items-center border-b">
        <button
          className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-left"
          style={{ width: 280 }}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronRight className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
          <span className="font-semibold text-sm">Mitarbeiter</span>
          <button className="ml-auto p-1 rounded hover:bg-muted/40" onClick={(e) => { e.stopPropagation(); onManageClick(); }}>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </button>
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

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { parseISO, isWithinInterval } from "date-fns";
import type { BoardProject, Project } from "./scheduleTypes";

interface Props {
  boardProjects: BoardProject[];
  projects: Project[];
  days: Date[];
  onAddClick: () => void;
  onRemove: (boardProjectId: string) => void;
}

function darkenHex(hex: string, amount: number): string {
  const raw = hex.replace("#", "");
  const num = parseInt(raw, 16);
  const r = Math.max(0, ((num >> 16) & 0xff) - Math.round(255 * amount));
  const g = Math.max(0, ((num >> 8) & 0xff) - Math.round(255 * amount));
  const b = Math.max(0, (num & 0xff) - Math.round(255 * amount));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Default color when color_mode is "status" */
const STATUS_COLORS: Record<string, string> = {
  aktiv: "#C5E8B0",
  geplant: "#A7D8E8",
  abgeschlossen: "#D0D0D0",
  pausiert: "#F5E0A0",
};
const DEFAULT_STATUS_COLOR = "#A7C7E7";

function getStatusColor(status?: string): string {
  if (!status) return DEFAULT_STATUS_COLOR;
  return STATUS_COLORS[status.toLowerCase()] ?? DEFAULT_STATUS_COLOR;
}

export function ProjectBoardSection({
  boardProjects,
  projects,
  days,
  onAddClick,
  onRemove,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  return (
    <div className="border-b">
      {/* Section header */}
      <div
        className="grid border-b"
        style={{
          gridTemplateColumns: `280px 1fr`,
        }}
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
          <span className="font-semibold text-sm">Projekte</span>
          <span className="text-xs text-muted-foreground">
            {boardProjects.length}
          </span>
        </button>
        <div className="flex items-center px-2">
          <button
            className="p-1 rounded hover:bg-muted/40 transition-colors"
            onClick={onAddClick}
            title="Projekt hinzufugen"
          >
            <Plus className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Project rows */}
      {!collapsed &&
        boardProjects.map((bp) => {
          const project = projectMap.get(bp.project_id);
          if (!project) return null;

          const barColor =
            bp.color_mode === "custom" && bp.board_color
              ? bp.board_color
              : getStatusColor(project.status);

          // Calculate bar span
          let barStartIdx = -1;
          let barEndIdx = -1;

          if (project.geplanter_start && project.geplantes_ende) {
            const pStart = parseISO(project.geplanter_start);
            const pEnd = parseISO(project.geplantes_ende);

            for (let i = 0; i < days.length; i++) {
              const d = days[i];
              if (d >= pStart && d <= pEnd) {
                if (barStartIdx === -1) barStartIdx = i;
                barEndIdx = i;
              }
            }
          }

          const hasBar = barStartIdx >= 0;
          const leftPct = hasBar ? (barStartIdx / days.length) * 100 : 0;
          const widthPct = hasBar
            ? ((barEndIdx - barStartIdx + 1) / days.length) * 100
            : 0;
          const borderColor = darkenHex(barColor, 0.12);

          return (
            <div
              key={bp.id}
              className="grid border-t group"
              style={{
                gridTemplateColumns: `280px 1fr`,
              }}
            >
              {/* Sidebar label */}
              <div className="flex items-center gap-1.5 px-3 py-1.5 border-r bg-white min-h-[36px]">
                <div
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: barColor }}
                />
                <span className="text-sm truncate flex-1">
                  {project.name}
                </span>
                <button
                  className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 transition-opacity"
                  onClick={() => onRemove(bp.id)}
                  title="Vom Board entfernen"
                >
                  <X className="h-3.5 w-3.5 text-red-400" />
                </button>
              </div>

              {/* Timeline area */}
              <div className="relative min-h-[36px]">
                {/* Day grid lines */}
                <div
                  className="absolute inset-0 grid"
                  style={{
                    gridTemplateColumns: `repeat(${days.length}, minmax(28px, 1fr))`,
                  }}
                >
                  {days.map((day) => (
                    <div
                      key={day.toISOString()}
                      className="border-r border-gray-100"
                    />
                  ))}
                </div>

                {/* Project bar */}
                {hasBar && (
                  <div
                    className="absolute top-1/2 -translate-y-1/2 rounded-md flex items-center px-2 text-xs font-medium truncate"
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      height: 24,
                      backgroundColor: barColor,
                      border: `1px solid ${borderColor}`,
                      color: "#1e293b",
                      minWidth: 0,
                    }}
                    title={`${project.name}: ${project.geplanter_start} – ${project.geplantes_ende}`}
                  >
                    <span className="truncate">{project.name}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}

      {!collapsed && boardProjects.length === 0 && (
        <div className="px-3 py-4 text-sm text-muted-foreground text-center">
          Keine Projekte auf dem Board
        </div>
      )}
    </div>
  );
}

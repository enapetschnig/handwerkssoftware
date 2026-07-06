import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, Plus, Pencil, Building2 } from "lucide-react";
import { format } from "date-fns";
import { EinsatzBar } from "./EinsatzBar";
import { getEinsatzColumns, isCompanyHoliday, isWeekendDay, getEinsatzColor, getEinsatzTextColor } from "./scheduleUtils";
import type { Fremdfirma, FremdfirmaEinsatz, BoardProject, Project, CompanyHoliday } from "./scheduleTypes";

const WEEKEND_BG = "repeating-linear-gradient(-45deg, transparent, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 6px)";
const SIDEBAR_BG = "#e7e5e4"; // stone-200 — hebt Fremdfirmen von Mitarbeitern ab

interface Props {
  fremdfirmen: Fremdfirma[];
  einsaetze: FremdfirmaEinsatz[];
  boardProjects: BoardProject[];
  projects: Project[];
  days: Date[];
  holidays: CompanyHoliday[];
  onAddFirma?: () => void;
  onEditFirma?: (firma: Fremdfirma) => void;
  onCellClick?: (firmaId: string, startDate: string, endDate: string) => void;
  onEinsatzClick: (einsatz: FremdfirmaEinsatz) => void;
}

export function FremdfirmaSection({
  fremdfirmen,
  einsaetze,
  boardProjects,
  projects,
  days,
  holidays,
  onAddFirma,
  onEditFirma,
  onCellClick,
  onEinsatzClick,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [dragFirmaId, setDragFirmaId] = useState<string | null>(null);
  const [dragStartIdx, setDragStartIdx] = useState<number | null>(null);
  const [dragEndIdx, setDragEndIdx] = useState<number | null>(null);

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const boardColorMap = new Map(boardProjects.map((bp) => [bp.project_id, bp]));

  function getBarColor(projectId: string): string {
    return getEinsatzColor(projectMap.get(projectId), boardColorMap.get(projectId)?.board_color, projectId);
  }

  function getBarTextColor(projectId: string): string {
    return getEinsatzTextColor(boardColorMap.get(projectId)?.board_text_color, getBarColor(projectId));
  }

  useEffect(() => {
    const onMouseUp = () => {
      if (dragFirmaId && dragStartIdx !== null && dragEndIdx !== null && onCellClick) {
        const lo = Math.min(dragStartIdx, dragEndIdx);
        const hi = Math.max(dragStartIdx, dragEndIdx);
        onCellClick(dragFirmaId, format(days[lo], "yyyy-MM-dd"), format(days[hi], "yyyy-MM-dd"));
      }
      setDragFirmaId(null);
      setDragStartIdx(null);
      setDragEndIdx(null);
    };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [dragFirmaId, dragStartIdx, dragEndIdx, days, onCellClick]);

  function renderFirmaRow(firma: Fremdfirma) {
    const firmaEinsaetze = einsaetze.filter((e) => e.fremdfirma_id === firma.id);
    return (
      <div key={firma.id} className="flex border-t" style={{ minHeight: 36 }}>
        {/* Sidebar */}
        <div className="flex items-center gap-1.5 px-3 py-1 border-r shrink-0" style={{ width: 280, backgroundColor: SIDEBAR_BG }}>
          <Building2 className="h-3.5 w-3.5 text-stone-600 shrink-0" />
          <span className="text-sm truncate font-medium text-stone-800">{firma.firmenname}</span>
          {onEditFirma && (
            <button className="ml-auto p-1 rounded hover:bg-black/5 shrink-0" onClick={(e) => { e.stopPropagation(); onEditFirma(firma); }}>
              <Pencil className="h-3 w-3 text-stone-500" />
            </button>
          )}
        </div>

        {/* Timeline */}
        <div className="flex-1 relative min-h-[36px]">
          <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(28px, 1fr))` }}>
            {days.map((day, dayIdx) => {
              const dateStr = format(day, "yyyy-MM-dd");
              const holiday = isCompanyHoliday(holidays, day);
              const weekend = isWeekendDay(day);
              const isDragSelected =
                dragFirmaId === firma.id && dragStartIdx !== null && dragEndIdx !== null &&
                dayIdx >= Math.min(dragStartIdx, dragEndIdx) && dayIdx <= Math.max(dragStartIdx, dragEndIdx);
              const cellStyle: React.CSSProperties = {};
              if (weekend && !holiday) cellStyle.background = WEEKEND_BG;
              return (
                <div
                  key={dateStr}
                  data-cell-firma={firma.id}
                  data-cell-day={dateStr}
                  className={`border-r border-gray-100 ${holiday ? "bg-gray-50" : ""} ${isDragSelected ? "bg-blue-100" : ""} ${onCellClick ? "cursor-crosshair" : ""}`}
                  style={!isDragSelected ? cellStyle : undefined}
                  onMouseDown={() => {
                    if (!holiday && onCellClick) {
                      setDragFirmaId(firma.id);
                      setDragStartIdx(dayIdx);
                      setDragEndIdx(dayIdx);
                    }
                  }}
                  onMouseEnter={() => {
                    if (dragFirmaId === firma.id) setDragEndIdx(dayIdx);
                  }}
                />
              );
            })}
          </div>

          {firmaEinsaetze.map((einsatz) => {
            const cols = getEinsatzColumns(einsatz as any, days);
            if (!cols) return null;
            const project = projectMap.get(einsatz.project_id);
            return (
              <EinsatzBar
                key={einsatz.id}
                einsatz={{ id: einsatz.id }}
                projectName={project?.name ?? "–"}
                color={getBarColor(einsatz.project_id)}
                textColor={getBarTextColor(einsatz.project_id)}
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
          className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-left flex-1"
          style={{ minWidth: 280 }}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronRight className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
          <span className="font-semibold text-sm">Fremdfirmen</span>
          {onAddFirma && (
            <button
              className="ml-auto flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-muted/40 text-muted-foreground"
              onClick={(e) => { e.stopPropagation(); onAddFirma(); }}
            >
              <Plus className="h-3.5 w-3.5" /> Fremdfirma
            </button>
          )}
        </button>
      </div>

      {!collapsed && fremdfirmen.map(renderFirmaRow)}

      {!collapsed && fremdfirmen.length === 0 && (
        <div className="px-3 py-4 text-sm text-muted-foreground text-center">
          Noch keine Fremdfirmen — über „+ Fremdfirma" anlegen.
        </div>
      )}
    </div>
  );
}

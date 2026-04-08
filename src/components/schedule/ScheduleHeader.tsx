import {
  startOfISOWeek,
  startOfMonth,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
  getISOWeek,
  format,
  addDays,
  endOfMonth,
} from "date-fns";
import { de } from "date-fns/locale";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ScheduleMode } from "./scheduleTypes";

interface Props {
  weekStart: Date;
  onWeekChange: (date: Date) => void;
  mode: ScheduleMode;
  onModeChange?: (mode: ScheduleMode) => void;
  title?: string;
  children?: React.ReactNode;
}

export function ScheduleHeader({
  weekStart,
  onWeekChange,
  mode,
  onModeChange,
  title,
  children,
}: Props) {
  const navigateBack = () => {
    if (mode === "month") onWeekChange(startOfISOWeek(subMonths(weekStart, 1)));
    else if (mode === "2weeks") onWeekChange(subWeeks(weekStart, 2));
    else if (mode === "year") {
      const prev = new Date(weekStart);
      prev.setFullYear(prev.getFullYear() - 1);
      onWeekChange(startOfISOWeek(prev));
    } else onWeekChange(subWeeks(weekStart, 1));
  };

  const navigateForward = () => {
    if (mode === "month") onWeekChange(startOfISOWeek(addMonths(weekStart, 1)));
    else if (mode === "2weeks") onWeekChange(addWeeks(weekStart, 2));
    else if (mode === "year") {
      const next = new Date(weekStart);
      next.setFullYear(next.getFullYear() + 1);
      onWeekChange(startOfISOWeek(next));
    } else onWeekChange(addWeeks(weekStart, 1));
  };

  const goToday = () => onWeekChange(startOfISOWeek(new Date()));

  const getDateLabel = () => {
    if (mode === "year") return `${weekStart.getFullYear()}`;
    if (mode === "month") {
      return format(weekStart, "MMMM yyyy", { locale: de });
    }
    if (mode === "2weeks") {
      const end = addDays(weekStart, 13);
      return `KW ${getISOWeek(weekStart)}–${getISOWeek(end)} · ${format(weekStart, "dd.MM.", { locale: de })} – ${format(end, "dd.MM.yyyy", { locale: de })}`;
    }
    // week
    const weekEnd = addDays(weekStart, 4);
    return `KW ${getISOWeek(weekStart)} · ${format(weekStart, "dd.MM.", { locale: de })} – ${format(weekEnd, "dd.MM.yyyy", { locale: de })}`;
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
          <CalendarDays className="h-7 w-7" />
          {title ?? "Plantafel"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Zeit- und Ressourcenplanung
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Mode toggle */}
        {onModeChange && (
          <Tabs
            value={mode}
            onValueChange={(v) => onModeChange(v as ScheduleMode)}
          >
            <TabsList className="h-9">
              <TabsTrigger value="week" className="text-xs px-2">
                1 Woche
              </TabsTrigger>
              <TabsTrigger value="2weeks" className="text-xs px-2">
                2 Wochen
              </TabsTrigger>
              <TabsTrigger value="month" className="text-xs px-2">
                Monat
              </TabsTrigger>
              <TabsTrigger value="year" className="text-xs px-2">
                Jahr
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {/* Navigation */}
        {mode !== "year" && (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={navigateBack}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-9" onClick={goToday}>
              Heute
            </Button>
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={navigateForward}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium ml-1 whitespace-nowrap">
              {getDateLabel()}
            </span>
          </div>
        )}

        {mode === "year" && (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={navigateBack}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium px-2">{getDateLabel()}</span>
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={navigateForward}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {children}
      </div>
    </div>
  );
}

import { isSameDay, isWithinInterval, parseISO } from "date-fns";
import type { Assignment, LeaveRequest, CompanyHoliday, EmployeeColor } from "./scheduleTypes";

export const EMPLOYEE_COLORS = [
  { bg: "bg-blue-200",    text: "text-blue-900",    border: "border-blue-300"    },
  { bg: "bg-teal-200",    text: "text-teal-900",    border: "border-teal-300"    },
  { bg: "bg-rose-200",    text: "text-rose-900",    border: "border-rose-300"    },
  { bg: "bg-amber-200",   text: "text-amber-900",   border: "border-amber-300"   },
  { bg: "bg-lime-200",    text: "text-lime-900",    border: "border-lime-300"    },
  { bg: "bg-purple-200",  text: "text-purple-900",  border: "border-purple-300"  },
  { bg: "bg-orange-200",  text: "text-orange-900",  border: "border-orange-300"  },
  { bg: "bg-cyan-200",    text: "text-cyan-900",    border: "border-cyan-300"    },
  { bg: "bg-pink-200",    text: "text-pink-900",    border: "border-pink-300"    },
  { bg: "bg-indigo-200",  text: "text-indigo-900",  border: "border-indigo-300"  },
  { bg: "bg-emerald-200", text: "text-emerald-900", border: "border-emerald-300" },
  { bg: "bg-yellow-200",  text: "text-yellow-900",  border: "border-yellow-300"  },
  { bg: "bg-red-200",     text: "text-red-900",     border: "border-red-300"     },
  { bg: "bg-violet-200",  text: "text-violet-900",  border: "border-violet-300"  },
  { bg: "bg-sky-200",     text: "text-sky-900",     border: "border-sky-300"     },
  { bg: "bg-green-200",   text: "text-green-900",   border: "border-green-300"   },
];

export function getEmployeeColor(profileId: string, allProfileIds: string[], dbColors?: Record<string, EmployeeColor>) {
  // If DB custom colors are provided for this employee, return inline-compatible style
  if (dbColors) {
    // We need to find the employee by profile id - dbColors are keyed by employee_id
    // For now, look up by iterating (caller should pass mapped colors)
    const customColor = Object.values(dbColors).find(c => c.employee_id === profileId);
    if (customColor) {
      return {
        bg: "",
        text: "",
        border: "",
        style: { backgroundColor: customColor.bg_color, color: customColor.text_color },
      };
    }
  }
  const sorted = [...allProfileIds].sort();
  const idx = sorted.indexOf(profileId);
  return { ...EMPLOYEE_COLORS[(idx >= 0 ? idx : 0) % EMPLOYEE_COLORS.length], style: undefined as any };
}

export const PROJECT_COLORS = [
  { bg: "bg-slate-100",   text: "text-slate-800",   border: "border-slate-400",   fill: "#cbd5e1" },
  { bg: "bg-blue-100",    text: "text-blue-900",    border: "border-blue-400",    fill: "#93c5fd" },
  { bg: "bg-teal-100",    text: "text-teal-900",    border: "border-teal-400",    fill: "#99f6e4" },
  { bg: "bg-stone-100",   text: "text-stone-800",   border: "border-stone-400",   fill: "#d6d3d1" },
  { bg: "bg-sky-100",     text: "text-sky-900",     border: "border-sky-400",     fill: "#bae6fd" },
  { bg: "bg-indigo-100",  text: "text-indigo-900",  border: "border-indigo-400",  fill: "#a5b4fc" },
  { bg: "bg-emerald-100", text: "text-emerald-900", border: "border-emerald-400", fill: "#6ee7b7" },
  { bg: "bg-zinc-100",    text: "text-zinc-800",    border: "border-zinc-400",    fill: "#d4d4d8" },
];

export function getProjectColorIndex(projectId: string): number {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = ((hash << 5) - hash + projectId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % PROJECT_COLORS.length;
}

export function getProjectColor(projectId: string) {
  return PROJECT_COLORS[getProjectColorIndex(projectId)];
}

export function getProjectColorClass(projectId: string): string {
  const c = getProjectColor(projectId);
  return `${c.bg} ${c.text} ${c.border}`;
}

export const RESOURCE_SUGGESTIONS = [
  "Aluschalung",
  "Eisenschalung",
  "Deckenschalung (m\u00B2)",
  "Transport",
  "Bagger",
  "Dumper",
  "Eisen",
  "Kamin",
  "D\u00E4mmung",
  "Diverses",
];

export function getAssignmentForDay(
  assignments: Assignment[],
  userId: string,
  date: Date
): Assignment | undefined {
  return assignments.find(
    (a) => a.user_id === userId && isSameDay(parseISO(a.datum), date)
  );
}

export function isOnLeave(
  leaveRequests: LeaveRequest[],
  userId: string,
  date: Date
): LeaveRequest | undefined {
  return leaveRequests.find(
    (lr) =>
      lr.user_id === userId &&
      lr.status === "genehmigt" &&
      isWithinInterval(date, {
        start: parseISO(lr.start_date),
        end: parseISO(lr.end_date),
      })
  );
}

export function isCompanyHoliday(
  holidays: CompanyHoliday[],
  date: Date
): CompanyHoliday | undefined {
  return holidays.find((h) => isSameDay(parseISO(h.datum), date));
}

/** Get contiguous day ranges for a project's assignments */
export function getProjectDayRanges(
  assignments: Assignment[],
  projectId: string,
  days: Date[]
): { startIdx: number; endIdx: number; workerCount: number }[] {
  const ranges: { startIdx: number; endIdx: number; workerCount: number }[] = [];
  let rangeStart: number | null = null;

  for (let i = 0; i < days.length; i++) {
    const dayAssignments = assignments.filter(
      (a) => a.project_id === projectId && isSameDay(parseISO(a.datum), days[i])
    );

    if (dayAssignments.length > 0) {
      if (rangeStart === null) rangeStart = i;
    } else {
      if (rangeStart !== null) {
        // Calculate avg worker count for this range
        let totalWorkers = 0;
        for (let j = rangeStart; j < i; j++) {
          totalWorkers += assignments.filter(
            (a) => a.project_id === projectId && isSameDay(parseISO(a.datum), days[j])
          ).length;
        }
        ranges.push({
          startIdx: rangeStart,
          endIdx: i - 1,
          workerCount: Math.round(totalWorkers / (i - rangeStart)),
        });
        rangeStart = null;
      }
    }
  }

  // Close last range
  if (rangeStart !== null) {
    let totalWorkers = 0;
    for (let j = rangeStart; j < days.length; j++) {
      totalWorkers += assignments.filter(
        (a) => a.project_id === projectId && isSameDay(parseISO(a.datum), days[j])
      ).length;
    }
    ranges.push({
      startIdx: rangeStart,
      endIdx: days.length - 1,
      workerCount: Math.round(totalWorkers / (days.length - rangeStart)),
    });
  }

  return ranges;
}

// Stellt die österreichischen Feiertage als Set<string> ('YYYY-MM-DD')
// für die aktuelle Browser-Session bereit. Wird in HoursReport,
// MyHours, ScheduleBoard und Calendar genutzt, um:
//  - Tagessoll auf 0 zu setzen (Saldo bleibt neutral)
//  - Plantafel-Tageszellen visuell zu markieren
//  - Kalender-Hintergrund-Bänder zu rendern
//
// Die Tabelle austrian_holidays ist seed-only (52 Einträge bis 2029),
// daher reicht ein einmaliger Fetch pro Session ohne Re-Validation.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface HolidayRow {
  datum: string;
  bezeichnung: string;
}

export function useAustrianHolidays() {
  const [holidaySet, setHolidaySet] = useState<Set<string>>(new Set());
  const [holidayMap, setHolidayMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabase.from("austrian_holidays" as never) as any)
        .select("datum, bezeichnung");
      if (cancelled || !data) return;
      const rows = data as HolidayRow[];
      const map: Record<string, string> = {};
      const set = new Set<string>();
      for (const r of rows) {
        if (r.datum) {
          map[r.datum] = r.bezeichnung || "Feiertag";
          set.add(r.datum);
        }
      }
      setHolidayMap(map);
      setHolidaySet(set);
    })();
    return () => { cancelled = true; };
  }, []);

  return { holidaySet, holidayMap };
}

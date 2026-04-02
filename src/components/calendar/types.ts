export type ViewMode = 'month' | 'week' | 'day' | 'schedule';

export type EventType = 'all' | 'projects' | 'google';

export type CalendarType = 'allgemein' | 'kleinigkeiten' | 'baustellen';

export type ProjectType = 'grossprojekt' | 'kleinprojekt' | 'lieferung_abholung';

export interface CalendarEvent {
  id: string;
  project_id: string;
  google_event_id?: string;
  title: string;
  start_date: string;
  end_date?: string;
  all_day?: boolean;
  start_time?: string;
  end_time?: string;
  description?: string;
  mitarbeiter?: string[];
  synced_at?: string;
  calendar_type?: CalendarType;
  project_type?: ProjectType;
}

export interface CalendarFilters {
  eventType: EventType;
  mitarbeiter: string[];
}

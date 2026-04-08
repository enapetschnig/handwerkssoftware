export type Profile = { id: string; vorname: string; nachname: string };
export type Project = { id: string; name: string };

export type Assignment = {
  id: string;
  user_id: string;
  project_id: string;
  datum: string;
  notizen: string | null;
  start_time: string | null;
  end_time: string | null;
  google_event_id: string | null;
};

export type Resource = {
  id: string;
  project_id: string;
  datum: string;
  resource_name: string;
  menge: number | null;
  einheit: string | null;
};

export type DailyTarget = {
  id: string;
  project_id: string;
  datum: string;
  tagesziel: string | null;
  nachkalkulation_stunden: number | null;
  notizen: string | null;
};

export type LeaveRequest = {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  type: string;
  status: string;
  days: number;
};

export type CompanyHoliday = {
  id: string;
  datum: string;
  bezeichnung: string | null;
};

export type EmployeeColor = {
  employee_id: string;
  bg_color: string;
  text_color: string;
};

export type ScheduleMode = "week" | "2weeks" | "month" | "year";

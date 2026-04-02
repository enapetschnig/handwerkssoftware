import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type CalendarType = 'allgemein' | 'kleinigkeiten' | 'baustellen';
type ProjectType = 'grossprojekt' | 'kleinprojekt' | 'lieferung_abholung';

interface CalendarEvent {
  id?: string;
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
  created_at?: string;
  updated_at?: string;
  calendar_type?: CalendarType;
  project_type?: ProjectType;
}

interface SyncResult {
  success: boolean;
  event?: CalendarEvent;
  googleEventId?: string;
  error?: string;
}

interface FetchResult {
  success: boolean;
  events?: CalendarEvent[];
  error?: string;
}

// Helper to get a valid access token
async function getValidAccessToken(): Promise<string> {
  // Try refreshing the session first
  const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
  
  if (!refreshError && refreshData?.session?.access_token) {
    return refreshData.session.access_token;
  }
  
  // Fallback to getSession if refresh fails
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session?.access_token) {
    throw new Error('Nicht angemeldet');
  }
  
  return session.access_token;
}

export function useCalendarSync() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  // Sync a single event to Google Calendar
  const syncEvent = useCallback(async (event: Omit<CalendarEvent, 'id' | 'google_event_id' | 'synced_at' | 'created_at' | 'updated_at'>): Promise<SyncResult> => {
    setIsSyncing(true);
    try {
      const accessToken = await getValidAccessToken();

      const response = await supabase.functions.invoke('google-calendar-sync?action=sync', {
        method: 'POST',
        body: event,
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      const result = response.data as SyncResult;
      
      if (result.success) {
        setLastSyncTime(new Date());
        toast.success('Event mit Google Kalender synchronisiert');
      }

      return result;
    } catch (error) {
      console.error('Sync error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Sync fehlgeschlagen';
      toast.error(`Sync Fehler: ${errorMessage}`);
      return { success: false, error: errorMessage };
    } finally {
      setIsSyncing(false);
    }
  }, []);

  // Delete an event from Google Calendar
  const deleteEvent = useCallback(async (projectId: string): Promise<{ success: boolean; error?: string }> => {
    setIsSyncing(true);
    try {
      const accessToken = await getValidAccessToken();

      const response = await supabase.functions.invoke('google-calendar-sync?action=delete', {
        method: 'DELETE',
        body: { project_id: projectId },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      toast.success('Event aus Google Kalender gelöscht');
      return { success: true };
    } catch (error) {
      console.error('Delete error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Löschen fehlgeschlagen';
      toast.error(`Fehler: ${errorMessage}`);
      return { success: false, error: errorMessage };
    } finally {
      setIsSyncing(false);
    }
  }, []);

  // Fetch all events from Google Calendar and sync to DB
  const fetchEvents = useCallback(async (timeMin?: string, timeMax?: string): Promise<FetchResult> => {
    setIsSyncing(true);
    try {
      const accessToken = await getValidAccessToken();

      const params = new URLSearchParams({ action: 'fetch' });
      if (timeMin) params.append('timeMin', timeMin);
      if (timeMax) params.append('timeMax', timeMax);

      const response = await supabase.functions.invoke(`google-calendar-sync?${params.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      const result = response.data as FetchResult;
      
      if (result.success) {
        setLastSyncTime(new Date());
        toast.success('Kalender synchronisiert');
      }

      return result;
    } catch (error) {
      console.error('Fetch error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Abruf fehlgeschlagen';
      toast.error(`Fehler: ${errorMessage}`);
      return { success: false, error: errorMessage };
    } finally {
      setIsSyncing(false);
    }
  }, []);

  // Get events from local DB
  const getLocalEvents = useCallback(async (): Promise<CalendarEvent[]> => {
    const { data, error } = await supabase
      .from('calendar_events')
      .select('*')
      .order('start_date', { ascending: true });

    if (error) {
      console.error('Error fetching local events:', error);
      return [];
    }

    return (data || []) as CalendarEvent[];
  }, []);

  return {
    syncEvent,
    deleteEvent,
    fetchEvents,
    getLocalEvents,
    isSyncing,
    lastSyncTime,
  };
}

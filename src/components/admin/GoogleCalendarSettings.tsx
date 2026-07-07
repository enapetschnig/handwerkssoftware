import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Save, CheckCircle2, XCircle, RefreshCw, AlertTriangle, Loader2 } from "lucide-react";

/**
 * Admin-UI für Google-Calendar-Kategorien.
 *
 * Zeigt die 7 Geschäftsbereich-Kalender + Default. Admin kann IDs
 * ändern, per Test-Button den Zugriff prüfen, und am Ende per
 * „Alle Einsätze neu syncen" bestehende Plantafel-Einsätze auf den
 * zu ihrer Kategorie gehörigen Kalender umhängen.
 */

interface KategorieRow {
  key: string;         // "montipro" | "bks" | ... | "default"
  label: string;       // "ePower GmbH"
  settingKey: string;  // "google_calendar_id_montipro"
  calendarId: string;  // aktueller Wert
  testing: boolean;
  testResult: "ok" | "error" | null;
  testError?: string;
}

const KATEGORIEN: Array<{ key: string; label: string }> = [
  { key: "montipro",     label: "ePower GmbH" },
  { key: "bks",          label: "ePower GmbH" },
  { key: "gartenmacher", label: "Gartenmacher" },
  { key: "fensterwerk",  label: "Fensterwerk" },
  { key: "ladenbau",     label: "Ladenbau" },
  { key: "portas",       label: "Portas" },
  { key: "chef",         label: "CHEF (privater Kalender)" },
  { key: "default",      label: "Default (ohne Bereich)" },
];

export function GoogleCalendarSettings() {
  const { toast } = useToast();
  const [rows, setRows] = useState<KategorieRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    const keys = KATEGORIEN.map(k => `google_calendar_id_${k.key}`);
    const { data } = await supabase
      .from("app_settings").select("key, value").in("key", keys);
    const byKey: Record<string, string> = {};
    for (const r of (data as any[]) || []) byKey[r.key] = r.value || "";
    setRows(
      KATEGORIEN.map(k => ({
        key: k.key,
        label: k.label,
        settingKey: `google_calendar_id_${k.key}`,
        calendarId: byKey[`google_calendar_id_${k.key}`] || "",
        testing: false,
        testResult: null,
      }))
    );
    setLoading(false);
  }

  function updateRow(idx: number, patch: Partial<KategorieRow>) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  async function handleSaveAll() {
    // Default darf nicht leer sein — der Fallback muss existieren
    const def = rows.find(r => r.key === "default");
    if (!def?.calendarId.trim()) {
      toast({
        variant: "destructive",
        title: "Default-Kalender fehlt",
        description: "Die Default-Calendar-ID ist Pflicht — sonst landen Einsätze ohne Bereich nirgendwo.",
      });
      return;
    }

    setSaving(true);
    try {
      for (const r of rows) {
        const { error } = await supabase.from("app_settings").upsert({
          key: r.settingKey,
          value: r.calendarId.trim(),
        }, { onConflict: "key" });
        if (error) throw error;
      }
      toast({ title: "Gespeichert" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Fehler", description: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(idx: number) {
    const row = rows[idx];
    const id = row.calendarId.trim();
    if (!id) {
      updateRow(idx, { testResult: "error", testError: "Leere Calendar-ID" });
      return;
    }
    updateRow(idx, { testing: true, testResult: null, testError: undefined });
    try {
      const { data, error } = await supabase.functions.invoke("hws-google-calendar-sync", {
        body: { action: "test_calendar_access", calendarId: id },
      });
      if (error) throw error;
      if ((data as any)?.ok) {
        updateRow(idx, { testing: false, testResult: "ok" });
      } else {
        updateRow(idx, {
          testing: false,
          testResult: "error",
          testError: (data as any)?.error || "Unbekannter Fehler",
        });
      }
    } catch (err: any) {
      updateRow(idx, {
        testing: false,
        testResult: "error",
        testError: err.message || "Test fehlgeschlagen",
      });
    }
  }

  async function handleBulkResync() {
    if (!window.confirm(
      "Bestehende Plantafel-Einsätze werden auf den zur Projekt-Kategorie gehörigen Google-Kalender umgehängt. Das kann einige Minuten dauern. Fortfahren?"
    )) return;
    setBulkRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("hws-sync-assignment-to-calendar", {
        body: { action: "sync_all_einsaetze" },
      });
      if (error) throw error;
      const synced = (data as any)?.synced ?? 0;
      const failed = (data as any)?.failed ?? 0;
      toast({
        title: "Bulk-Resync abgeschlossen",
        description: `${synced} erfolgreich, ${failed} fehlgeschlagen. Details in den Edge-Function-Logs.`,
        duration: 8000,
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Bulk-Resync fehlgeschlagen", description: err.message });
    } finally {
      setBulkRunning(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Google Calendar — Geschäftsbereiche</CardTitle>
        <CardDescription>
          Pro Kategorie eine Kalender-ID. Plantafel-Einsätze für Projekte dieser Kategorie
          landen automatisch im richtigen Kalender. Für Projekte ohne Kategorie greift der
          Default-Kalender.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-center py-6 text-muted-foreground text-sm">Lädt…</p>
        ) : (
          <>
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Der Service-Account (siehe GOOGLE_SERVICE_ACCOUNT_KEY-Secret) braucht in
                jedem Kalender Schreibrechte. Test-Button prüft das, indem ein kurzes
                Test-Event erzeugt und sofort wieder gelöscht wird. Reminder, Farben und
                Freigaben werden direkt in Google Calendar pro Kalender gepflegt.
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              {rows.map((row, idx) => (
                <div key={row.key} className="grid grid-cols-[180px_1fr_auto_auto] gap-2 items-end">
                  <div>
                    <Label className="text-xs">{row.label}</Label>
                    {row.key === "default" && (
                      <span className="block text-[9px] text-amber-700">Pflichtfeld</span>
                    )}
                  </div>
                  <Input
                    value={row.calendarId}
                    onChange={(e) => updateRow(idx, { calendarId: e.target.value, testResult: null })}
                    placeholder="xxx@group.calendar.google.com"
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleTest(idx)}
                    disabled={row.testing || !row.calendarId.trim()}
                  >
                    {row.testing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : row.testResult === "ok" ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                    ) : row.testResult === "error" ? (
                      <XCircle className="w-3.5 h-3.5 text-destructive" />
                    ) : (
                      "Testen"
                    )}
                  </Button>
                  <div className="w-6">
                    {row.testResult === "error" && (
                      <Badge
                        variant="destructive"
                        className="text-[9px] px-1 py-0 h-4 whitespace-nowrap"
                        title={row.testError}
                      >
                        Fehler
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-2 border-t">
              <Button onClick={handleSaveAll} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Speichern
              </Button>
              <div className="flex-1" />
              <Button
                variant="outline"
                onClick={handleBulkResync}
                disabled={bulkRunning}
                className="gap-2"
              >
                {bulkRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Alle Einsätze neu syncen
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { MessageCircle, Send, RefreshCw, Settings, Clock, Calendar, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";

const DAY_OPTIONS = [
  { key: "mo", label: "Mo" },
  { key: "di", label: "Di" },
  { key: "mi", label: "Mi" },
  { key: "do", label: "Do" },
  { key: "fr", label: "Fr" },
  { key: "sa", label: "Sa" },
  { key: "so", label: "So" },
];

interface SettingsMap {
  [key: string]: string;
}

export function WhatsAppAdminSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [sendingMsg, setSendingMsg] = useState(false);
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");

  const [settings, setSettings] = useState<SettingsMap>({
    whatsapp_enabled: "true",
    whatsapp_reminder_enabled: "true",
    whatsapp_reminder_time: "17:00",
    whatsapp_reminder_days: "mo,di,mi,do,fr",
    whatsapp_morning_enabled: "true",
    whatsapp_morning_time: "07:00",
    whatsapp_bot_name: "BKS Assistent",
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const { data } = await supabase
      .from("app_settings")
      .select("key, value")
      .like("key", "whatsapp_%");

    if (data) {
      const map: SettingsMap = { ...settings };
      data.forEach((s) => {
        map[s.key] = s.value;
      });
      setSettings(map);
    }
    setLoading(false);
  };

  const saveSetting = async (key: string, value: string) => {
    const { error } = await supabase
      .from("app_settings")
      .upsert(
        { key, value, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return false;
    }
    return true;
  };

  const handleSaveAll = async () => {
    setSaving(true);
    let allOk = true;
    for (const [key, value] of Object.entries(settings)) {
      if (key.startsWith("whatsapp_")) {
        const ok = await saveSetting(key, value);
        if (!ok) allOk = false;
      }
    }
    setSaving(false);
    if (allOk) {
      toast({ title: "Einstellungen gespeichert" });
    }
  };

  const updateSetting = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const toggleDay = (day: string) => {
    const days = settings.whatsapp_reminder_days.split(",").filter(Boolean);
    const idx = days.indexOf(day);
    if (idx >= 0) {
      days.splice(idx, 1);
    } else {
      days.push(day);
    }
    updateSetting("whatsapp_reminder_days", days.join(","));
  };

  const isDayActive = (day: string) =>
    settings.whatsapp_reminder_days.split(",").includes(day);

  const handleTriggerReminder = async (type: "morning" | "evening") => {
    setSendingReminder(type);
    try {
      const res = await fetch("https://xyhgckqxowqnzjtoblfs.supabase.co/functions/v1/whatsapp-daily-reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Status ${res.status}`);
      toast({
        title: type === "morning" ? "Morgennachrichten gesendet" : "Abenderinnerungen gesendet",
        description: `${data?.sentCount || 0} Mitarbeiter benachrichtigt`,
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Fehler", description: err.message });
    } finally {
      setSendingReminder(null);
    }
  };

  const handleSendMessage = async () => {
    if (!phone || !message) return;
    setSendingMsg(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { error } = await supabase.functions.invoke("whatsapp-send", {
        body: { to: phone, message },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error) throw error;
      toast({ title: "Nachricht gesendet", description: `An ${phone}` });
      setPhone("");
      setMessage("");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Fehler", description: err.message });
    } finally {
      setSendingMsg(false);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground p-4">Lade Einstellungen...</p>;

  return (
    <div className="space-y-4">
      {/* Main toggle & status */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-green-600" />
              <CardTitle className="text-lg">WhatsApp KI-Assistent</CardTitle>
            </div>
            <Badge
              variant="outline"
              className={settings.whatsapp_enabled === "true" ? "text-green-600 border-green-600" : "text-red-500 border-red-500"}
            >
              {settings.whatsapp_enabled === "true" ? "Aktiv" : "Deaktiviert"}
            </Badge>
          </div>
          <CardDescription>
            Mitarbeiter können per WhatsApp Stunden buchen, Fotos hochladen und ihre Einteilung abfragen.
            Der KI-Assistent versteht natürliche Sprache.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>WhatsApp-Bot aktiviert</Label>
            <Switch
              checked={settings.whatsapp_enabled === "true"}
              onCheckedChange={(c) => updateSetting("whatsapp_enabled", c ? "true" : "false")}
            />
          </div>
          <div className="space-y-2">
            <Label>Bot-Name</Label>
            <Input
              value={settings.whatsapp_bot_name}
              onChange={(e) => updateSetting("whatsapp_bot_name", e.target.value)}
              placeholder="BKS Assistent"
            />
          </div>
        </CardContent>
      </Card>

      {/* Evening Reminder Settings */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-orange-500" />
            <CardTitle className="text-lg">Abend-Erinnerung</CardTitle>
          </div>
          <CardDescription>
            Erinnert Mitarbeiter die noch keine Stunden gebucht haben
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Abend-Erinnerung aktiv</Label>
            <Switch
              checked={settings.whatsapp_reminder_enabled === "true"}
              onCheckedChange={(c) => updateSetting("whatsapp_reminder_enabled", c ? "true" : "false")}
            />
          </div>
          <div className="space-y-2">
            <Label>Uhrzeit</Label>
            <Input
              type="time"
              value={settings.whatsapp_reminder_time}
              onChange={(e) => updateSetting("whatsapp_reminder_time", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Aktive Tage</Label>
            <div className="flex gap-1 flex-wrap">
              {DAY_OPTIONS.map((d) => (
                <Button
                  key={d.key}
                  variant={isDayActive(d.key) ? "default" : "outline"}
                  size="sm"
                  className="w-10 h-8 text-xs"
                  onClick={() => toggleDay(d.key)}
                >
                  {d.label}
                </Button>
              ))}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => handleTriggerReminder("evening")}
            disabled={sendingReminder === "evening"}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${sendingReminder === "evening" ? "animate-spin" : ""}`} />
            {sendingReminder === "evening" ? "Sende..." : "Jetzt Abend-Erinnerung senden"}
          </Button>
        </CardContent>
      </Card>

      {/* Morning Message Settings */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-blue-500" />
            <CardTitle className="text-lg">Morgen-Nachricht</CardTitle>
          </div>
          <CardDescription>
            Tägliche Übersicht mit Einteilung und Motivation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Morgen-Nachricht aktiv</Label>
            <Switch
              checked={settings.whatsapp_morning_enabled === "true"}
              onCheckedChange={(c) => updateSetting("whatsapp_morning_enabled", c ? "true" : "false")}
            />
          </div>
          <div className="space-y-2">
            <Label>Uhrzeit</Label>
            <Input
              type="time"
              value={settings.whatsapp_morning_time}
              onChange={(e) => updateSetting("whatsapp_morning_time", e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => handleTriggerReminder("morning")}
            disabled={sendingReminder === "morning"}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${sendingReminder === "morning" ? "animate-spin" : ""}`} />
            {sendingReminder === "morning" ? "Sende..." : "Jetzt Morgen-Nachricht senden"}
          </Button>
        </CardContent>
      </Card>

      {/* Save button */}
      <Button className="w-full" onClick={handleSaveAll} disabled={saving}>
        <Save className="h-4 w-4 mr-2" />
        {saving ? "Speichere..." : "Alle Einstellungen speichern"}
      </Button>

      <Separator />

      {/* Manual message */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            <CardTitle className="text-lg">Nachricht senden</CardTitle>
          </div>
          <CardDescription>Direkte WhatsApp-Nachricht an einen Mitarbeiter</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Telefonnummer (z.B. 06641234567 oder 436641234567)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Textarea
            placeholder="Nachricht..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
          />
          <Button
            size="sm"
            className="w-full"
            onClick={handleSendMessage}
            disabled={sendingMsg || !phone || !message}
          >
            <Send className="h-4 w-4 mr-2" />
            {sendingMsg ? "Sende..." : "Senden"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

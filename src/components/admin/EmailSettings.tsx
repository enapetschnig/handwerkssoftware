// Admin → Email-Versand: Default-Reply-To + Templates pro Doc-Typ
// editieren. Templates kommen aus public.email_templates, gespeichert
// pro typ. Reply-To wird in app_settings.email_default_reply_to gehalten.
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Loader2, Save, Mail, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface TemplateRow {
  typ: string;
  subject: string;
  body_html: string;
}

const DOC_TYPES: { value: string; label: string }[] = [
  { value: "angebot", label: "Angebot" },
  { value: "auftragsbestaetigung", label: "Auftragsbestätigung" },
  { value: "rechnung", label: "Rechnung" },
  { value: "anzahlungsrechnung", label: "Anzahlungsrechnung" },
  { value: "schlussrechnung", label: "Schlussrechnung" },
  { value: "gutschrift", label: "Gutschrift" },
  { value: "mahnung_1", label: "Mahnung 1 (Zahlungserinnerung)" },
  { value: "mahnung_2", label: "Mahnung 2" },
  { value: "mahnung_3", label: "Mahnung 3 (letzte Aufforderung)" },
];

export function EmailSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [replyTo, setReplyTo] = useState("");
  const [testRecipient, setTestRecipient] = useState("");
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [activeTyp, setActiveTyp] = useState<string>("rechnung");

  const activeTemplate = useMemo(
    () => templates.find(t => t.typ === activeTyp) ?? { typ: activeTyp, subject: "", body_html: "" },
    [templates, activeTyp],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [tplRes, settingsRes, userRes] = await Promise.all([
          supabase.from("email_templates").select("typ, subject, body_html"),
          supabase.from("app_settings").select("key, value").eq("key", "email_default_reply_to").maybeSingle(),
          supabase.auth.getUser(),
        ]);
        if (cancelled) return;
        setTemplates(((tplRes.data as TemplateRow[]) || []));
        setReplyTo((settingsRes.data as { value?: string } | null)?.value || "office@epowergmbh.at");
        const userEmail = userRes.data.user?.email || "";
        setTestRecipient(userEmail);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const updateActiveField = (field: "subject" | "body_html", value: string) => {
    setTemplates(prev => {
      const idx = prev.findIndex(t => t.typ === activeTyp);
      if (idx === -1) {
        return [...prev, { typ: activeTyp, subject: "", body_html: "", [field]: value } as TemplateRow];
      }
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      // Reply-To
      const { error: settingErr } = await supabase
        .from("app_settings")
        .upsert({ key: "email_default_reply_to", value: replyTo.trim() }, { onConflict: "key" });
      if (settingErr) throw settingErr;

      // Templates upserten
      const upserts = templates
        .filter(t => t.subject?.trim() || t.body_html?.trim())
        .map(t => ({ typ: t.typ, subject: t.subject.trim(), body_html: t.body_html }));
      if (upserts.length > 0) {
        const { error: tplErr } = await supabase
          .from("email_templates")
          .upsert(upserts, { onConflict: "typ" });
        if (tplErr) throw tplErr;
      }

      toast({ title: "Email-Einstellungen gespeichert" });
    } catch (err) {
      toast({ variant: "destructive", title: "Speichern fehlgeschlagen", description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (!testRecipient.trim() || !testRecipient.includes("@")) {
      toast({ variant: "destructive", title: "Empfänger ungültig" });
      return;
    }
    setTestSending(true);
    try {
      const previewSubject = activeTemplate.subject || `Test: ${activeTyp}`;
      const previewBody = activeTemplate.body_html || `<p>Dies ist eine Test-Email für die ${activeTyp}-Vorlage.</p>`;
      const { data, error } = await supabase.functions.invoke("hws-send-document-email", {
        body: {
          invoice_id: null,
          to: testRecipient.trim(),
          reply_to: replyTo.trim() || undefined,
          subject: `[TEST] ${previewSubject}`,
          body_html: `<p style="color:#888;font-size:11px;">(Test-Versand aus Admin-Settings, keine echte Rechnung)</p>${previewBody}`,
        },
      });
      if (error) throw error;
      const result = data as { ok?: boolean; error?: string } | null;
      if (!result?.ok) throw new Error(result?.error || "Versand fehlgeschlagen");
      toast({ title: "Test-Email versendet", description: `An ${testRecipient.trim()}` });
    } catch (err) {
      toast({ variant: "destructive", title: "Test fehlgeschlagen", description: (err as Error).message });
    } finally {
      setTestSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" /> Email-Versand
          </CardTitle>
          <CardDescription>
            Default-Reply-To und Vorlagen für den Email-Versand von Belegen (Rechnungen,
            Angebote, Gutschriften, …). Versendet wird über Resend.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Default Reply-To-Adresse</Label>
            <Input
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              placeholder="office@epowergmbh.at"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Antworten von Empfängern landen an dieser Adresse. Beim Versand kann sie überschrieben werden.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email-Vorlagen pro Dokumenttyp</CardTitle>
          <CardDescription>
            Verfügbare Platzhalter: <code>{`{{kunde_name}}`}</code>, <code>{`{{dokument_nr}}`}</code>,{" "}
            <code>{`{{dokument_datum}}`}</code>, <code>{`{{betrag}}`}</code>, <code>{`{{firma}}`}</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Dokumenttyp</Label>
            <Select value={activeTyp} onValueChange={setActiveTyp}>
              <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Betreff</Label>
            <Input
              value={activeTemplate.subject}
              onChange={(e) => updateActiveField("subject", e.target.value)}
              placeholder="Ihr Beleg {{dokument_nr}} – ePower"
            />
          </div>
          <div>
            <Label>Body</Label>
            <RichTextEditor
              rows={10}
              value={activeTemplate.body_html}
              onChange={(v) => updateActiveField("body_html", v)}
              placeholder="Verfasse hier deine Vorlage …"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Platzhalter werden beim Versand ersetzt:{" "}
              <code>{`{{kunde_name}}`}</code>, <code>{`{{dokument_nr}}`}</code>,{" "}
              <code>{`{{dokument_datum}}`}</code>, <code>{`{{betrag}}`}</code>, <code>{`{{firma}}`}</code>,{" "}
              <code>{`{{mahnstufe}}`}</code>, <code>{`{{offen}}`}</code>.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Test-Versand</CardTitle>
          <CardDescription>Schickt die aktuell sichtbare Vorlage als Test-Email an die angegebene Adresse.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Empfänger</Label>
            <Input
              value={testRecipient}
              onChange={(e) => setTestRecipient(e.target.value)}
              placeholder="du@example.com"
            />
          </div>
          <Button onClick={sendTest} disabled={testSending} variant="outline">
            {testSending ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Test-Email senden
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={saveAll} disabled={saving}>
          {saving ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Alle Email-Einstellungen speichern
        </Button>
      </div>
    </div>
  );
}

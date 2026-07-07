// SendEmailDialog: editierbarer Dialog vor dem Email-Versand.
// Vorbelegt mit Empfänger (kunde_email), Subject/Body aus
// email_templates pro Doc-Typ (Platzhalter ersetzt), Reply-To aus
// app_settings. Sendet via Edge-Function send-document-email.
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Loader2, Send, Paperclip } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getDocConfig } from "@/lib/documentTypes";

interface InvoiceLike {
  id?: string | null;
  typ: string;
  nummer?: string | null;
  datum?: string | null;
  kunde_name?: string | null;
  kunde_email?: string | null;
  brutto_summe?: number | null;
  bezahlt_betrag?: number | null;
  mahnstufe?: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: InvoiceLike;
  pdfBlob?: Blob | null;
  onSent?: () => void;
  // Override für den Template-Lookup. Default: invoice.typ. Bei
  // Mahnungen z. B. "mahnung_1" / "mahnung_2" / "mahnung_3".
  templateTyp?: string;
  // Dateiname für PDF-Attachment. Default: <nummer>.pdf
  pdfFilenameOverride?: string;
  // Header-Titel-Override. Default: "<typLabel> <nummer> per Email senden"
  titleOverride?: string;
}

const fmtCurrency = (n: number | null | undefined) => {
  const v = Number(n) || 0;
  return v.toLocaleString("de-AT", { style: "currency", currency: "EUR" });
};

const fmtDateAT = (iso: string | null | undefined) => {
  if (!iso) return "";
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString("de-AT");
  } catch {
    return iso;
  }
};

function applyVars(
  template: string,
  invoice: InvoiceLike,
  firma: string,
): string {
  const brutto = Number(invoice.brutto_summe) || 0;
  const bezahlt = Number(invoice.bezahlt_betrag) || 0;
  const offen = Math.max(0, brutto - bezahlt);
  return template
    .replace(/{{kunde_name}}/g, invoice.kunde_name || "")
    .replace(/{{dokument_nr}}/g, invoice.nummer || "")
    .replace(/{{dokument_datum}}/g, fmtDateAT(invoice.datum))
    .replace(/{{betrag}}/g, fmtCurrency(brutto))
    .replace(/{{offen}}/g, fmtCurrency(offen))
    .replace(/{{mahnstufe}}/g, String(invoice.mahnstufe || 0))
    .replace(/{{firma}}/g, firma);
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // dataURL: "data:application/pdf;base64,XXXX"
      const idx = result.indexOf("base64,");
      resolve(idx >= 0 ? result.slice(idx + 7) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function SendEmailDialog({ open, onOpenChange, invoice, pdfBlob, onSent, templateTyp, pdfFilenameOverride, titleOverride }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [attachPdf, setAttachPdf] = useState(true);

  const typLabel = getDocConfig(invoice.typ).label;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const lookupTyp = templateTyp || invoice.typ;
        const [tplRes, settingsRes] = await Promise.all([
          supabase.from("email_templates").select("subject, body_html").eq("typ", lookupTyp).maybeSingle(),
          supabase.from("app_settings").select("key, value").in("key", ["email_default_reply_to", "firmenname"]),
        ]);
        if (cancelled) return;
        const tpl = tplRes.data as { subject?: string; body_html?: string } | null;
        const settings = (settingsRes.data || []) as { key: string; value: string }[];
        const firma = settings.find(s => s.key === "firmenname")?.value || "ePower GmbH";
        const defaultReplyTo = settings.find(s => s.key === "email_default_reply_to")?.value || "office@epowergmbh.at";

        const subjectTpl = tpl?.subject || `Ihr ${typLabel} {{dokument_nr}}`;
        const bodyTpl = tpl?.body_html || `<p>Sehr geehrte Damen und Herren,</p><p>anbei erhalten Sie unser/e ${typLabel} <strong>{{dokument_nr}}</strong>.</p><p>Mit freundlichen Grüßen<br>${firma}</p>`;

        setSubject(applyVars(subjectTpl, invoice, firma));
        setBodyHtml(applyVars(bodyTpl, invoice, firma));
        setTo(invoice.kunde_email || "");
        setCc("");
        setReplyTo(defaultReplyTo);
        setAttachPdf(!!pdfBlob);
      } catch (err) {
        console.error("SendEmailDialog template load failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice.typ, invoice.id, templateTyp]);

  const handleSend = async () => {
    if (!to.trim()) {
      toast({ variant: "destructive", title: "Empfänger fehlt", description: "Bitte eine Empfänger-Email angeben." });
      return;
    }
    setSending(true);
    try {
      let pdfBase64: string | null = null;
      let pdfFilename: string | null = null;
      if (attachPdf && pdfBlob) {
        pdfBase64 = await blobToBase64(pdfBlob);
        pdfFilename = pdfFilenameOverride || `${invoice.nummer || invoice.typ}.pdf`;
      }
      const ccList = cc.split(/[,;\s]+/).map(s => s.trim()).filter(s => s.includes("@"));
      const { data, error } = await supabase.functions.invoke("hws-send-document-email", {
        body: {
          invoice_id: invoice.id || null,
          to: to.trim(),
          cc: ccList.length > 0 ? ccList : undefined,
          reply_to: replyTo.trim() || undefined,
          subject: subject.trim(),
          body_html: bodyHtml,
          pdf_base64: pdfBase64,
          pdf_filename: pdfFilename,
        },
      });
      if (error) {
        throw new Error(error.message || "Edge-Function fehlgeschlagen");
      }
      const result = data as { ok?: boolean; error?: string } | null;
      if (!result?.ok) {
        throw new Error(result?.error || "Versand fehlgeschlagen");
      }
      toast({ title: "Email versendet", description: `An ${to.trim()}` });
      onOpenChange(false);
      onSent?.();
    } catch (err) {
      toast({ variant: "destructive", title: "Versand fehlgeschlagen", description: (err as Error).message });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titleOverride || `${typLabel} ${invoice.nummer || ""} per Email senden`}</DialogTitle>
          <DialogDescription>
            Empfänger, Betreff und Text sind editierbar. Beim Klick auf „Senden" wird
            die Email über Resend verschickt und im Versand-Protokoll dokumentiert.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label>An *</Label>
              <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="kunde@example.com" />
            </div>
            <div>
              <Label>CC (optional)</Label>
              <Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="kollege@epowergmbh.at, buero@epowergmbh.at" />
            </div>
            <div>
              <Label>Reply-To</Label>
              <Input value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="office@epowergmbh.at" />
            </div>
            <div>
              <Label>Betreff *</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div>
              <Label>Nachricht</Label>
              <RichTextEditor
                value={bodyHtml}
                onChange={setBodyHtml}
                rows={10}
                placeholder="Verfasse hier deine Nachricht …"
              />
            </div>
            {pdfBlob && (
              <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
                <Checkbox
                  id="attach-pdf"
                  checked={attachPdf}
                  onCheckedChange={(v) => setAttachPdf(v === true)}
                />
                <Label htmlFor="attach-pdf" className="cursor-pointer text-sm flex items-center gap-1">
                  <Paperclip className="h-3.5 w-3.5" />
                  PDF anhängen ({pdfFilenameOverride || `${invoice.nummer || invoice.typ}.pdf`})
                </Label>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Abbrechen
          </Button>
          <Button onClick={handleSend} disabled={loading || sending}>
            {sending ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Senden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

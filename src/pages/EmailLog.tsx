// Email-Versand-Übersicht: Audit-Trail aller verschickten Belege.
// Tabelle aus email_log (sortiert nach sent_at DESC). Filter:
// Status, Suche (Empfänger, Betreff, Dokument-Nr). Retry-Button bei
// failed-Einträgen.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Mail, RefreshCw, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface EmailLogRow {
  id: string;
  invoice_id: string | null;
  to_address: string;
  cc_addresses: string[] | null;
  reply_to: string | null;
  subject: string;
  body_html: string | null;
  attachment_filename: string | null;
  provider_message_id: string | null;
  status: string;
  error_message: string | null;
  sent_at: string;
  sent_by: string | null;
  invoice?: { nummer: string | null; typ: string | null } | null;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  queued: { label: "in Bearbeitung", cls: "bg-blue-100 text-blue-700" },
  sent: { label: "versendet", cls: "bg-green-100 text-green-700" },
  failed: { label: "fehlgeschlagen", cls: "bg-red-100 text-red-700" },
  bounced: { label: "abgewiesen", cls: "bg-amber-100 text-amber-700" },
};

const fmtDateTime = (iso: string) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("de-AT", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

export default function EmailLog() {
  const { toast } = useToast();
  const [rows, setRows] = useState<EmailLogRow[]>([]);
  const [senderNames, setSenderNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [resendingId, setResendingId] = useState<string | null>(null);

  const fetchLog = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("email_log")
        .select(`
          id, invoice_id, to_address, cc_addresses, reply_to,
          subject, body_html, attachment_filename, provider_message_id,
          status, error_message, sent_at, sent_by,
          invoice:invoices(nummer, typ)
        `)
        .order("sent_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const logRows = (data as unknown as EmailLogRow[]) || [];
      setRows(logRows);
      // Sender-Namen in einer zweiten Query laden (kein FK auf profiles)
      const senderIds = Array.from(new Set(logRows.map(r => r.sent_by).filter(Boolean))) as string[];
      if (senderIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, vorname, nachname")
          .in("id", senderIds);
        const map: Record<string, string> = {};
        ((profiles as { id: string; vorname?: string | null; nachname?: string | null }[]) || []).forEach(p => {
          map[p.id] = `${p.vorname || ""} ${p.nachname || ""}`.trim() || "—";
        });
        setSenderNames(map);
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Laden fehlgeschlagen", description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLog();
  }, []);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const haystack = [
          r.to_address, r.subject,
          r.invoice?.nummer, r.error_message,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter]);

  const resend = async (row: EmailLogRow) => {
    if (!confirm(`Email an ${row.to_address} erneut senden?`)) return;
    setResendingId(row.id);
    try {
      const { data, error } = await supabase.functions.invoke("send-document-email", {
        body: {
          invoice_id: row.invoice_id,
          to: row.to_address,
          cc: row.cc_addresses && row.cc_addresses.length > 0 ? row.cc_addresses : undefined,
          reply_to: row.reply_to || undefined,
          subject: row.subject,
          body_html: row.body_html || "",
          // PDF-Attachment ist im Log nicht persistiert — Retry geht ohne Anhang.
        },
      });
      if (error) throw error;
      const result = data as { ok?: boolean; error?: string } | null;
      if (!result?.ok) throw new Error(result?.error || "Versand fehlgeschlagen");
      toast({ title: "Erneut versendet" });
      fetchLog();
    } catch (err) {
      toast({ variant: "destructive", title: "Retry fehlgeschlagen", description: (err as Error).message });
    } finally {
      setResendingId(null);
    }
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" /> Email-Versand
              </CardTitle>
              <CardDescription>
                Übersicht aller per Resend verschickten Belege (Rechnungen, Angebote, …).
              </CardDescription>
            </div>
            <Button onClick={fetchLog} variant="outline" size="sm" disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Aktualisieren
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="Suche: Empfänger, Betreff, Doc-Nr, Fehler…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sm:max-w-md"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Status</SelectItem>
                <SelectItem value="sent">Versendet</SelectItem>
                <SelectItem value="failed">Fehlgeschlagen</SelectItem>
                <SelectItem value="bounced">Abgewiesen</SelectItem>
                <SelectItem value="queued">In Bearbeitung</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead>Doc-Nr</TableHead>
                    <TableHead>An</TableHead>
                    <TableHead>Betreff</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Gesendet von</TableHead>
                    <TableHead className="text-right">Aktion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        Keine Einträge {search || statusFilter !== "all" ? "(Filter aktiv)" : ""}
                      </TableCell>
                    </TableRow>
                  )}
                  {filtered.map(row => {
                    const badge = STATUS_BADGE[row.status] || { label: row.status, cls: "bg-gray-100 text-gray-700" };
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="text-xs whitespace-nowrap">{fmtDateTime(row.sent_at)}</TableCell>
                        <TableCell>
                          {row.invoice?.nummer && row.invoice_id ? (
                            <Link to={`/invoices/${row.invoice_id}`} className="text-blue-600 hover:underline inline-flex items-center gap-1">
                              {row.invoice.nummer}
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{row.to_address}</TableCell>
                        <TableCell className="text-sm max-w-md truncate" title={row.subject}>{row.subject}</TableCell>
                        <TableCell>
                          <Badge className={badge.cls + " font-normal"}>{badge.label}</Badge>
                          {row.status === "failed" && row.error_message && (
                            <div className="text-[10px] text-red-600 mt-1 max-w-xs truncate" title={row.error_message}>
                              {row.error_message}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.sent_by ? (senderNames[row.sent_by] || "—") : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {(row.status === "failed" || row.status === "bounced") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => resend(row)}
                              disabled={resendingId === row.id}
                            >
                              {resendingId === row.id ? <Loader2 className="animate-spin h-3 w-3" /> : "Erneut senden"}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

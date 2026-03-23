import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, X, Save, Printer, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  buildInvoiceHtml,
  generateEpcQrCode,
  DEFAULT_BANK,
  type InvoiceHtmlData,
  type InvoiceHtmlItem,
  type BankData,
} from "@/lib/invoiceHtml";

interface InvoicePdfPreviewProps {
  open: boolean;
  onClose: () => void;
  onSave?: () => Promise<void> | void;
  onSavedClose?: () => void;
  saving?: boolean;
  saved?: boolean;
  invoiceId?: string;
  formData?: InvoiceHtmlData;
  items?: InvoiceHtmlItem[];
  fileName?: string;
}

export function InvoicePdfPreview({
  open,
  onClose,
  onSave,
  onSavedClose,
  saving,
  saved,
  invoiceId,
  formData,
  items,
  fileName,
}: InvoicePdfPreviewProps) {
  const [loading, setLoading] = useState(false);
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const formDataRef = useRef(formData);
  const itemsRef = useRef(items);
  formDataRef.current = formData;
  itemsRef.current = items;

  useEffect(() => {
    if (!open) {
      setHtmlContent(null);
      return;
    }
    generateHtml();
  }, [open, invoiceId]);

  // Regenerate when saved (nummer updates)
  useEffect(() => {
    if (open && saved) generateHtml();
  }, [saved, formData?.nummer]);

  const generateHtml = async () => {
    setLoading(true);
    try {
      // Load bank data
      let bankData: BankData = { ...DEFAULT_BANK };
      try {
        const { data: bankSettings } = await supabase
          .from("app_settings")
          .select("key, value")
          .in("key", ["bank_kontoinhaber", "bank_iban", "bank_bic"]);
        if (bankSettings) {
          bankSettings.forEach((row: any) => {
            if (row.key === "bank_kontoinhaber") bankData.kontoinhaber = row.value;
            if (row.key === "bank_iban") bankData.iban = row.value;
            if (row.key === "bank_bic") bankData.bic = row.value;
          });
        }
      } catch {}

      let html: string;
      if (formDataRef.current && itemsRef.current) {
        let qrDataUri: string | undefined;
        if (formDataRef.current.typ === "rechnung" && formDataRef.current.brutto_summe > 0) {
          try {
            qrDataUri = await generateEpcQrCode(
              formDataRef.current.brutto_summe,
              formDataRef.current.nummer || "Rechnung",
              bankData
            );
          } catch {}
        }
        html = buildInvoiceHtml(formDataRef.current, itemsRef.current, qrDataUri, bankData);
      } else if (invoiceId) {
        const { data, error } = await supabase.functions.invoke("generate-invoice-pdf", { body: { invoiceId } });
        if (error) throw error;
        html = decodeURIComponent(escape(atob(data.pdf)));
      } else {
        setLoading(false);
        return;
      }

      setHtmlContent(html);
    } catch (err) {
      console.error("Preview error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    if (!htmlContent) return;
    const win = window.open("", "_blank");
    if (win) {
      win.document.write(htmlContent);
      win.document.close();
      setTimeout(() => win.print(), 500);
    }
  };

  const handleDownload = () => {
    // "Save as PDF" via print dialog — the only reliable way to get
    // proper page breaks, repeating table headers, and fixed footers
    handlePrint();
  };

  const mustSaveFirst = onSave && !saved;

  // For the preview iframe, inject CSS to simulate A4 pages on screen
  const previewHtml = htmlContent ? htmlContent.replace(
    "</style>",
    `
    @media screen {
      html, body { background: #d1d5db !important; }
      .page-wrap { background: white; box-shadow: 0 2px 12px rgba(0,0,0,0.15); margin: 20px auto; padding: 15mm !important; max-width: 210mm; min-height: 297mm; }
      .footer { position: relative !important; bottom: auto !important; margin-top: 30px; }
    }
    </style>`
  ) : null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) { saved && onSavedClose ? onSavedClose() : onClose(); } }}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0">
        <DialogTitle className="sr-only">Dokumentvorschau</DialogTitle>

        <div className="flex items-center justify-between px-4 py-3 border-b bg-white">
          <div className="flex gap-2 flex-wrap items-center">
            {mustSaveFirst && (
              <>
                <Button size="sm" onClick={onSave} disabled={saving} className="gap-2 bg-green-600 hover:bg-green-700">
                  <Save className="h-4 w-4" />
                  {saving ? "Speichert..." : "Speichern"}
                </Button>
                <span className="text-sm text-muted-foreground">
                  Zuerst speichern, dann herunterladen
                </span>
              </>
            )}
            {!mustSaveFirst && (
              <>
                <Button size="sm" onClick={handleDownload} disabled={!htmlContent} className="gap-2">
                  <Download className="h-4 w-4" />
                  Als PDF speichern
                </Button>
                <Button variant="outline" size="sm" onClick={handlePrint} disabled={!htmlContent} className="gap-2">
                  <Printer className="h-4 w-4" />
                  Drucken
                </Button>
              </>
            )}
          </div>
          <div>
            {saved && onSavedClose ? (
              <Button variant="outline" size="sm" onClick={onSavedClose}>
                <X className="h-4 w-4 mr-2" />
                Zurück zur Übersicht
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={onClose}>
                <X className="h-4 w-4 mr-2" />
                Schließen
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-hidden bg-gray-300">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : previewHtml ? (
            <iframe
              ref={iframeRef}
              srcDoc={previewHtml}
              className="w-full h-full border-0"
              title="Invoice Preview"
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

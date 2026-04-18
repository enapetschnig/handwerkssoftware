/**
 * Besprechungsprotokoll-PDF Generator.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { InvoiceLayoutSettings } from "./invoiceLayoutTypes";
import { drawLetterhead, drawFooter, drawTitleBlock, LETTERHEAD_MARGIN } from "./pdfLetterhead";
import { renderPhotoGrid, type PhotoInput } from "./pdfPhotoGrid";

export interface ProtokollMassnahme {
  beschreibung: string;
  verantwortlich: string | null;
  faellig_am: string | null;
  erledigt: boolean;
}

export interface ProtokollInput {
  nummer: string | null;
  typ: string | null;
  datum: string;
  zeit_von: string | null;
  zeit_bis: string | null;
  ort: string | null;
  kunde_name: string | null;
  projekt_name: string | null;
  protokollant: string | null;
  teilnehmer: string | null;
  inhalt: string | null;
  vereinbarungen: string | null;
  massnahmen: ProtokollMassnahme[];
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const parts = d.split("-");
  if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
  return d;
}

function drawTextBlock(
  pdf: jsPDF,
  text: string,
  label: string,
  y: number,
): number {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const { left: ml, right: mr } = LETTERHEAD_MARGIN;
  const contentWidth = pageWidth - ml - mr;
  if (!(text || "").trim()) return y;

  if (y + 20 > pageHeight - 25) { pdf.addPage(); y = LETTERHEAD_MARGIN.top; }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(26, 26, 26);
  pdf.text(label, ml, y);
  y += 4;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9.5);
  pdf.setTextColor(60, 60, 60);
  const lines = pdf.splitTextToSize(text, contentWidth);
  pdf.text(lines, ml, y);
  y += lines.length * 4.5 + 4;

  return y;
}

export async function generateBesprechungsprotokollPdf(
  p: ProtokollInput,
  photos: PhotoInput[],
  layout: InvoiceLayoutSettings,
  logoDataUri: string | undefined,
  firmenUid?: string,
): Promise<Blob> {
  const pdf = new jsPDF("p", "mm", "a4");
  const pageHeight = pdf.internal.pageSize.getHeight();
  const { left: ml, right: mr } = LETTERHEAD_MARGIN;

  const { afterY } = drawLetterhead(pdf, layout, logoDataUri, firmenUid);

  const subtitleParts = [fmtDate(p.datum), p.ort, p.projekt_name].filter(Boolean);
  const typLabel = p.typ ? p.typ.charAt(0).toUpperCase() + p.typ.slice(1) : "";
  let y = drawTitleBlock(
    pdf,
    layout,
    `Besprechungsprotokoll${p.nummer ? " Nr. " + p.nummer : ""}${typLabel ? " – " + typLabel : ""}`,
    subtitleParts.join(" · "),
    afterY,
  );

  // Kopf-Info
  const zeit = p.zeit_von && p.zeit_bis ? `${p.zeit_von} – ${p.zeit_bis}` : p.zeit_von || "—";
  const infoRows: [string, string][] = [
    ["Datum", fmtDate(p.datum)],
    ["Zeit", zeit],
    ["Ort", p.ort || "—"],
    ["Protokollant", p.protokollant || "—"],
    ["Kunde", p.kunde_name || "—"],
    ["Projekt", p.projekt_name || "—"],
  ].filter(([, v]) => v !== "—" || true) as [string, string][];

  autoTable(pdf, {
    startY: y,
    body: infoRows,
    theme: "plain",
    styles: { font: "helvetica", fontSize: 9.5, cellPadding: { top: 1.2, right: 2, bottom: 1.2, left: 0 }, textColor: [26, 26, 26] },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 40, textColor: [100, 100, 100] },
      1: { cellWidth: "auto" as any },
    },
    margin: { left: ml, right: mr },
  });
  y = (pdf as any).lastAutoTable.finalY + 5;

  if (p.teilnehmer?.trim()) {
    y = drawTextBlock(pdf, p.teilnehmer, "Teilnehmer", y);
  }

  if (p.inhalt?.trim()) {
    y = drawTextBlock(pdf, p.inhalt, "Inhalt / Besprochene Punkte", y);
  }

  if (p.vereinbarungen?.trim()) {
    y = drawTextBlock(pdf, p.vereinbarungen, "Vereinbarungen", y);
  }

  // Maßnahmen-Tabelle
  if (p.massnahmen.length > 0) {
    if (y + 30 > pageHeight - 25) { pdf.addPage(); y = LETTERHEAD_MARGIN.top; }

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(26, 26, 26);
    pdf.text("Maßnahmen / Action Items", ml, y);
    y += 2;

    autoTable(pdf, {
      startY: y,
      head: [["#", "Maßnahme", "Verantwortlich", "Fällig", "Status"]],
      body: p.massnahmen.map((m, i) => [
        String(i + 1),
        m.beschreibung || "—",
        m.verantwortlich || "—",
        fmtDate(m.faellig_am),
        m.erledigt ? "✓ Erledigt" : "Offen",
      ]),
      theme: "grid",
      styles: { font: "helvetica", fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [245, 245, 245], textColor: [80, 80, 80], fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 8, halign: "center" },
        1: { cellWidth: "auto" as any },
        2: { cellWidth: 35 },
        3: { cellWidth: 22, halign: "center" },
        4: { cellWidth: 22, halign: "center" },
      },
      margin: { left: ml, right: mr },
    });
    y = (pdf as any).lastAutoTable.finalY + 4;
  }

  // Fotos
  if (photos.length > 0) {
    if (y + 80 > pageHeight - 25) { pdf.addPage(); y = LETTERHEAD_MARGIN.top; }
    y = await renderPhotoGrid(pdf, photos, y + 2, { heading: "Fotos", reserveFooter: 25 });
  }

  drawFooter(pdf, layout);
  return pdf.output("blob");
}

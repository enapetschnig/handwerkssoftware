/**
 * BTB-PDF (Bautagesbericht) Generator.
 * Nutzt das gemeinsame Briefkopf/Footer-Framework aus pdfLetterhead.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { InvoiceLayoutSettings } from "./invoiceLayoutTypes";
import { drawLetterhead, drawFooter, drawTitleBlock, LETTERHEAD_MARGIN } from "./pdfLetterhead";
import { renderPhotoGrid, type PhotoInput } from "./pdfPhotoGrid";

export interface BtbWorker {
  name: string;
  stunden: number;
  taetigkeit: string;
}

export interface BtbInput {
  nummer: string | null;
  datum: string;
  project_name: string;
  kunde_name?: string | null;
  bauleiter: string;
  wetter: string | null;
  temperatur_min: number | null;
  temperatur_max: number | null;
  arbeitszeit_von: string;
  arbeitszeit_bis: string;
  pause: number | null;
  workers: BtbWorker[];
  ausgefuehrte_arbeiten: string;
  besondere_vorkommnisse: string;
  unterschrift_bauleiter: string | null; // dataURI
  unterschrift_kunde: string | null;     // dataURI
}

function fmtDate(d: string): string {
  if (!d) return "–";
  const parts = d.split("-");
  if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
  return d;
}

function fmtHours(n: number): string {
  return `${n.toFixed(1).replace(".", ",")} h`;
}

/** Druckt einen Textblock mit Wrap. Liefert neue Y-Position. */
function drawTextBlock(
  pdf: jsPDF,
  text: string,
  label: string,
  y: number,
): number {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const { left: ml, right: mr } = LETTERHEAD_MARGIN;
  const contentWidth = pageWidth - ml - mr;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(26, 26, 26);
  pdf.text(label, ml, y);
  y += 4;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9.5);
  pdf.setTextColor(60, 60, 60);
  const lines = pdf.splitTextToSize(text || "—", contentWidth);
  pdf.text(lines, ml, y);
  y += lines.length * 4.5 + 4;

  return y;
}

export async function generateBautagesberichtPdf(
  btb: BtbInput,
  photos: PhotoInput[],
  layout: InvoiceLayoutSettings,
  logoDataUri: string | undefined,
  firmenUid?: string,
): Promise<Blob> {
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const { left: ml, right: mr } = LETTERHEAD_MARGIN;

  // Briefkopf
  const { afterY } = drawLetterhead(pdf, layout, logoDataUri, firmenUid);

  // Titel
  const subtitle = `${btb.project_name}${btb.kunde_name ? " · " + btb.kunde_name : ""}`;
  let y = drawTitleBlock(
    pdf,
    layout,
    `Bautagesbericht${btb.nummer ? " Nr. " + btb.nummer : ""}`,
    subtitle,
    afterY,
  );

  // Kopf-Info-Tabelle (Datum, Wetter, Temperatur, Zeiten, Pause, Bauleiter)
  const temp =
    btb.temperatur_min != null && btb.temperatur_max != null
      ? `${btb.temperatur_min}°C bis ${btb.temperatur_max}°C`
      : btb.temperatur_min != null ? `${btb.temperatur_min}°C`
      : btb.temperatur_max != null ? `${btb.temperatur_max}°C`
      : "—";

  const infoRows: string[][] = [
    ["Datum", fmtDate(btb.datum), "Wetter", btb.wetter || "—"],
    ["Temperatur", temp, "Pause", btb.pause != null ? `${btb.pause} Min.` : "—"],
    ["Arbeitszeit", `${btb.arbeitszeit_von} – ${btb.arbeitszeit_bis}`, "Bauleiter", btb.bauleiter || "—"],
  ];
  autoTable(pdf, {
    startY: y,
    head: [],
    body: infoRows,
    theme: "plain",
    styles: { font: "helvetica", fontSize: 9, cellPadding: { top: 1.5, right: 2, bottom: 1.5, left: 0 }, textColor: [26, 26, 26] },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 30, textColor: [100, 100, 100] },
      1: { cellWidth: 55 },
      2: { fontStyle: "bold", cellWidth: 30, textColor: [100, 100, 100] },
      3: { cellWidth: 55 },
    },
    margin: { left: ml, right: mr },
  });
  y = (pdf as any).lastAutoTable.finalY + 6;

  // Arbeitskräfte-Tabelle
  if (btb.workers.length > 0) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(26, 26, 26);
    pdf.text("Arbeitskräfte", ml, y);
    y += 2;

    autoTable(pdf, {
      startY: y,
      head: [["Name", "Stunden", "Tätigkeit"]],
      body: btb.workers.map((w) => [w.name || "—", fmtHours(w.stunden || 0), w.taetigkeit || "—"]),
      theme: "grid",
      styles: { font: "helvetica", fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [245, 245, 245], textColor: [80, 80, 80], fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 70 },
        1: { cellWidth: 25, halign: "right" },
        2: { cellWidth: "auto" as any },
      },
      margin: { left: ml, right: mr },
    });
    y = (pdf as any).lastAutoTable.finalY + 6;
  }

  // Ausgeführte Arbeiten
  y = drawTextBlock(pdf, btb.ausgefuehrte_arbeiten, "Ausgeführte Arbeiten", y);

  // Besondere Vorkommnisse
  if (btb.besondere_vorkommnisse?.trim()) {
    // Seitenumbruch-Check
    if (y + 40 > pageHeight - 25) { pdf.addPage(); y = LETTERHEAD_MARGIN.top; }
    y = drawTextBlock(pdf, btb.besondere_vorkommnisse, "Besondere Vorkommnisse", y);
  }

  // Fotos-Grid
  if (photos.length > 0) {
    if (y + 80 > pageHeight - 25) { pdf.addPage(); y = LETTERHEAD_MARGIN.top; }
    y = await renderPhotoGrid(pdf, photos, y, { heading: "Fotos", reserveFooter: 25 });
    y += 4;
  }

  // Unterschriften
  if (btb.unterschrift_bauleiter || btb.unterschrift_kunde) {
    const sigHeight = 30;
    if (y + sigHeight + 15 > pageHeight - 25) { pdf.addPage(); y = LETTERHEAD_MARGIN.top; }

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(26, 26, 26);
    pdf.text("Unterschriften", ml, y);
    y += 4;

    const colWidth = (pageWidth - ml - mr - 10) / 2;
    const sigTop = y + 2;
    const sigBoxHeight = 22;

    // Bauleiter
    pdf.setDrawColor(200, 200, 200);
    pdf.setLineWidth(0.2);
    pdf.rect(ml, sigTop, colWidth, sigBoxHeight);
    if (btb.unterschrift_bauleiter) {
      try {
        pdf.addImage(btb.unterschrift_bauleiter, "PNG", ml + 2, sigTop + 2, colWidth - 4, sigBoxHeight - 4);
      } catch { /* skip */ }
    }
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(100, 100, 100);
    pdf.text("Bauleiter: " + (btb.bauleiter || "—"), ml, sigTop + sigBoxHeight + 4);

    // Kunde
    pdf.setDrawColor(200, 200, 200);
    pdf.rect(ml + colWidth + 10, sigTop, colWidth, sigBoxHeight);
    if (btb.unterschrift_kunde) {
      try {
        pdf.addImage(btb.unterschrift_kunde, "PNG", ml + colWidth + 12, sigTop + 2, colWidth - 4, sigBoxHeight - 4);
      } catch { /* skip */ }
    }
    pdf.text("Kunde / Auftraggeber", ml + colWidth + 10, sigTop + sigBoxHeight + 4);

    y = sigTop + sigBoxHeight + 10;
  }

  drawFooter(pdf, layout);

  return pdf.output("blob");
}

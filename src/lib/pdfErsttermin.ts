/**
 * Ersttermin-PDF Generator.
 * Nutzt das gemeinsame Briefkopf/Footer-Framework.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { InvoiceLayoutSettings } from "./invoiceLayoutTypes";
import { drawLetterhead, drawFooter, drawTitleBlock, LETTERHEAD_MARGIN } from "./pdfLetterhead";
import { renderPhotoGrid, type PhotoInput } from "./pdfPhotoGrid";

export interface ErstterminInput {
  nummer: string | null;
  datum: string;
  projektname: string;
  kunde_name: string | null;
  ansprechpartner: string | null;
  telefon: string | null;
  email: string | null;
  standort: string | null;
  // Projekt & Bedarf
  projektart: string | null;
  gewerk: string | null;
  leistungsumfang: string | null;
  entscheidungsstatus: string | null;
  zeitrahmen: string | null;
  budget: number | null;
  quelle: string | null;
  prioritaeten: string | null;
  // Rahmenbedingungen
  zufahrt: string | null;
  infrastruktur: string | null;
  materialien: string | null;
  sicherheit: string | null;
  hindernisse: string | null;
  entsorgung: string | null;
  genehmigungen: string | null;
  offene_fragen: string | null;
  // Angebotsvorbereitung
  leistungsbeschreibung: string | null;
  flaeche_aufmass: string | null;
  anmerkungen: string | null;
  // Nächste Schritte
  angebot_ersteller: string | null;
  angebot_bis: string | null;
  folgetermin_datum: string | null;
  fehlende_unterlagen: string | null;
  bauleiter: string | null;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const parts = d.split("-");
  if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
  return d;
}

function fmtCurrency(n: number | null): string {
  if (n == null) return "—";
  return `€ ${n.toFixed(2).replace(".", ",")}`;
}

/** Zweispaltige Info-Rows (Label links, Wert rechts). Überspringt leere Werte. */
function drawTwoColInfo(
  pdf: jsPDF,
  rows: [string, string | null | undefined][],
  y: number,
): number {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const { left: ml, right: mr } = LETTERHEAD_MARGIN;
  const filtered: [string, string][] = rows
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => [k, String(v)]);
  if (filtered.length === 0) return y;

  autoTable(pdf, {
    startY: y,
    body: filtered,
    theme: "plain",
    styles: { font: "helvetica", fontSize: 9.5, cellPadding: { top: 1.2, right: 2, bottom: 1.2, left: 0 }, textColor: [26, 26, 26] },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 50, textColor: [100, 100, 100] },
      1: { cellWidth: "auto" as any },
    },
    margin: { left: ml, right: mr },
  });
  return (pdf as any).lastAutoTable.finalY + 3;
}

function drawSection(
  pdf: jsPDF,
  title: string,
  body: string,
  y: number,
): number {
  const pageHeight = pdf.internal.pageSize.getHeight();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const { left: ml, right: mr } = LETTERHEAD_MARGIN;
  const contentWidth = pageWidth - ml - mr;
  const text = (body || "").trim();
  if (!text) return y;

  if (y + 25 > pageHeight - 25) { pdf.addPage(); y = LETTERHEAD_MARGIN.top; }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(26, 26, 26);
  pdf.text(title, ml, y);
  y += 4;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9.5);
  pdf.setTextColor(60, 60, 60);
  const lines = pdf.splitTextToSize(text, contentWidth);
  pdf.text(lines, ml, y);
  y += lines.length * 4.5 + 3;

  return y;
}

function drawSectionHeading(pdf: jsPDF, title: string, y: number): number {
  const pageHeight = pdf.internal.pageSize.getHeight();
  if (y + 15 > pageHeight - 25) { pdf.addPage(); y = LETTERHEAD_MARGIN.top; }
  const { left: ml } = LETTERHEAD_MARGIN;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.setTextColor(26, 26, 26);
  pdf.text(title, ml, y);
  y += 5;
  return y;
}

export async function generateErstterminPdf(
  e: ErstterminInput,
  photos: PhotoInput[],
  layout: InvoiceLayoutSettings,
  logoDataUri: string | undefined,
  firmenUid?: string,
): Promise<Blob> {
  const pdf = new jsPDF("p", "mm", "a4");
  const pageHeight = pdf.internal.pageSize.getHeight();

  const { afterY } = drawLetterhead(pdf, layout, logoDataUri, firmenUid);
  const subtitle = [fmtDate(e.datum), e.kunde_name].filter(Boolean).join(" · ");
  let y = drawTitleBlock(
    pdf,
    layout,
    `Ersttermin${e.nummer ? " Nr. " + e.nummer : ""} – ${e.projektname || "—"}`,
    subtitle,
    afterY,
  );

  // Allgemeine Daten
  y = drawSectionHeading(pdf, "Allgemeine Daten", y);
  y = drawTwoColInfo(pdf, [
    ["Kunde", e.kunde_name],
    ["Ansprechpartner", e.ansprechpartner],
    ["Telefon", e.telefon],
    ["E-Mail", e.email],
    ["Projektname", e.projektname],
    ["Standort", e.standort],
    ["Datum", fmtDate(e.datum)],
  ], y);

  // Projekt & Bedarf
  if ([e.projektart, e.gewerk, e.leistungsumfang, e.entscheidungsstatus, e.zeitrahmen, e.budget, e.quelle, e.prioritaeten].some(v => v != null && String(v).trim() !== "")) {
    y = drawSectionHeading(pdf, "Projekt & Bedarf", y + 2);
    y = drawTwoColInfo(pdf, [
      ["Projektart", e.projektart],
      ["Gewerk", e.gewerk],
      ["Entscheidungsstatus", e.entscheidungsstatus],
      ["Zeitrahmen", e.zeitrahmen],
      ["Budget", e.budget != null ? fmtCurrency(e.budget) : null],
      ["Quelle", e.quelle],
    ], y);
    y = drawSection(pdf, "Leistungsumfang", e.leistungsumfang || "", y);
    y = drawSection(pdf, "Prioritäten", e.prioritaeten || "", y);
  }

  // Technische Rahmenbedingungen
  if ([e.zufahrt, e.infrastruktur, e.materialien, e.sicherheit, e.hindernisse, e.entsorgung, e.genehmigungen, e.offene_fragen].some(v => v != null && String(v).trim() !== "")) {
    y = drawSectionHeading(pdf, "Technische Rahmenbedingungen", y + 2);
    y = drawSection(pdf, "Zufahrt", e.zufahrt || "", y);
    y = drawSection(pdf, "Infrastruktur", e.infrastruktur || "", y);
    y = drawSection(pdf, "Materialien", e.materialien || "", y);
    y = drawSection(pdf, "Sicherheit", e.sicherheit || "", y);
    y = drawSection(pdf, "Hindernisse", e.hindernisse || "", y);
    y = drawSection(pdf, "Entsorgung", e.entsorgung || "", y);
    y = drawSection(pdf, "Genehmigungen", e.genehmigungen || "", y);
    y = drawSection(pdf, "Offene Fragen", e.offene_fragen || "", y);
  }

  // Angebot
  if ([e.leistungsbeschreibung, e.flaeche_aufmass, e.anmerkungen].some(v => v != null && String(v).trim() !== "")) {
    y = drawSectionHeading(pdf, "Angebotsvorbereitung", y + 2);
    y = drawSection(pdf, "Leistungsbeschreibung", e.leistungsbeschreibung || "", y);
    y = drawSection(pdf, "Fläche / Aufmaß", e.flaeche_aufmass || "", y);
    y = drawSection(pdf, "Anmerkungen", e.anmerkungen || "", y);
  }

  // Nächste Schritte
  if ([e.angebot_ersteller, e.angebot_bis, e.folgetermin_datum, e.fehlende_unterlagen, e.bauleiter].some(v => v != null && String(v).trim() !== "")) {
    y = drawSectionHeading(pdf, "Nächste Schritte", y + 2);
    y = drawTwoColInfo(pdf, [
      ["Angebot erstellt von", e.angebot_ersteller],
      ["Angebot bis", fmtDate(e.angebot_bis)],
      ["Folgetermin", fmtDate(e.folgetermin_datum)],
      ["Bauleiter", e.bauleiter],
    ], y);
    y = drawSection(pdf, "Fehlende Unterlagen", e.fehlende_unterlagen || "", y);
  }

  // Fotos
  if (photos.length > 0) {
    if (y + 80 > pageHeight - 25) { pdf.addPage(); y = LETTERHEAD_MARGIN.top; }
    y = await renderPhotoGrid(pdf, photos, y + 4, { heading: "Fotos", reserveFooter: 25 });
  }

  drawFooter(pdf, layout);
  return pdf.output("blob");
}

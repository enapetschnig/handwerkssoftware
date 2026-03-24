import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { InvoiceHtmlData, InvoiceHtmlItem, BankData } from "./invoiceHtml";

const DEFAULT_BANK: BankData = {
  kontoinhaber: "Gottfried Tilger",
  iban: "AT61 2081 5000 0423 1474",
  bic: "STSPAT2GXXX",
};

function fmt(val: number): string {
  return val.toFixed(2).replace(".", ",");
}

function fmtCurrency(val: number): string {
  return `€ ${fmt(val)}`;
}

export async function generateInvoicePdf(
  invoice: InvoiceHtmlData,
  items: InvoiceHtmlItem[],
  bank: BankData = DEFAULT_BANK,
  logoDataUri?: string,
  qrCodeDataUri?: string,
  firmenUid?: string
): Promise<Blob> {
  const isAngebot = invoice.typ === "angebot";
  const typLabel = isAngebot ? "Angebot" : "Rechnung";
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const ml = 15; // margin left
  const mr = 15; // margin right
  const contentWidth = pageWidth - ml - mr;

  // ======= HEADER (only first page) =======
  let y = 15;

  // Logo
  if (logoDataUri) {
    try {
      pdf.addImage(logoDataUri, "JPEG", ml, y, 45, 18);
    } catch {}
  }

  // Company info (right side)
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(0, 0, 0);
  pdf.text("Gottfried Tilger", pageWidth - mr, y + 2, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(0, 0, 0);
  pdf.text("Bahnhofstr. 174", pageWidth - mr, y + 7, { align: "right" });
  pdf.text("8831 Niederwölz", pageWidth - mr, y + 12, { align: "right" });
  pdf.text("Tel: +43 664 44 35 346", pageWidth - mr, y + 17, { align: "right" });
  pdf.text("info@ft-tilger.at", pageWidth - mr, y + 22, { align: "right" });

  y += 24;
  // Separator
  pdf.setDrawColor(200, 200, 200);
  pdf.setLineWidth(0.3);
  pdf.line(ml, y, pageWidth - mr, y);
  y += 4;

  // Sender line
  pdf.setFontSize(7);
  pdf.setTextColor(0, 0, 0);
  pdf.text("Gottfried Tilger \u00B7 Bahnhofstr. 174 \u00B7 8831 Niederwölz", ml, y);
  pdf.setDrawColor(180, 180, 180);
  pdf.line(ml, y + 1.5, ml + 72, y + 1.5);
  y += 6;

  // Recipient
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(0, 0, 0);
  pdf.text(invoice.kunde_name || "–", ml, y + 2);
  y += 6;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(0, 0, 0);
  if (invoice.kunde_adresse) { pdf.text(invoice.kunde_adresse, ml, y + 2); y += 5; }
  if (invoice.kunde_plz || invoice.kunde_ort) {
    pdf.text(`${invoice.kunde_plz || ""} ${invoice.kunde_ort || ""}`.trim(), ml, y + 2);
    y += 5;
  }
  if (invoice.kunde_uid) {
    pdf.setFontSize(8);
    pdf.setTextColor(0, 0, 0);
    pdf.text(`UID: ${invoice.kunde_uid}`, ml, y + 2);
    y += 5;
  }

  // Meta info (right side)
  const metaX = pageWidth - mr - 60;
  let metaY = y - 14;
  pdf.setFontSize(9);
  const datumFormatted = new Date(invoice.datum).toLocaleDateString("de-AT");
  const metaRows: [string, string][] = [
    [`${typLabel} Nr.`, invoice.nummer || "–"],
    ["Datum", datumFormatted],
  ];
  if (!isAngebot && invoice.leistungsdatum) metaRows.push(["Leistungsdatum", new Date(invoice.leistungsdatum).toLocaleDateString("de-AT")]);
  if (!isAngebot && invoice.faellig_am) metaRows.push(["Fällig am", new Date(invoice.faellig_am).toLocaleDateString("de-AT")]);
  if (invoice.gueltig_bis) metaRows.push(["Gültig bis", new Date(invoice.gueltig_bis).toLocaleDateString("de-AT")]);
  if (!isAngebot && invoice.zahlungsbedingungen) metaRows.push(["Zahlung", invoice.zahlungsbedingungen]);
  if (firmenUid) metaRows.push(["UID-Nr.", firmenUid]);
  if (invoice.kunde_uid) metaRows.push(["Kunden-UID", invoice.kunde_uid]);

  metaRows.forEach(([label, value]) => {
    pdf.setTextColor(0, 0, 0);
    pdf.text(label, metaX, metaY);
    pdf.setTextColor(0, 0, 0);
    pdf.setFont("helvetica", "bold");
    pdf.text(value, metaX + 38, metaY);
    pdf.setFont("helvetica", "normal");
    metaY += 5;
  });

  y = Math.max(y, metaY) + 4;

  // Document title
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.setTextColor(0, 0, 0);
  pdf.text(`${typLabel}${invoice.nummer ? ` Nr.: ${invoice.nummer}` : ""}`, ml, y);
  y += 2;
  pdf.setDrawColor(204, 0, 0);
  pdf.setLineWidth(0.8);
  pdf.line(ml, y, pageWidth - mr, y);
  y += 6;

  // ======= ITEMS TABLE with TOTALS as table footer =======
  // autoTable keeps footer together with last body rows — never alone on new page!
  const tableHead = [["Pos.", "Menge", "Einh.", "Beschreibung", "Preis", "Gesamt"]];
  const tableBody = items.map(item => [
    String(item.position).padStart(2, "0"),
    fmt(Number(item.menge)),
    item.einheit || "Stk.",
    item.beschreibung,
    fmtCurrency(Number(item.einzelpreis)),
    fmtCurrency(Number(item.gesamtpreis)),
  ]);

  // Build totals rows for the table footer
  const rabattProzent = Number(invoice.rabatt_prozent) || 0;
  const rabattBetrag = Number(invoice.rabatt_betrag) || 0;
  const positionenNetto = items.reduce((s, it) => s + Number(it.gesamtpreis), 0);
  const rabattWert = rabattProzent > 0 ? positionenNetto * (rabattProzent / 100) : rabattBetrag;
  const bezahltBetrag = Number(invoice.bezahlt_betrag) || 0;
  const restBetrag = Number(invoice.brutto_summe) - bezahltBetrag;

  const tableFoot: string[][] = [];
  if (rabattWert > 0) {
    tableFoot.push(["", "", "", "Zwischensumme", "", fmtCurrency(positionenNetto)]);
    tableFoot.push(["", "", "", `Rabatt${rabattProzent > 0 ? ` (${rabattProzent}%)` : ""}`, "", `- ${fmtCurrency(rabattWert)}`]);
  }
  tableFoot.push(["", "", "", "Nettobetrag", "", fmtCurrency(Number(invoice.netto_summe))]);
  tableFoot.push(["", "", "", `USt. ${Number(invoice.mwst_satz).toFixed(0)}%`, "", fmtCurrency(Number(invoice.mwst_betrag))]);
  tableFoot.push(["", "", "", "Bruttobetrag", "", fmtCurrency(Number(invoice.brutto_summe))]);

  const footerMargin = 32; // Space for page footer (22mm from bottom + buffer)

  autoTable(pdf, {
    startY: y,
    head: tableHead,
    body: tableBody,
    foot: tableFoot,
    showFoot: "lastPage",
    theme: "plain",
    rowPageBreak: "avoid",
    margin: { left: ml, right: mr, bottom: footerMargin },
    headStyles: {
      fillColor: [240, 240, 240],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      fontSize: 8,
      cellPadding: { top: 3, bottom: 3, left: 2, right: 2 },
      lineWidth: { bottom: 0.5 },
      lineColor: [0, 0, 0],
    },
    bodyStyles: {
      fontSize: 9,
      cellPadding: { top: 3, bottom: 3, left: 2, right: 2 },
      textColor: [0, 0, 0],
      lineWidth: { bottom: 0.2 },
      lineColor: [180, 180, 180],
    },
    footStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontSize: 9,
      fontStyle: "normal",
      cellPadding: { top: 2, bottom: 2, left: 2, right: 2 },
      lineWidth: 0,
    },
    columnStyles: {
      0: { halign: "center", cellWidth: 12, textColor: [0, 0, 0] },
      1: { halign: "right", cellWidth: 18 },
      2: { halign: "center", cellWidth: 14, textColor: [0, 0, 0] },
      3: { halign: "left" },
      4: { halign: "right", cellWidth: 24 },
      5: { halign: "right", cellWidth: 26, fontStyle: "bold" },
    },
    didParseCell: (data: any) => {
      if (data.section === "foot") {
        const rowLabel = data.row.raw?.[3] || "";

        // Footer labels in column 3 (Beschreibung) — right-aligned
        if (data.column.index === 3) {
          data.cell.styles.halign = "right";
          data.cell.styles.fontStyle = "normal";
          data.cell.styles.fontSize = 9;
        }

        // First footer row: thick line above as separator from positions
        if (data.row.index === 0) {
          data.cell.styles.lineWidth = { top: 0.8 };
          data.cell.styles.lineColor = [0, 0, 0];
        }

        // Bruttobetrag row: bold, red line above
        if (rowLabel === "Bruttobetrag") {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fontSize = 10;
          data.cell.styles.textColor = [0, 0, 0];
          data.cell.styles.lineWidth = { top: 0.8 };
          data.cell.styles.lineColor = [0, 0, 0];
        }

        // Rabatt row: red text
        if (rowLabel.startsWith("Rabatt")) {
          data.cell.styles.textColor = [204, 0, 0];
        }
      }
    },
  });

  y = (pdf as any).lastAutoTable.finalY + 4;

  // Totals are now part of the autoTable footer — no separate drawing needed

  // ======= NOTES =======
  if (invoice.notizen) {
    y += 4;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(0, 0, 0);
    pdf.text(`Anmerkung: ${invoice.notizen}`, ml, y, { maxWidth: contentWidth });
    y += 8;
  }

  // ======= CLOSING TEXT =======
  y += 2;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(0, 0, 0);
  const zahlungsTage = invoice.zahlungsbedingungen?.match(/(\d+)/)?.[1] || "14";
  const closingText = isAngebot
    ? "Wir freuen uns auf Ihren Auftrag und stehen für Rückfragen jederzeit gerne zur Verfügung."
    : `Wir bedanken uns für Ihren Auftrag und bitten um Überweisung des Rechnungsbetrages innerhalb von ${zahlungsTage} Tagen.`;
  pdf.text(closingText, ml, y, { maxWidth: contentWidth });
  y += 8;

  // ======= SKONTO INFO (only for Rechnung with Skonto) =======
  const skontoProzent = (invoice as any).skonto_prozent || 0;
  const skontoTage = (invoice as any).skonto_tage || 0;
  if (!isAngebot && skontoProzent > 0 && skontoTage > 0) {
    const brutto = Number(invoice.brutto_summe);
    const skontoBetrag = brutto * (1 - skontoProzent / 100);
    const skontoDatum = new Date(invoice.datum);
    skontoDatum.setDate(skontoDatum.getDate() + skontoTage);
    const skontoDateStr = skontoDatum.toLocaleDateString("de-AT");
    const faelligDateStr = invoice.faellig_am ? new Date(invoice.faellig_am).toLocaleDateString("de-AT") : "";

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(0, 0, 0);
    pdf.text(`Bei Zahlung bis ${skontoDateStr}: € ${fmt(skontoBetrag)} (${skontoProzent}% Skonto)`, ml, y);
    y += 5;
    if (faelligDateStr) {
      pdf.setFont("helvetica", "normal");
      pdf.text(`Zahlbar bis ${faelligDateStr}: € ${fmt(brutto)}`, ml, y);
      y += 5;
    }
    y += 3;
  }

  // ======= BANK INFO (only for Rechnung) =======
  if (!isAngebot) {
    if (y + 20 > pageHeight - 30) { pdf.addPage(); y = 15; }
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(0, 0, 0);
    pdf.text(`Bankverbindung: ${bank.kontoinhaber} \u00B7 IBAN: ${bank.iban} \u00B7 BIC: ${bank.bic}`, ml, y);
    y += 5;

    // QR Code
    if (qrCodeDataUri) {
      try {
        pdf.addImage(qrCodeDataUri, "PNG", pageWidth - mr - 22, y - 8, 22, 22);
        pdf.setFontSize(5.5);
        pdf.setTextColor(0, 0, 0);
        pdf.text("Zahlen mit Code", pageWidth - mr - 11, y + 16, { align: "center" });
      } catch {}
    }
  }

  // ======= FOOTER on every page =======
  const totalPages = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    const fy = pageHeight - 22; // Higher up to avoid printer clipping

    pdf.setDrawColor(204, 0, 0);
    pdf.setLineWidth(0.3);
    pdf.line(ml, fy, pageWidth - mr, fy);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(0, 0, 0);
    pdf.text(
      "Gottfried Tilger \u00B7 Fliesentechnik & Natursteinteppich \u00B7 Bahnhofstr. 174 \u00B7 8831 Niederwölz \u00B7 +43 664 44 35 346 \u00B7 info@ft-tilger.at",
      pageWidth / 2, fy + 4, { align: "center" }
    );
    pdf.text(`IBAN: ${bank.iban} \u00B7 BIC: ${bank.bic}`, pageWidth / 2, fy + 8, { align: "center" });
    pdf.text(`Seite ${i} von ${totalPages}`, pageWidth - mr, fy + 8, { align: "right" });
  }

  return pdf.output("blob");
}

// Generate a Storno confirmation PDF
export function generateStornoPdf(
  invoice: { nummer: string; kunde_name: string; brutto_summe: number; datum: string },
  stornoNummer: string,
  stornoDatum: string,
  stornoGrund: string,
  bank: BankData = DEFAULT_BANK,
  logoDataUri?: string
): Blob {
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const ml = 15;
  const mr = 15;

  let y = 15;

  // Logo
  if (logoDataUri) {
    try { pdf.addImage(logoDataUri, "JPEG", ml, y, 45, 18); } catch {}
  }

  // Company info
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(0, 0, 0);
  pdf.text("Gottfried Tilger", pageWidth - mr, y + 2, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.setTextColor(0, 0, 0);
  pdf.text("Bahnhofstr. 174 · 8831 Niederwölz", pageWidth - mr, y + 6, { align: "right" });
  pdf.text("+43 664 44 35 346 · info@ft-tilger.at", pageWidth - mr, y + 10, { align: "right" });

  y += 30;

  // Red "STORNO" header
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.setTextColor(204, 0, 0);
  pdf.text("STORNO", ml, y);
  y += 4;
  pdf.setDrawColor(204, 0, 0);
  pdf.setLineWidth(1);
  pdf.line(ml, y, pageWidth - mr, y);
  y += 10;

  // Storno details
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(0, 0, 0);

  const details: [string, string][] = [
    ["Stornonummer:", stornoNummer],
    ["Stornodatum:", new Date(stornoDatum).toLocaleDateString("de-AT")],
    ["Rechnungsnummer:", invoice.nummer],
    ["Rechnungsdatum:", new Date(invoice.datum).toLocaleDateString("de-AT")],
    ["Kunde:", invoice.kunde_name],
    ["Rechnungsbetrag:", fmtCurrency(invoice.brutto_summe)],
  ];

  details.forEach(([label, value]) => {
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(0, 0, 0);
    pdf.text(label, ml, y);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(0, 0, 0);
    pdf.text(value, ml + 50, y);
    y += 7;
  });

  y += 8;

  // Storno-Grund
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(0, 0, 0);
  pdf.text("Storno-Grund:", ml, y);
  y += 6;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(0, 0, 0);
  const grundLines = pdf.splitTextToSize(stornoGrund, pageWidth - ml - mr);
  pdf.text(grundLines, ml, y);
  y += grundLines.length * 5 + 10;

  // Confirmation text
  pdf.setFontSize(9);
  pdf.setTextColor(0, 0, 0);
  pdf.text("Hiermit wird bestätigt, dass die oben genannte Rechnung storniert wurde.", ml, y);
  y += 5;
  pdf.text("Der Rechnungsbetrag wird nicht mehr zur Zahlung fällig.", ml, y);

  // Footer
  const fy = pageHeight - 22;
  pdf.setDrawColor(204, 0, 0);
  pdf.setLineWidth(0.3);
  pdf.line(ml, fy, pageWidth - mr, fy);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6);
  pdf.setTextColor(0, 0, 0);
  pdf.text("Gottfried Tilger · Fliesentechnik & Natursteinteppich · Bahnhofstr. 174 · 8831 Niederwölz · +43 664 44 35 346 · info@ft-tilger.at", pageWidth / 2, fy + 4, { align: "center" });
  pdf.text(`IBAN: ${bank.iban} · BIC: ${bank.bic}`, pageWidth / 2, fy + 7.5, { align: "center" });

  return pdf.output("blob");
}

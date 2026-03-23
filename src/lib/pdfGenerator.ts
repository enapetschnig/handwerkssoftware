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
  qrCodeDataUri?: string
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
  pdf.setFontSize(9);
  pdf.setTextColor(30, 30, 30);
  pdf.text("Gottfried Tilger", pageWidth - mr, y + 2, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.setTextColor(100, 100, 100);
  pdf.text("Bahnhofstr. 174", pageWidth - mr, y + 6, { align: "right" });
  pdf.text("8831 Niederwölz", pageWidth - mr, y + 10, { align: "right" });
  pdf.text("Tel: +43 664 44 35 346", pageWidth - mr, y + 14, { align: "right" });
  pdf.text("info@ft-tilger.at", pageWidth - mr, y + 18, { align: "right" });

  y += 24;
  // Separator
  pdf.setDrawColor(200, 200, 200);
  pdf.setLineWidth(0.3);
  pdf.line(ml, y, pageWidth - mr, y);
  y += 4;

  // Sender line
  pdf.setFontSize(6);
  pdf.setTextColor(160, 160, 160);
  pdf.text("Gottfried Tilger \u00B7 Bahnhofstr. 174 \u00B7 8831 Niederwölz", ml, y);
  pdf.setDrawColor(220, 220, 220);
  pdf.line(ml, y + 1.5, ml + 70, y + 1.5);
  y += 5;

  // Recipient
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(30, 30, 30);
  pdf.text(invoice.kunde_name || "–", ml, y + 2);
  y += 5;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.setTextColor(80, 80, 80);
  if (invoice.kunde_adresse) { pdf.text(invoice.kunde_adresse, ml, y + 2); y += 4; }
  if (invoice.kunde_plz || invoice.kunde_ort) {
    pdf.text(`${invoice.kunde_plz || ""} ${invoice.kunde_ort || ""}`.trim(), ml, y + 2);
    y += 4;
  }
  if (invoice.kunde_uid) {
    pdf.setFontSize(7);
    pdf.setTextColor(140, 140, 140);
    pdf.text(`UID: ${invoice.kunde_uid}`, ml, y + 2);
    y += 4;
  }

  // Meta info (right side)
  const metaX = pageWidth - mr - 55;
  let metaY = y - 12;
  pdf.setFontSize(7.5);
  const datumFormatted = new Date(invoice.datum).toLocaleDateString("de-AT");
  const metaRows: [string, string][] = [
    [`${typLabel} Nr.`, invoice.nummer || "–"],
    ["Datum", datumFormatted],
  ];
  if (!isAngebot && invoice.leistungsdatum) metaRows.push(["Leistungsdatum", new Date(invoice.leistungsdatum).toLocaleDateString("de-AT")]);
  if (!isAngebot && invoice.faellig_am) metaRows.push(["Fällig am", new Date(invoice.faellig_am).toLocaleDateString("de-AT")]);
  if (invoice.gueltig_bis) metaRows.push(["Gültig bis", new Date(invoice.gueltig_bis).toLocaleDateString("de-AT")]);
  if (!isAngebot && invoice.zahlungsbedingungen) metaRows.push(["Zahlung", invoice.zahlungsbedingungen]);

  metaRows.forEach(([label, value]) => {
    pdf.setTextColor(140, 140, 140);
    pdf.text(label, metaX, metaY);
    pdf.setTextColor(30, 30, 30);
    pdf.setFont("helvetica", "bold");
    pdf.text(value, metaX + 35, metaY);
    pdf.setFont("helvetica", "normal");
    metaY += 4.5;
  });

  y = Math.max(y, metaY) + 4;

  // Document title
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.setTextColor(30, 30, 30);
  pdf.text(`${typLabel}${invoice.nummer ? ` Nr.: ${invoice.nummer}` : ""}`, ml, y);
  y += 2;
  pdf.setDrawColor(204, 0, 0);
  pdf.setLineWidth(0.8);
  pdf.line(ml, y, pageWidth - mr, y);
  y += 6;

  // ======= ITEMS TABLE (autoTable handles page breaks + header repeat) =======
  const tableHead = [["Pos.", "Menge", "Einh.", "Beschreibung", "Preis", "Gesamt"]];
  const tableBody = items.map(item => [
    String(item.position).padStart(2, "0"),
    fmt(Number(item.menge)),
    item.einheit || "Stk.",
    item.beschreibung,
    fmtCurrency(Number(item.einzelpreis)),
    fmtCurrency(Number(item.gesamtpreis)),
  ]);

  // Reserve space for totals block (~45mm) so it's never alone on last page
  const totalsHeight = 50;

  autoTable(pdf, {
    startY: y,
    head: tableHead,
    body: tableBody,
    theme: "plain",
    margin: { left: ml, right: mr, bottom: 30 + totalsHeight },
    headStyles: {
      fillColor: [245, 245, 245],
      textColor: [80, 80, 80],
      fontStyle: "bold",
      fontSize: 7,
      cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 },
      lineWidth: { bottom: 0.5 },
      lineColor: [60, 60, 60],
    },
    bodyStyles: {
      fontSize: 8,
      cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 },
      textColor: [40, 40, 40],
      lineWidth: { bottom: 0.15 },
      lineColor: [220, 220, 220],
    },
    columnStyles: {
      0: { halign: "center", cellWidth: 12, textColor: [140, 140, 140] },
      1: { halign: "right", cellWidth: 16 },
      2: { halign: "center", cellWidth: 14, textColor: [140, 140, 140] },
      3: { halign: "left" },
      4: { halign: "right", cellWidth: 22 },
      5: { halign: "right", cellWidth: 24, fontStyle: "bold" },
    },
  });

  // Get Y after table
  y = (pdf as any).lastAutoTable.finalY + 4;

  // ======= TOTALS =======
  const rabattProzent = Number(invoice.rabatt_prozent) || 0;
  const rabattBetrag = Number(invoice.rabatt_betrag) || 0;
  const positionenNetto = items.reduce((s, it) => s + Number(it.gesamtpreis), 0);
  const rabattWert = rabattProzent > 0 ? positionenNetto * (rabattProzent / 100) : rabattBetrag;
  const bezahltBetrag = Number(invoice.bezahlt_betrag) || 0;
  const restBetrag = Number(invoice.brutto_summe) - bezahltBetrag;

  // Totals should always fit because autoTable reserved extra bottom margin
  // But double-check just in case
  if (y + 35 > pageHeight - 20) {
    pdf.addPage();
    y = 15;
  }

  const totalsX = pageWidth - mr - 70;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);

  if (rabattWert > 0) {
    pdf.setTextColor(100, 100, 100);
    pdf.text("Zwischensumme", totalsX, y);
    pdf.text(fmtCurrency(positionenNetto), pageWidth - mr, y, { align: "right" });
    y += 5;
    pdf.setTextColor(204, 0, 0);
    pdf.text(`Rabatt${rabattProzent > 0 ? ` (${rabattProzent}%)` : ""}`, totalsX, y);
    pdf.text(`- ${fmtCurrency(rabattWert)}`, pageWidth - mr, y, { align: "right" });
    y += 5;
  }

  pdf.setTextColor(100, 100, 100);
  pdf.text("Nettobetrag", totalsX, y);
  pdf.setTextColor(50, 50, 50);
  pdf.text(fmtCurrency(Number(invoice.netto_summe)), pageWidth - mr, y, { align: "right" });
  y += 5;

  pdf.setTextColor(100, 100, 100);
  pdf.text(`USt. ${Number(invoice.mwst_satz).toFixed(0)}%`, totalsX, y);
  pdf.setTextColor(50, 50, 50);
  pdf.text(fmtCurrency(Number(invoice.mwst_betrag)), pageWidth - mr, y, { align: "right" });
  y += 3;

  // Line
  pdf.setDrawColor(204, 0, 0);
  pdf.setLineWidth(0.6);
  pdf.line(totalsX, y, pageWidth - mr, y);
  y += 5;

  // Gross total
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.setTextColor(30, 30, 30);
  pdf.text("Gesamtbetrag", totalsX, y);
  pdf.text(fmtCurrency(Number(invoice.brutto_summe)), pageWidth - mr, y, { align: "right" });
  y += 6;

  // Payment info
  if (!isAngebot && bezahltBetrag > 0) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(22, 163, 74);
    pdf.text("Bereits bezahlt", totalsX, y);
    pdf.text(fmtCurrency(bezahltBetrag), pageWidth - mr, y, { align: "right" });
    y += 4;
    pdf.setTextColor(204, 0, 0);
    pdf.setFont("helvetica", "bold");
    pdf.text("Offener Betrag", totalsX, y);
    pdf.text(fmtCurrency(restBetrag), pageWidth - mr, y, { align: "right" });
    y += 6;
  }

  // ======= NOTES =======
  if (invoice.notizen) {
    y += 4;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(80, 80, 80);
    pdf.text(`Anmerkung: ${invoice.notizen}`, ml, y, { maxWidth: contentWidth });
    y += 8;
  }

  // ======= CLOSING TEXT =======
  y += 2;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(100, 100, 100);
  const zahlungsTage = invoice.zahlungsbedingungen?.match(/(\d+)/)?.[1] || "14";
  const closingText = isAngebot
    ? "Wir freuen uns auf Ihren Auftrag und stehen für Rückfragen jederzeit gerne zur Verfügung."
    : `Wir bedanken uns für Ihren Auftrag und bitten um Überweisung des Rechnungsbetrages innerhalb von ${zahlungsTage} Tagen.`;
  pdf.text(closingText, ml, y, { maxWidth: contentWidth });
  y += 8;

  // ======= BANK INFO (only for Rechnung) =======
  if (!isAngebot) {
    if (y + 20 > pageHeight - 30) { pdf.addPage(); y = 15; }
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(80, 80, 80);
    pdf.text(`Bankverbindung: ${bank.kontoinhaber} \u00B7 IBAN: ${bank.iban} \u00B7 BIC: ${bank.bic}`, ml, y);
    y += 5;

    // QR Code
    if (qrCodeDataUri) {
      try {
        pdf.addImage(qrCodeDataUri, "PNG", pageWidth - mr - 22, y - 8, 22, 22);
        pdf.setFontSize(5.5);
        pdf.setTextColor(140, 140, 140);
        pdf.text("Zahlen mit Code", pageWidth - mr - 11, y + 16, { align: "center" });
      } catch {}
    }
  }

  // ======= FOOTER on every page =======
  const totalPages = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    const fy = pageHeight - 16;

    pdf.setDrawColor(204, 0, 0);
    pdf.setLineWidth(0.3);
    pdf.line(ml, fy, pageWidth - mr, fy);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6);
    pdf.setTextColor(140, 140, 140);
    pdf.text(
      "Gottfried Tilger \u00B7 Fliesentechnik & Natursteinteppich \u00B7 Bahnhofstr. 174 \u00B7 8831 Niederwölz \u00B7 +43 664 44 35 346 \u00B7 info@ft-tilger.at",
      pageWidth / 2, fy + 4, { align: "center" }
    );
    pdf.text(`IBAN: ${bank.iban} \u00B7 BIC: ${bank.bic}`, pageWidth / 2, fy + 7.5, { align: "center" });
    pdf.text(`Seite ${i} von ${totalPages}`, pageWidth - mr, fy + 7.5, { align: "right" });
  }

  return pdf.output("blob");
}

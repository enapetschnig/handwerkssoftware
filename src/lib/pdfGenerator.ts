import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { InvoiceHtmlData, InvoiceHtmlItem, BankData } from "./invoiceHtml";
import { type InvoiceLayoutSettings, DEFAULT_LAYOUT, hexToRgb } from "./invoiceLayoutTypes";
import { drawLetterhead, drawFooter, LETTERHEAD_MARGIN } from "./pdfLetterhead";
import { DEFAULT_MAHNUNG_SETTINGS, renderMahnungText, type MahnungSettings } from "./mahnungSettings";
import { getDocConfig } from "./documentTypes";

const DEFAULT_BANK: BankData = {
  kontoinhaber: "",
  iban: "",
  bic: "",
};

// Sanitize Text für jsPDF Helvetica (WinAnsi): ersetzt Sonderzeichen die nicht im Zeichensatz sind
// Deutsche Umlaute ä/ö/ü/ß/€ sind in cp1252 vorhanden und funktionieren
// Fallback für exotische Zeichen: auf ASCII-Äquivalent reduzieren
function safePdfText(input: string | null | undefined): string {
  if (!input) return "";
  // jsPDF Helvetica unterstützt WinAnsi (cp1252). Problem-Zeichen:
  // - Emojis/Unicode > U+00FF → entfernen oder ?
  return String(input).replace(/[^\u0000-\u00FF€]/g, "?");
}

function fmt(val: number): string {
  if (!isFinite(val)) return "0,00";
  const parts = val.toFixed(2).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return parts.join(",");
}

function fmtCurrency(val: number): string {
  return `€ ${fmt(val)}`;
}

// Timezone-safe date formatting — "2026-03-24" should always show as 24.03.2026
function fmtDate(dateStr: string): string {
  if (!dateStr) return "–";
  // Parse as local date (not UTC) by splitting the string
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }
  return new Date(dateStr + "T12:00:00").toLocaleDateString("de-AT");
}

export async function generateInvoicePdf(
  invoice: InvoiceHtmlData,
  items: InvoiceHtmlItem[],
  bank: BankData = DEFAULT_BANK,
  logoDataUri?: string,
  qrCodeDataUri?: string,
  firmenUid?: string,
  layout?: InvoiceLayoutSettings
): Promise<Blob> {
  const L = layout || DEFAULT_LAYOUT;
  const [acR, acG, acB] = hexToRgb(L.accent_color);
  const docCfg = getDocConfig(invoice.typ);
  const typLabel = docCfg.label;
  const isAngebot = docCfg.isAngebotLike;               // Angebot + AB: kein Zahlungsblock, Angebots-Closing
  const showLeistungsdatum = docCfg.showLeistungsdatum; // alle außer Angebot + AB
  const showFaelligAm = docCfg.showPaymentSection;      // nur Rechnungs-artige
  const showBank = docCfg.isInvoiceLike && docCfg.typ !== "gutschrift";
  const hidePrices = docCfg.hidePrices;                  // Lieferschein: keine Preise
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const ml = 25; // margin left – DIN 5008 Form B: Textbereich 25mm
  const mr = 15; // margin right
  const contentWidth = pageWidth - ml - mr;
  // DIN 5008 Form B Positionen (A4, Fensterkuvert DIN-lang):
  //   Absenderzeile (klein, unterstrichen): y = 45 mm
  //   Anschriftenfeld (Empfänger):          y = 50 … 90 mm (40 mm hoch, 85 mm breit)
  //   Informationsblock (Meta rechts):      y = 50 mm parallel zur Anschrift
  const DIN_SENDER_Y = 45;
  const DIN_RECIPIENT_Y = 50;

  // ======= HEADER (only first page) =======
  let y = 15;
  let logoBottomY = y;
  let logoRightX = ml;

  // Logo — preserve aspect ratio from actual image dimensions
  if (logoDataUri) {
    try {
      let logoW = L.logo.width_mm;
      let logoH = L.logo.height_mm;
      try {
        const props = pdf.getImageProperties(logoDataUri);
        if (props.width > 0 && props.height > 0) {
          const aspect = props.width / props.height;
          logoH = logoW / aspect;
        }
      } catch {}
      const logoX = L.logo.position === "right" ? pageWidth - mr - logoW
        : L.logo.position === "center" ? (pageWidth - logoW) / 2
        : ml;
      pdf.addImage(logoDataUri, "PNG", logoX, y, logoW, logoH);
      logoBottomY = y + logoH;
      logoRightX = logoX + logoW;
    } catch {}
  }

  // Firmen-Info rechts — nur wenn neben dem Logo genügend Platz ist (≥ 30mm)
  const infoStartX = Math.max(logoRightX + 5, pageWidth - mr - 40);
  const availableInfoWidth = pageWidth - mr - infoStartX;
  if (availableInfoWidth >= 30) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(80, 80, 80);
    const companyInfoLines: string[] = [
      L.company.address_line1,
      L.company.address_line2,
      L.company.phone ? "Tel: " + L.company.phone : "",
      L.company.email,
    ].filter(Boolean);
    companyInfoLines.forEach((line, i) => {
      pdf.text(line, pageWidth - mr, y + 3 + i * 3.5, { align: "right" });
    });
    if (firmenUid) {
      pdf.text(`UID: ${firmenUid}`, pageWidth - mr, y + 3 + companyInfoLines.length * 3.5, { align: "right" });
    }
  }

  // Falzmarken nach DIN 5008 (links am Blattrand, dezent grau):
  //   1. Falz bei 105 mm, 2. Falz bei 210 mm, Lochmarke bei 148,5 mm.
  pdf.setDrawColor(180, 180, 180);
  pdf.setLineWidth(0.15);
  pdf.line(3, 105, 6, 105);       // Falzmarke oben
  pdf.line(1.5, 148.5, 5, 148.5); // Lochmarke Mitte
  pdf.line(3, 210, 6, 210);       // Falzmarke unten

  // Falls der Briefkopf weiter unten enden würde als die Absenderzeile,
  // warnen wir implizit: das Logo darf höchstens bis y=43mm ragen.
  // DIN 5008: Absenderzeile fest bei 45 mm, Empfänger ab 50 mm.
  y = DIN_SENDER_Y;

  // Sender line (Absenderzeile über dem Empfänger, klein + unterstrichen)
  pdf.setFontSize(7);
  pdf.setTextColor(0, 0, 0);
  const senderText = L.sender_line || [L.company.name, L.company.address_line1, L.company.address_line2].filter(Boolean).join(" \u00B7 ");
  pdf.text(senderText, ml, y);
  // Unterstreichende Linie exakt so lang wie die Absenderzeile
  const senderWidth = pdf.getTextWidth(senderText);
  pdf.setDrawColor(180, 180, 180);
  pdf.setLineWidth(0.2);
  pdf.line(ml, y + 1.5, ml + senderWidth, y + 1.5);
  // Empfängeradresse startet gemäß DIN bei exakt 50 mm
  y = DIN_RECIPIENT_Y;

  // Recipient
  const kundeAnrede = (invoice as any).kunde_anrede || "";
  const kundeTitel = (invoice as any).kunde_titel || "";
  if (kundeAnrede) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(0, 0, 0);
    pdf.text(kundeAnrede, ml, y + 2);
    y += 5;
  }
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(0, 0, 0);
  const displayName = kundeTitel ? `${kundeTitel} ${invoice.kunde_name}` : (invoice.kunde_name || "–");
  pdf.text(displayName, ml, y + 2);
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

  // Meta info (right side) – Informationsblock nach DIN 5008:
  //   Startet auf gleicher Höhe wie das Anschriftenfeld (y = 50 mm),
  //   rechts daneben in einer Spalte.
  const metaX = pageWidth - mr - 60;
  let metaY = DIN_RECIPIENT_Y;
  pdf.setFontSize(9);
  const datumFormatted = fmtDate(invoice.datum);
  const kundennummer = (invoice as any).kundennummer || "";
  const metaRows: [string, string][] = [
    [`${typLabel} Nr.`, invoice.nummer || "–"],
    ["Belegdatum", datumFormatted],
  ];
  if (invoice.kunde_uid) metaRows.push(["Ihre UID", invoice.kunde_uid]);
  if (showLeistungsdatum && invoice.leistungsdatum) metaRows.push(["Leistungsdatum", fmtDate(invoice.leistungsdatum!)]);
  if (kundennummer) metaRows.push(["Kundennr.", kundennummer]);
  if (showFaelligAm && invoice.faellig_am) metaRows.push(["Fällig am", fmtDate(invoice.faellig_am!)]);
  if (invoice.gueltig_bis) metaRows.push(["Gültig bis", fmtDate(invoice.gueltig_bis!)]);

  metaRows.forEach(([label, value]) => {
    pdf.setTextColor(0, 0, 0);
    pdf.text(label, metaX, metaY);
    pdf.setTextColor(0, 0, 0);
    pdf.setFont("helvetica", "bold");
    pdf.text(value, metaX + 38, metaY);
    pdf.setFont("helvetica", "normal");
    metaY += 5;
  });

  // Ansprechpartner unter der Meta-Box. Quelle: ausschließlich die am
  // Dokument gespeicherten Felder invoice.ansprechpartner_*.
  // Der Block wird KOMPLETT ausgeblendet, wenn nichts eingetragen ist —
  // auch Überschrift und Platzhaltertext fehlen dann auf dem PDF.
  const contactName = ((invoice as any).ansprechpartner_name || "").toString().trim();
  const contactPhone = ((invoice as any).ansprechpartner_telefon || "").toString().trim();
  const contactEmail = ((invoice as any).ansprechpartner_email || "").toString().trim();
  const hasContact = !!(contactName || contactPhone || contactEmail);
  if (hasContact) {
    metaY += 2;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(100, 100, 100);
    pdf.text("Ihr Ansprechpartner:", metaX, metaY);
    metaY += 4;
    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(9);
    if (contactName) { pdf.text(contactName, metaX, metaY); metaY += 4; }
    if (contactPhone) { pdf.text(contactPhone, metaX, metaY); metaY += 4; }
    if (contactEmail) { pdf.text(contactEmail, metaX, metaY); metaY += 4; }
  }

  y = Math.max(y, metaY) + 4;

  // Document title: "Angebot - <betreff>" (ohne Nummer; die steht rechts oben)
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.setTextColor(0, 0, 0);
  const titleText = invoice.betreff
    ? `${typLabel} – ${invoice.betreff}`
    : typLabel;
  // mehrzeilig möglich
  const titleLines = pdf.splitTextToSize(titleText, contentWidth);
  titleLines.forEach((line: string, i: number) => {
    pdf.text(line, ml, y + i * 5.5);
  });
  y += titleLines.length * 5.5;
  y += 1;
  pdf.setDrawColor(acR, acG, acB);
  pdf.setLineWidth(0.8);
  pdf.line(ml, y, pageWidth - mr, y);
  y += 6;

  // ======= ITEMS TABLE =======
  // Lieferschein: ohne Preisspalten
  const tableHead = hidePrices
    ? [["Pos.", "Menge", "Einheit", "Beschreibung"]]
    : [["Pos.", "Menge", "Einheit", "Beschreibung", "Preis (netto)", "Gesamt (netto)"]];

  // Angebots-/Rechnungs-Positionen nach gängigem Layout (z.B. sevDesk,
  // Lexoffice): enge Row-Höhe, Trennlinie direkt unter dem letzten
  // Textlauf, minimaler Bottom-Puffer (ca. 1–1.5 mm), Langtext kommt
  // kursiv grau direkt unter dem Kurztext mit ~1 mm Abstand.
  //
  // Strategie:
  // 1) Zellen-Text ist NUR der Kurztext. autoTable reserviert also nur
  //    Kurztext-Höhe, was unerwünschte Luft vermeidet.
  // 2) In didParseCell setzen wir minCellHeight exakt auf
  //    padTop + kurzHöhe + (gap + langHöhe)? + padBottom.
  //    So kennt autoTable die Gesamt-Höhe fürs Page-Break-Handling
  //    → Kurz- und Langtext bleiben IMMER zusammen (Row wird als
  //    Einheit umgebrochen).
  // 3) In didDrawCell malen wir den Langtext kursiv klein direkt unter
  //    den bereits gezeichneten Kurztext. Kein Overpaint, kein Weiß.
  const KURZ_FONT_SIZE = 9;
  const LANG_FONT_SIZE = 7.5;
  const LINE_HEIGHT_FACTOR = 1.15;
  const ptToMm = (pt: number) => pt * 0.3528;
  const linesHeightMm = (n: number, pt: number) => n * ptToMm(pt) * LINE_HEIGHT_FACTOR;
  const CELL_PAD_TOP = 2.5;
  const CELL_PAD_BOTTOM = 1.5;  // enge Trennlinie direkt unter dem Text
  const LANG_GAP = 1.0;         // kleiner Abstand zwischen Kurz und Lang

  const langtextInfo: Record<number, { kurztext: string; langtext: string }> = {};
  const tableBody: string[][] = [];
  items.forEach((item, idx) => {
    const kurztext = (item as any).kurztext || item.beschreibung;
    const langtext = (item as any).langtext || "";
    if (langtext && langtext !== kurztext) {
      langtextInfo[idx] = { kurztext, langtext };
    }
    // Nur Kurztext in die Zelle. Langtext wird in didDrawCell manuell
    // darunter gezeichnet; die zusätzliche Höhe reserviert didParseCell
    // via minCellHeight.
    const row = [
      String(item.position).padStart(2, "0"),
      fmt(Number(item.menge)),
      item.einheit || "Stk.",
      kurztext,
    ];
    if (!hidePrices) {
      row.push(fmtCurrency(Number(item.einzelpreis)));
      row.push(fmtCurrency(Number(item.gesamtpreis)));
    }
    tableBody.push(row);
  });

  // Build totals rows for the table footer
  const rabattProzent = Number(invoice.rabatt_prozent) || 0;
  const rabattBetrag = Number(invoice.rabatt_betrag) || 0;
  const positionenNetto = items.reduce((s, it) => s + Number(it.gesamtpreis), 0);
  const rabattWert = rabattProzent > 0 ? positionenNetto * (rabattProzent / 100) : rabattBetrag;
  const bezahltBetrag = Number(invoice.bezahlt_betrag) || 0;
  const restBetrag = Number(invoice.brutto_summe) - bezahltBetrag;

  const tableFoot: string[][] = [];
  const isReverseCharge = (invoice as any).reverse_charge === true;
  if (!hidePrices) {
    if (rabattWert > 0) {
      tableFoot.push(["", "", "", "Zwischensumme", "", fmtCurrency(positionenNetto)]);
      tableFoot.push(["", "", "", `Rabatt${rabattProzent > 0 ? ` (${rabattProzent}%)` : ""}`, "", `- ${fmtCurrency(rabattWert)}`]);
    }
    if (isReverseCharge) {
      tableFoot.push(["", "", "", "Rechnungsbetrag", "", fmtCurrency(Number(invoice.netto_summe))]);
    } else {
      tableFoot.push(["", "", "", "Nettobetrag", "", fmtCurrency(Number(invoice.netto_summe))]);
      tableFoot.push(["", "", "", `USt. ${(Number(invoice.mwst_satz) || 20).toFixed(0)}%`, "", fmtCurrency(Number(invoice.mwst_betrag) || 0)]);
      tableFoot.push(["", "", "", "Bruttobetrag", "", fmtCurrency(Number(invoice.brutto_summe))]);
    }
  }

  const skontoProzent = (invoice as any).skonto_prozent || 0;
  const skontoTage = (invoice as any).skonto_tage || 0;

  // Closing section height (Summen + Zahlungstext + Skonto + Bank + QR + Hinweis + Vielen Dank)
  let closingH = tableFoot.length * 7 + 15; // totals + base spacing
  if (invoice.notizen) closingH += 12;
  if (isReverseCharge && !hidePrices) closingH += 14;
  if (showFaelligAm) closingH += 13;
  if (showFaelligAm && skontoProzent > 0 && skontoTage > 0) closingH += 24;
  if (showBank) closingH += 40;
  if (!showFaelligAm && !showBank) closingH += 8;

  // Dynamic footer height: base + jede Textzeile + ggf. Seitennummer-Zeile
  const footerLines = [L.footer.line1 || "auto", L.footer.show_bank_in_footer ? "bank" : "", L.footer.line2, L.footer.line3].filter(Boolean);
  const footerH = 8 + footerLines.length * 4 + (L.footer.show_page_numbers ? 4 : 0);

  // Spaltenbreite für Beschreibungsspalte berechnen (für Höhen-Schätzung).
  const fixedWidths = hidePrices ? 12 + 18 + 18 : 12 + 18 + 18 + 24 + 26;
  const descWidth = contentWidth - fixedWidths - 4; // grob; Padding/Border
  // autoTable rendert den Body. WICHTIG: margin.bottom reserviert nur den
  // Footer + einen kleinen Puffer – nicht den kompletten Closing-Bereich.
  // Sonst hätte autoTable auf Rechnungen (closingH >80mm mit Bank, Skonto,
  // Fälligkeit) zu wenig Platz und würde die erste Position sofort auf
  // Seite 2 schieben → Seite 1 bliebe leer.
  //
  // Stattdessen prüfen wir NACH autoTable, ob das Closing noch auf die
  // aktuelle Seite passt; wenn nein, addPage() (siehe unten).
  autoTable(pdf, {
    startY: y,
    head: tableHead,
    body: tableBody,
    theme: "plain",
    rowPageBreak: "avoid",
    margin: { left: ml, right: mr, bottom: footerH + 12 },
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
      fontSize: KURZ_FONT_SIZE,
      cellPadding: { top: CELL_PAD_TOP, bottom: CELL_PAD_BOTTOM, left: 2, right: 2 },
      textColor: [0, 0, 0],
      lineWidth: { bottom: 0.15 },
      lineColor: [190, 190, 190],
      valign: "top",
    },
    columnStyles: {
      0: { halign: "center", cellWidth: 12, textColor: [0, 0, 0] },
      1: { halign: "right", cellWidth: 18 },
      2: { halign: "center", cellWidth: 18, textColor: [0, 0, 0] },
      3: { halign: "left" },
      4: { halign: "right", cellWidth: 24 },
      5: { halign: "right", cellWidth: 26, fontStyle: "bold" },
    },
    didParseCell: (data: any) => {
      // minCellHeight für die komplette Row setzen, wenn Langtext
      // vorhanden ist. autoTable nimmt das Maximum aller Zellen-Höhen
      // der Row, deshalb reicht es, den Wert in der Beschreibungsspalte
      // zu setzen.
      if (data.section === "body" && data.column.index === 3) {
        const info = langtextInfo[data.row.index];
        if (info) {
          try {
            pdf.setFontSize(KURZ_FONT_SIZE);
            const kurzLines = pdf.splitTextToSize(info.kurztext, descWidth);
            pdf.setFontSize(LANG_FONT_SIZE);
            const langLines = pdf.splitTextToSize(info.langtext, descWidth);
            pdf.setFontSize(KURZ_FONT_SIZE);
            const h = CELL_PAD_TOP
              + linesHeightMm(kurzLines.length, KURZ_FONT_SIZE)
              + LANG_GAP
              + linesHeightMm(langLines.length, LANG_FONT_SIZE)
              + CELL_PAD_BOTTOM;
            data.cell.styles.minCellHeight = h;
            // Auch das Row-Level signalisieren (manche autoTable-Versionen
            // nutzen row.height separat).
            if (data.row) data.row.height = Math.max(data.row.height || 0, h);
          } catch { /* fallback: auto */ }
        }
      }
    },
    didDrawCell: (data: any) => {
      // autoTable hat den Kurztext in 9pt gezeichnet. Wir malen nun den
      // Langtext direkt darunter (ohne Overpaint, ohne Bottom-Border
      // nachzuzeichnen — die zieht autoTable selbst).
      if (data.section === "body" && data.column.index === 3) {
        const info = langtextInfo[data.row.index];
        if (info) {
          try {
            const cellW = data.cell.width - 4;
            const cellX = data.cell.x + 2;
            pdf.setFontSize(KURZ_FONT_SIZE);
            const kurzLines = pdf.splitTextToSize(info.kurztext, cellW);
            const kurzH = linesHeightMm(kurzLines.length, KURZ_FONT_SIZE);
            pdf.setFont("helvetica", "italic");
            pdf.setFontSize(LANG_FONT_SIZE);
            pdf.setTextColor(120, 120, 120);
            const langLines = pdf.splitTextToSize(info.langtext, cellW);
            const langBaselineY = data.cell.y + CELL_PAD_TOP + kurzH + LANG_GAP + ptToMm(LANG_FONT_SIZE);
            pdf.text(langLines, cellX, langBaselineY);
            // Reset
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(KURZ_FONT_SIZE);
            pdf.setTextColor(0, 0, 0);
          } catch { /* ignore */ }
        }
      }
    },
  });

  y = (pdf as any).lastAutoTable.finalY;

  // Prüfen: passt das Closing (Totals + Zahlungstext + evtl. Skonto +
  // Bank + Reverse-Charge + Notizen) noch auf die aktuelle Seite?
  // Falls nicht → addPage und Closing auf neuer Seite zeichnen.
  // Keine Row-Duplikation, autoTable hat alle Rows schon korrekt verteilt.
  const spaceLeft = pageHeight - footerH - 4 - y;
  if (spaceLeft < closingH) {
    pdf.addPage();
    y = 20;
  }

  // ======= TOTALS (manually drawn, not in autoTable) =======
  y += 2;
  // Separator line above totals (nur wenn tatsächlich Summen-Zeilen folgen)
  if (tableFoot.length > 0) {
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.8);
    pdf.line(ml, y, pageWidth - mr, y);
    y += 1;
  }

  tableFoot.forEach((row) => {
    const label = row[3];
    const value = row[5];
    const isBrutto = label === "Bruttobetrag";
    const isRabatt = label.startsWith("Rabatt");

    if (isBrutto) {
      pdf.setDrawColor(0, 0, 0);
      pdf.setLineWidth(0.8);
      pdf.line(ml, y + 1, pageWidth - mr, y + 1);
    }

    pdf.setFont("helvetica", isBrutto ? "bold" : "normal");
    pdf.setFontSize(isBrutto ? 10 : 9);
    pdf.setTextColor(isRabatt ? 204 : 0, 0, 0);
    // Label right-aligned in the middle area, value right-aligned at right margin
    pdf.text(label, pageWidth - mr - 28, y + 5, { align: "right" });
    pdf.setFont("helvetica", "bold");
    pdf.text(value, pageWidth - mr - 2, y + 5, { align: "right" });
    pdf.setFont("helvetica", "normal");
    y += 7;
  });
  y += 2;

  // ======= NOTES =======
  if (invoice.notizen) {
    y += 4;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(0, 0, 0);
    pdf.text(`Anmerkung: ${invoice.notizen}`, ml, y, { maxWidth: contentWidth });
    y += 8;
  }

  // ======= REVERSE CHARGE HINWEIS (nur bei Rechnungsbelegen) =======
  if (isReverseCharge && !hidePrices) {
    y += 4;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.setTextColor(0, 0, 0);
    pdf.text("Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge)", ml, y);
    y += 4;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    // §19 Abs. 1a UStG: Bauleistungen (häufigster Fall bei BKS).
    pdf.text("Es wird darauf hingewiesen, dass die Steuerschuld gem. § 19 Abs. 1a UStG auf den Leistungsempfänger übergeht.", ml, y, { maxWidth: contentWidth });
    y += 6;
  }

  // ======= CLOSING TEXT =======
  y += 2;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(0, 0, 0);
  const zahlungsbedingungen = (invoice.zahlungsbedingungen || "").trim();
  const zahlungsTageMatch = zahlungsbedingungen.match(/(\d+)/);
  // "sofort" / "prompt" / sonstige Texte ohne Zahl → direkt den Text nehmen.
  const isZahlungSofort = /sofort|umgehend|prompt/i.test(zahlungsbedingungen);
  const customClosing = (invoice as any).custom_closing_text as string | undefined;
  if (customClosing) {
    pdf.text(customClosing, ml, y, { maxWidth: contentWidth });
    y += 8;
  } else if (isAngebot) {
    pdf.text(L.closing_text_angebot, ml, y, { maxWidth: contentWidth });
    y += 8;
  } else if (docCfg.isInvoiceLike) {
    let closingText: string;
    if (isZahlungSofort) {
      closingText = "Zahlbar sofort ohne Abzug.";
    } else if (zahlungsTageMatch) {
      closingText = L.closing_text_invoice.replace("{{tage}}", zahlungsTageMatch[1]);
    } else if (zahlungsbedingungen) {
      // freier Text (z.B. "bei Lieferung bar") → direkt übernehmen
      closingText = zahlungsbedingungen;
    } else {
      closingText = L.closing_text_invoice.replace("{{tage}}", "14");
    }
    pdf.text(closingText, ml, y, { maxWidth: contentWidth });
    y += 5;
    pdf.setFontSize(7.5);
    pdf.setTextColor(0, 0, 0);
    pdf.text(`Bei E-Banking bitte als Zahlungsreferenz ${docCfg.label}snummer ${invoice.nummer || ""} und Kundennummer ${kundennummer || ""} eingeben.`, ml, y, { maxWidth: contentWidth });
    y += 8;
  } else {
    // Lieferschein
    y += 8;
  }
  // ======= SKONTO INFO (only for Rechnung with Skonto) =======
  if (showFaelligAm && skontoProzent > 0 && skontoTage > 0) {
    const brutto = Number(invoice.brutto_summe);
    const skontoAbzug = brutto * (skontoProzent / 100);
    const skontoBetrag = brutto - skontoAbzug;
    const skontoDatum = new Date(invoice.datum + "T12:00:00");
    skontoDatum.setDate(skontoDatum.getDate() + skontoTage);
    const skontoDateStr = skontoDatum.toLocaleDateString("de-AT");
    const faelligDateStr = invoice.faellig_am ? fmtDate(invoice.faellig_am!) : "";

    // Skonto box
    pdf.setDrawColor(200, 200, 200);
    pdf.setLineWidth(0.3);
    pdf.roundedRect(ml, y - 2, contentWidth, faelligDateStr ? 22 : 16, 1, 1);

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(0, 0, 0);
    pdf.text("Zahlungsbedingungen:", ml + 3, y + 2);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text(`Bei Zahlung bis ${skontoDateStr}:`, ml + 3, y + 7);
    pdf.setFont("helvetica", "bold");
    pdf.text(`€ ${fmt(skontoBetrag)}`, ml + 70, y + 7);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(0, 0, 0);
    pdf.text(`(${skontoProzent}% Skonto = € ${fmt(skontoAbzug)} Abzug)`, ml + 100, y + 7);

    if (faelligDateStr) {
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(0, 0, 0);
      pdf.text(`Zahlbar bis ${faelligDateStr}:`, ml + 3, y + 13);
      pdf.setFont("helvetica", "bold");
      pdf.text(`€ ${fmt(brutto)}`, ml + 70, y + 13);
      pdf.setFont("helvetica", "normal");
      pdf.text("(ohne Abzug)", ml + 100, y + 13);
      y += 24;
    } else {
      y += 18;
    }
  }

  // ======= BANK INFO (nur Rechnungs-artige Dokumente) =======
  if (showBank) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(0, 0, 0);
    const bankLine = bank.kontoinhaber
      ? `Kontoinhaber: ${bank.kontoinhaber} \u00B7 IBAN: ${bank.iban} \u00B7 BIC: ${bank.bic}`
      : `IBAN: ${bank.iban} \u00B7 BIC: ${bank.bic}`;
    pdf.text(bankLine, ml, y);
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

    y += 20;

    // Vielen Dank
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(0, 0, 0);
    pdf.text(L.danke_text, pageWidth / 2, y, { align: "center" });
    y += 8;
  }

  // ======= FOOTER on every page =======
  const totalPages = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    const fy = pageHeight - footerH - 4;

    pdf.setDrawColor(acR, acG, acB);
    pdf.setLineWidth(0.3);
    pdf.line(ml, fy, pageWidth - mr, fy);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(0, 0, 0);
    let footerY = fy + 4;
    const footerLine1 = L.footer.line1 || [L.company.name, L.company.slogan, L.company.address_line1, L.company.address_line2, L.company.phone, L.company.email].filter(Boolean).join(" \u00B7 ");
    pdf.text(footerLine1, pageWidth / 2, footerY, { align: "center" });
    footerY += 4;
    if (L.footer.show_bank_in_footer) {
      const ibanLine = bank.kontoinhaber
        ? `Kontoinhaber: ${bank.kontoinhaber} \u00B7 IBAN: ${bank.iban} \u00B7 BIC: ${bank.bic}`
        : `IBAN: ${bank.iban} \u00B7 BIC: ${bank.bic}`;
      pdf.text(ibanLine, pageWidth / 2, footerY, { align: "center" });
      footerY += 4;
    }
    if (L.footer.line2) {
      pdf.text(L.footer.line2, pageWidth / 2, footerY, { align: "center" });
      footerY += 4;
    }
    if (L.footer.line3) {
      pdf.text(L.footer.line3, pageWidth / 2, footerY, { align: "center" });
      footerY += 4;
    }
    // Seitennummer in eigener letzter Zeile (rechts), damit sie den
    // zentrierten Text nicht überschreibt.
    if (L.footer.show_page_numbers) {
      pdf.text(`Seite ${i} von ${totalPages}`, pageWidth - mr, footerY, { align: "right" });
    }
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
  logoDataUri?: string,
  layout?: InvoiceLayoutSettings
): Blob {
  const L = layout || DEFAULT_LAYOUT;
  const [acR, acG, acB] = hexToRgb(L.accent_color);
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const ml = LETTERHEAD_MARGIN.left;
  const mr = LETTERHEAD_MARGIN.right;

  // Einheitlicher BKS-Briefkopf
  const { afterY } = drawLetterhead(pdf, L, logoDataUri);
  let y = afterY;

  // "STORNO" Titel in BKS-Blau
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.setTextColor(acR, acG, acB);
  pdf.text("STORNO", ml, y);
  y += 4;
  pdf.setDrawColor(acR, acG, acB);
  pdf.setLineWidth(1);
  pdf.line(ml, y, pageWidth - mr, y);
  y += 10;

  // Storno details
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(0, 0, 0);

  const details: [string, string][] = [
    ["Stornonummer:", stornoNummer],
    ["Stornodatum:", fmtDate(stornoDatum)],
    ["Rechnungsnummer:", invoice.nummer],
    ["Rechnungsdatum:", fmtDate(invoice.datum)],
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

  // Einheitlicher BKS-Footer
  drawFooter(pdf, L, { withPageNumbers: false });

  return pdf.output("blob");
}

// ======= MAHNUNG PDF =======
export function generateMahnungPdf(
  invoice: { nummer: string; datum: string; faellig_am: string; kunde_name: string; kunde_adresse?: string | null; kunde_plz?: string | null; kunde_ort?: string | null; brutto_summe: number; bezahlt_betrag: number },
  mahnstufe: number,
  mahngebuehr: number = 0,
  bank: BankData = DEFAULT_BANK,
  logoDataUri?: string,
  layout?: InvoiceLayoutSettings,
  mahnungSettings?: MahnungSettings,
): Blob {
  const L = layout || DEFAULT_LAYOUT;
  const MS = mahnungSettings || DEFAULT_MAHNUNG_SETTINGS;
  const stufeIdx = Math.min(Math.max(mahnstufe, 1), 3) - 1;
  const stufeConfig = MS.stufen[stufeIdx];
  // Mahngebühr aus Config, wenn nicht explizit mitgegeben
  const effektiveGebuehr = mahngebuehr > 0 ? mahngebuehr : stufeConfig.gebuehr;
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const ml = LETTERHEAD_MARGIN.left;
  const mr = LETTERHEAD_MARGIN.right;

  // Einheitlicher BKS-Briefkopf (Logo + Firmen-Info + Akzent-Linie)
  const { afterY } = drawLetterhead(pdf, L, logoDataUri);
  let y = afterY;

  pdf.setFontSize(6);
  pdf.setTextColor(0, 0, 0);
  pdf.text(L.sender_line || [L.company.name, L.company.address_line1, L.company.address_line2].filter(Boolean).join(" \u00B7 "), ml, y);
  pdf.setDrawColor(200, 200, 200);
  pdf.setLineWidth(0.2);
  pdf.line(ml, y + 1, ml + 85, y + 1);
  y += 5;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(0, 0, 0);
  pdf.text(invoice.kunde_name, ml, y); y += 5;
  if (invoice.kunde_adresse) { pdf.text(invoice.kunde_adresse, ml, y); y += 5; }
  if (invoice.kunde_plz || invoice.kunde_ort) {
    pdf.text(`${invoice.kunde_plz || ""} ${invoice.kunde_ort || ""}`.trim(), ml, y); y += 5;
  }
  y += 10;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.setTextColor(mahnstufe >= 3 ? 204 : 0, 0, 0);
  pdf.text(stufeConfig.titel, ml, y);
  y += 4;
  pdf.setDrawColor(mahnstufe >= 3 ? 204 : 0, 0, 0);
  pdf.setLineWidth(0.8);
  pdf.line(ml, y, pageWidth - mr, y);
  y += 10;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(0, 0, 0);
  pdf.text(`Datum: ${new Date().toLocaleDateString("de-AT")}`, pageWidth - mr, y, { align: "right" });
  y += 8;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  const offenerBetrag = invoice.brutto_summe - invoice.bezahlt_betrag;

  const bodyText = renderMahnungText(stufeConfig.text, {
    tage: stufeConfig.frist_tage,
    rechnungsnummer: invoice.nummer,
    betrag: fmtCurrency(offenerBetrag),
  });

  const bodyLines = pdf.splitTextToSize(bodyText, pageWidth - ml - mr);
  pdf.text(bodyLines, ml, y);
  y += bodyLines.length * 5 + 10;

  const detailRows: [string, string][] = [
    ["Rechnungsnummer:", invoice.nummer],
    ["Rechnungsdatum:", fmtDate(invoice.datum)],
    ["Fällig am:", invoice.faellig_am ? fmtDate(invoice.faellig_am!) : "–"],
    ["Rechnungsbetrag:", fmtCurrency(invoice.brutto_summe)],
  ];
  if (invoice.bezahlt_betrag > 0) detailRows.push(["Bereits bezahlt:", fmtCurrency(invoice.bezahlt_betrag)]);
  detailRows.push(["Offener Betrag:", fmtCurrency(offenerBetrag)]);
  if (effektiveGebuehr > 0) {
    detailRows.push(["Mahngebühr:", fmtCurrency(effektiveGebuehr)]);
    detailRows.push(["Gesamt fällig:", fmtCurrency(offenerBetrag + effektiveGebuehr)]);
  }

  detailRows.forEach(([label, value]) => {
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(0, 0, 0);
    pdf.text(label, ml, y);
    pdf.setFont("helvetica", "bold");
    const isTotalRow = label.startsWith("Offener") || label.startsWith("Gesamt");
    if (isTotalRow) pdf.setFontSize(11);
    pdf.text(value, ml + 50, y);
    pdf.setFontSize(10);
    y += 7;
  });

  y += 8;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text("Bitte überweisen Sie den Betrag auf folgendes Konto:", ml, y); y += 6;
  pdf.setFont("helvetica", "bold");
  if (bank.kontoinhaber) { pdf.text(`Kontoinhaber: ${bank.kontoinhaber}`, ml, y); y += 5; }
  if (bank.iban) { pdf.text(`IBAN: ${bank.iban}`, ml, y); y += 5; }
  if (bank.bic) { pdf.text(`BIC: ${bank.bic}`, ml, y); y += 5; }
  pdf.setFont("helvetica", "normal");
  pdf.text(`Verwendungszweck: ${invoice.nummer}`, ml, y); y += 10;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text("Mit freundlichen Grüßen", ml, y); y += 5;
  pdf.setFont("helvetica", "bold");
  pdf.text(L.company.name, ml, y);

  // Einheitlicher BKS-Footer (BKS-Blau-Akzent-Linie + Firmen-Kurzinfo)
  drawFooter(pdf, L, { withPageNumbers: false });

  return pdf.output("blob");
}

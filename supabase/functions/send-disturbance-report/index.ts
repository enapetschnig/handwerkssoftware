import { Resend } from "https://esm.sh/resend@2.0.0";
import { jsPDF } from "https://esm.sh/jspdf@2.5.2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

// Supabase Admin Client for reading settings
const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const LOGO_BASE64 = "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";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Material {
  id: string;
  material: string;
  menge: string | null;
  einheit: string | null;
  notizen: string | null;
}

interface Photo {
  id: string;
  file_path: string;
  file_name: string;
}

interface Disturbance {
  id: string;
  datum: string;
  start_time: string;
  end_time: string;
  pause_minutes: number;
  stunden: number;
  kunde_name: string;
  kunde_email: string | null;
  kunde_adresse: string | null;
  kunde_telefon: string | null;
  beschreibung: string;
  notizen: string | null;
  unterschrift_kunde: string;
}

interface ReportRequest {
  disturbance: Disturbance;
  materials: Material[];
  technicianNames?: string[];
  technicianName?: string; // Legacy support
  photos?: Photo[];
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("de-AT", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("de-AT", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error("Failed to fetch image:", url, response.status);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);
    const contentType = response.headers.get("content-type") || "image/jpeg";
    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    console.error("Error fetching image:", error);
    return null;
  }
}

async function generatePDF(data: ReportRequest & { technicians: string[] }, photoImages: (string | null)[]): Promise<string> {
  const { disturbance, materials, technicians, photos } = data;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 18;
  const contentWidth = pageWidth - 2 * margin;
  let yPos = margin;

  // Helper: Section title with red left border
  const sectionTitle = (title: string) => {
    doc.setFillColor(224, 138, 32);
    doc.rect(margin, yPos - 4, 2, 6, "F");
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(26, 26, 26);
    doc.text(title, margin + 5, yPos);
    yPos += 7;
  };

  // Helper: Info row
  const infoRow = (label: string, value: string, bold = false) => {
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text(label, margin + 5, yPos);
    doc.setTextColor(26, 26, 26);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.text(value, margin + 42, yPos);
    yPos += 5;
  };

  // === HEADER: Logo + Regiebericht ===
  try {
    const logoB64 = LOGO_BASE64;
    doc.addImage(`data:image/jpeg;base64,${logoB64}`, "JPEG", margin, 8, 55, 22);
  } catch (e) {
    // Fallback text if image fails
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(26, 26, 26);
    doc.text("MONTI.PRO", margin, 18);
  }

  // Red line under header
  doc.setFillColor(224, 138, 32);
  doc.rect(margin, 33, contentWidth, 0.8, "F");

  // "Regiebericht" title on right
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(26, 26, 26);
  doc.text("Regiebericht", pageWidth - margin, 20, { align: "right" });

  // Date below title
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 100, 100);
  doc.text(formatDate(disturbance.datum), pageWidth - margin, 26, { align: "right" });

  yPos = 40;

  // === KEY INFO BOX (light gray background) ===
  const boxHeight = 28;
  doc.setFillColor(247, 247, 247);
  doc.roundedRect(margin, yPos, contentWidth, boxHeight, 2, 2, "F");
  doc.setDrawColor(230, 230, 230);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, yPos, contentWidth, boxHeight, 2, 2, "S");

  const startTime = disturbance.start_time.slice(0, 5);
  const endTime = disturbance.end_time.slice(0, 5);
  const techDisplay = technicians.join(", ");
  const col1 = margin + 5;
  const col2 = margin + contentWidth * 0.35;
  const col3 = margin + contentWidth * 0.7;

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(120, 120, 120);
  doc.text("KUNDE", col1, yPos + 5);
  doc.text("ARBEITSZEIT", col2, yPos + 5);
  doc.text("STUNDEN", col3, yPos + 5);

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(26, 26, 26);
  doc.text(disturbance.kunde_name, col1, yPos + 11);
  doc.text(`${startTime} – ${endTime} Uhr`, col2, yPos + 11);
  doc.text(`${disturbance.stunden.toFixed(2)} h`, col3, yPos + 11);

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80, 80, 80);
  if (disturbance.kunde_adresse) doc.text(disturbance.kunde_adresse, col1, yPos + 16);
  doc.text(`Techniker: ${techDisplay}`, col2, yPos + 16);
  if (disturbance.pause_minutes > 0) {
    doc.text(`Pause: ${disturbance.pause_minutes} Min.`, col3, yPos + 16);
  }

  // Contact info in smaller text
  const contactParts: string[] = [];
  if (disturbance.kunde_telefon) contactParts.push(`Tel: ${disturbance.kunde_telefon}`);
  if (disturbance.kunde_email) contactParts.push(disturbance.kunde_email);
  if (contactParts.length > 0) {
    doc.setFontSize(7);
    doc.setTextColor(130, 130, 130);
    doc.text(contactParts.join(" · "), col1, yPos + 21);
  }

  yPos += boxHeight + 10;

  // === DURCHGEFÜHRTE ARBEITEN ===
  sectionTitle("Durchgeführte Arbeiten");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(40, 40, 40);
  const beschreibungLines = doc.splitTextToSize(disturbance.beschreibung, contentWidth - 5);
  doc.text(beschreibungLines, margin + 5, yPos);
  yPos += beschreibungLines.length * 4.5 + 6;

  // === NOTIZEN ===
  if (disturbance.notizen) {
    sectionTitle("Notizen");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    const notizenLines = doc.splitTextToSize(disturbance.notizen, contentWidth - 5);
    doc.text(notizenLines, margin + 5, yPos);
    yPos += notizenLines.length * 4.5 + 6;
  }

  // Materials Section
  if (materials && materials.length > 0) {
    if (yPos > 220) { doc.addPage(); yPos = margin; }

    sectionTitle("Verwendetes Material");

    // Table header
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(100, 100, 100);
    doc.text("MATERIAL", margin + 5, yPos);
    doc.text("MENGE / EINHEIT", margin + 95, yPos);
    doc.text("NOTIZEN", margin + 130, yPos);
    yPos += 2;
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(margin + 5, yPos, margin + contentWidth, yPos);
    yPos += 4;

    doc.setTextColor(26, 26, 26);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);

    materials.forEach((mat, idx) => {
      if (yPos > 270) { doc.addPage(); yPos = margin; }
      if (idx % 2 === 0) {
        doc.setFillColor(250, 250, 250);
        doc.rect(margin + 3, yPos - 3.5, contentWidth - 3, 6, "F");
      }
      doc.setTextColor(26, 26, 26);
      doc.text(mat.material || "-", margin + 5, yPos);
      doc.setTextColor(80, 80, 80);
      const mengeText = mat.menge ? `${mat.menge}${mat.einheit ? ` ${mat.einheit}` : ""}` : "-";
      doc.text(mengeText, margin + 95, yPos);
      doc.text(mat.notizen || "-", margin + 130, yPos);
      yPos += 6;
    });
    yPos += 6;
  }

  // Photos Section (if present)
  if (photos && photos.length > 0 && photoImages.some(img => img !== null)) {
    // Start new page for photos
    doc.addPage();
    yPos = margin;

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text("Fotos", margin, yPos);
    yPos += 10;

    for (let i = 0; i < photos.length; i++) {
      const imageData = photoImages[i];
      if (!imageData) continue;

      // Check if we need a new page
      if (yPos > 200) {
        doc.addPage();
        yPos = margin;
      }

      try {
        // Add image with max width 80mm, proportional height ~60mm
        doc.addImage(imageData, "JPEG", margin, yPos, 80, 60);
        yPos += 65;

        // Add filename below image
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text(photos[i].file_name, margin, yPos);
        yPos += 8;
        doc.setTextColor(0, 0, 0);
      } catch (e) {
        console.error("Error adding image to PDF:", e);
      }
    }
  }

  // === UNTERSCHRIFT ===
  if (yPos > 210) { doc.addPage(); yPos = margin; }

  sectionTitle("Kundenunterschrift");

  if (disturbance.unterschrift_kunde) {
    try {
      doc.addImage(disturbance.unterschrift_kunde, "PNG", margin + 5, yPos, 55, 22);
      yPos += 26;
    } catch (e) {
      console.error("Error adding signature:", e);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(150, 150, 150);
      doc.text("[Unterschrift konnte nicht geladen werden]", margin + 5, yPos + 8);
      yPos += 16;
    }
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(130, 130, 130);
  doc.text("Der Kunde bestätigt die ordnungsgemäße Durchführung der oben genannten Arbeiten.", margin + 5, yPos);
  yPos += 10;

  // === FOOTER ===
  const pageHeight = doc.internal.pageSize.getHeight();
  const footerY = pageHeight - 12;

  // Thin red line
  doc.setFillColor(224, 138, 32);
  doc.rect(margin, footerY - 3, contentWidth, 0.5, "F");

  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(130, 130, 130);
  doc.text("MONTI.PRO · Ihr Montagetischler · Adresse · PLZ Ort · info@monti.pro", margin, footerY + 1);
  doc.text(`Erstellt: ${new Date().toLocaleDateString("de-AT")}`, pageWidth - margin, footerY + 1, { align: "right" });

  // Return as base64
  return doc.output("datauristring").split(",")[1];
}

function generateEmailHtml(data: ReportRequest & { technicians: string[] }): string {
  const { disturbance, technicians } = data;
  const technicianDisplay = technicians.length === 1 ? technicians[0] : technicians.join(", ");

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; color: #333; line-height: 1.5; }
        .header { font-size: 12px; font-weight: 900; color: #1A1A1A; letter-spacing: 2px; margin-bottom: 2px; }
        .header-large { font-size: 28px; font-weight: 900; color: #1A1A1A; letter-spacing: 1px; margin-bottom: 4px; }
        .header-sub { font-size: 11px; color: #64748b; margin-bottom: 10px; }
        .red-bar { height: 3px; background: #E08A20; margin-bottom: 16px; border-radius: 2px; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .info-box { background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #E08A20; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">MONTI</div>
        <div class="header-large">PRO</div>
        <div class="header-sub">MONTI.PRO · Ihr Montagetischler · Adresse, PLZ Ort</div>
        <div class="red-bar"></div>
        <h2>Regiebericht</h2>

        <p>Sehr geehrte Damen und Herren,</p>

        <p>im Anhang finden Sie den Regiebericht für den Einsatz bei <strong>${disturbance.kunde_name}</strong> vom <strong>${formatDate(disturbance.datum)}</strong>.</p>

        <div class="info-box">
          <strong>Zusammenfassung:</strong><br>
          Techniker: ${technicianDisplay}<br>
          Arbeitszeit: ${disturbance.start_time.slice(0, 5)} - ${disturbance.end_time.slice(0, 5)} Uhr<br>
          Gesamtstunden: ${disturbance.stunden.toFixed(2)} h
        </div>

        <p>Der vollständige Bericht mit allen Details und der Kundenunterschrift befindet sich im angehängten PDF-Dokument.</p>

        <p>Mit freundlichen Grüßen,<br>
        MONTI.PRO<br>
        <span style="color:#64748b;font-size:12px;">Ihr Montagetischler<br>Adresse, PLZ Ort<br>info@monti.pro</span></p>
      </div>
    </body>
    </html>
  `;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { disturbance, materials, technicianNames, technicianName, photos }: ReportRequest = await req.json();

    // Backward compatibility + fallback
    const technicians = technicianNames?.length ? technicianNames :
                        technicianName ? [technicianName] : ["Techniker"];

    if (!disturbance || !disturbance.unterschrift_kunde) {
      return new Response(
        JSON.stringify({ error: "Disturbance data and signature required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("Generating PDF for disturbance:", disturbance.id);

    // Fetch photo images from storage
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const photoImages: (string | null)[] = [];
    if (photos && photos.length > 0) {
      console.log(`Fetching ${photos.length} photos...`);
      for (const photo of photos) {
        const photoUrl = `${supabaseUrl}/storage/v1/object/public/disturbance-photos/${photo.file_path}`;
        const imageData = await fetchImageAsBase64(photoUrl);
        photoImages.push(imageData);
      }
    }

    // Generate PDF
    const pdfBase64 = await generatePDF({ disturbance, materials, technicians, photos }, photoImages);

    // Generate simple email HTML
    const emailHtml = generateEmailHtml({ disturbance, materials, technicians });

    // Fetch office email from settings with fallback
    const { data: setting } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "disturbance_report_email")
      .maybeSingle();

    const officeEmail = setting?.value || "info@monti.pro";
    console.log("Using office email:", officeEmail);

    // Prepare recipients - office email for all reports
    const recipients = [officeEmail];
    if (disturbance.kunde_email) {
      recipients.push(disturbance.kunde_email);
    }

    // Create filename
    const dateForFilename = formatDateShort(disturbance.datum).replace(/\./g, "-");
    const kundeForFilename = disturbance.kunde_name.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, "_");
    const pdfFilename = `Regiebericht_${kundeForFilename}_${dateForFilename}.pdf`;

    const subject = `Regiebericht - ${disturbance.kunde_name} - ${formatDateShort(disturbance.datum)}`;

    console.log("Sending email with PDF attachment to:", recipients);

    // Use Resend test domain if monti.pro is not verified yet
    // Once domain is verified in Resend dashboard, change back to noreply@monti.pro
    const fromAddress = Deno.env.get("RESEND_FROM_EMAIL") || "MONTI.PRO <onboarding@resend.dev>";

    console.log("Sending from:", fromAddress);

    const emailResponse = await resend.emails.send({
      from: fromAddress,
      reply_to: officeEmail,
      to: recipients,
      subject: subject,
      html: emailHtml,
      attachments: [
        {
          filename: pdfFilename,
          content: pdfBase64,
        },
      ],
    });

    console.log("Resend response:", JSON.stringify(emailResponse));

    // Check for Resend errors
    if (emailResponse?.error) {
      console.error("Resend error:", JSON.stringify(emailResponse.error));
      return new Response(
        JSON.stringify({ error: emailResponse.error.message || "E-Mail konnte nicht gesendet werden", details: emailResponse.error }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("Email sent successfully:", JSON.stringify(emailResponse));

    return new Response(
      JSON.stringify({ success: true, emailResponse }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    console.error("Error sending disturbance report:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});

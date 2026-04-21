/** Settings for customizable invoice/quote layout (Briefkopf, Footer, Texte) */

export interface InvoiceLayoutCompany {
  name: string;
  slogan: string;
  address_line1: string;
  address_line2: string;
  phone: string;
  email: string;
  website: string;
}

export interface InvoiceLayoutLogo {
  enabled: boolean;
  position: "left" | "right" | "center";
  width_mm: number;
  height_mm: number;
}

export interface InvoiceLayoutFooter {
  line1: string;
  line2: string;
  line3: string;
  show_bank_in_footer: boolean;
  show_page_numbers: boolean;
}

export interface InvoiceLayoutContact {
  /** Name des Ansprechpartners, der auf dem Dokument genannt wird. */
  name: string;
  phone: string;
  email: string;
}

export interface InvoiceLayoutSettings {
  company: InvoiceLayoutCompany;
  logo: InvoiceLayoutLogo;
  footer: InvoiceLayoutFooter;
  sender_line: string;
  closing_text_invoice: string;
  closing_text_angebot: string;
  danke_text: string;
  accent_color: string;
  contact: InvoiceLayoutContact;
}

export const DEFAULT_LAYOUT: InvoiceLayoutSettings = {
  company: {
    name: "BKS BauKomplettService",
    slogan: "Wir machen es komplett",
    address_line1: "",
    address_line2: "",
    phone: "",
    email: "",
    website: "",
  },
  logo: {
    enabled: true,
    position: "left",
    width_mm: 140,
    height_mm: 17.2,
  },
  footer: {
    line1: "",
    line2: "",
    line3: "",
    show_bank_in_footer: true,
    show_page_numbers: true,
  },
  sender_line: "",
  closing_text_invoice: "Wir bitten um Überweisung innerhalb von {{tage}} Tagen auf das unten angegebene Konto.",
  closing_text_angebot: "Dieses Angebot ist 30 Tage gültig. Wir freuen uns auf Ihren Auftrag!",
  danke_text: "Vielen Dank für Ihren Auftrag!",
  accent_color: "#0077CC", /* BKS Blau */
  contact: { name: "", phone: "", email: "" },
};

/** Known legacy accent colors that should auto-migrate to BKS Blau */
const LEGACY_ACCENT_COLORS = new Set([
  "#E08A20", "#e08a20", // MONTI.PRO Orange (original)
  "#1F3A5F", "#1f3a5f", // BKS Dunkelblau (interim)
]);

/** Safely parse layout settings JSON, merging with defaults for missing fields */
export function parseLayoutSettings(value: string | null | undefined): InvoiceLayoutSettings {
  if (!value) return { ...DEFAULT_LAYOUT };
  try {
    const parsed = JSON.parse(value);
    let accent = parsed.accent_color ?? DEFAULT_LAYOUT.accent_color;
    if (LEGACY_ACCENT_COLORS.has(accent)) accent = DEFAULT_LAYOUT.accent_color;

    // Legacy logo width migration: alte Werte waren zu klein für das
    // horizontale BKS-Logo (8:1 aspect) → auto-upgrade auf 140mm
    const parsedLogo = { ...(parsed.logo || {}) };
    const savedWidth = Number(parsedLogo.width_mm);
    if (!savedWidth || savedWidth < 130) {
      parsedLogo.width_mm = DEFAULT_LAYOUT.logo.width_mm;
      parsedLogo.height_mm = DEFAULT_LAYOUT.logo.height_mm;
    }

    return {
      company: { ...DEFAULT_LAYOUT.company, ...(parsed.company || {}) },
      logo: { ...DEFAULT_LAYOUT.logo, ...parsedLogo },
      footer: { ...DEFAULT_LAYOUT.footer, ...(parsed.footer || {}) },
      sender_line: parsed.sender_line ?? DEFAULT_LAYOUT.sender_line,
      closing_text_invoice: parsed.closing_text_invoice ?? DEFAULT_LAYOUT.closing_text_invoice,
      closing_text_angebot: parsed.closing_text_angebot ?? DEFAULT_LAYOUT.closing_text_angebot,
      danke_text: parsed.danke_text ?? DEFAULT_LAYOUT.danke_text,
      accent_color: accent,
      contact: { ...DEFAULT_LAYOUT.contact, ...(parsed.contact || {}) },
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

/** Build sender line from company data if not manually set */
export function buildSenderLine(c: InvoiceLayoutCompany): string {
  return [c.name, c.address_line1, c.address_line2].filter(Boolean).join(" · ");
}

/** Build footer lines from company data if not manually set */
export function buildFooterLines(c: InvoiceLayoutCompany): { line1: string; line2: string } {
  const line1 = [c.name, c.slogan, c.address_line1, c.address_line2].filter(Boolean).join(" · ");
  const parts2 = [];
  if (c.phone) parts2.push("Tel: " + c.phone);
  if (c.email) parts2.push(c.email);
  if (c.website) parts2.push(c.website);
  return { line1, line2: parts2.join(" · ") };
}

/** Convert hex color to RGB tuple (default fallback: BKS Blau #0077CC) */
export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16) || 0,     // 0x00
    parseInt(clean.slice(2, 4), 16) || 119,   // 0x77
    parseInt(clean.slice(4, 6), 16) || 204,   // 0xCC
  ];
}

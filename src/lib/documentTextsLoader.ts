// Lädt editierbare Textbausteine (document_texts) für einen Dokumenttyp
// und setzt sie — mit Platzhalter-Interpolation — auf ein Invoice-Objekt,
// sodass pdfGenerator / invoiceHtml sie rendern können.

import { supabase } from "@/integrations/supabase/client";
import { interpolateText } from "./documentTypes";

export interface DocumentTexts {
  intro?: string;
  closing?: string;
  zahlungsbedingungen?: string;
  anzahlung_hinweis?: string;
}

/** Lädt alle Textbausteine für (typ, sprache) aus der document_texts-Tabelle. */
export async function loadDocumentTexts(typ: string, sprache = "de"): Promise<DocumentTexts> {
  if (!typ) return {};
  const { data } = await supabase
    .from("document_texts")
    .select("feld, inhalt")
    .eq("typ", typ)
    .eq("sprache", sprache);
  const out: DocumentTexts = {};
  for (const row of ((data as any[]) || [])) {
    const inhalt = (row.inhalt || "").toString().trim();
    if (inhalt) (out as any)[row.feld] = inhalt;
  }
  return out;
}

/**
 * Hängt Textbausteine an ein Invoice-Objekt an. Nutzt interpolateText für
 * {{kunde_name}}, {{prozent}}, {{tage}} etc.
 * Gesetzt werden die "custom_*_text"-Felder, die pdfGenerator und invoiceHtml
 * bereits als Override unterstützen (bzw. jetzt unterstützen sollen).
 */
export function applyDocumentTextsToInvoice<T extends object>(
  invoice: T,
  texts: DocumentTexts,
  extraVars: Record<string, string | number | null | undefined> = {},
): T {
  const vars: Record<string, string | number | null | undefined> = {
    kunde_name: (invoice as any).kunde_name,
    rechnung_nr: (invoice as any).nummer,
    ab_nr: (invoice as any).nummer,
    angebot_nr: (invoice as any).nummer,
    datum: (invoice as any).datum,
    betrag: (invoice as any).brutto_summe,
    prozent: (invoice as any).anzahlung_prozent,
    ...extraVars,
  };
  const merged: any = { ...invoice };
  if (texts.intro) merged.custom_intro_text = interpolateText(texts.intro, vars);
  if (texts.closing) merged.custom_closing_text = interpolateText(texts.closing, vars);
  if (texts.anzahlung_hinweis) merged.custom_anzahlung_hinweis = interpolateText(texts.anzahlung_hinweis, vars);
  return merged as T;
}

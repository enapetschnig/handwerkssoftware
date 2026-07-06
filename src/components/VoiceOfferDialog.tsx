import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Mic, Square, Loader2, Plus, Trash2, Sparkles } from "lucide-react";
import { format } from "date-fns";

type Position = { description: string; quantity: number; unit: string; unitPrice: number };

const MWST_SATZ = 20;

export default function VoiceOfferDialog({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [phase, setPhase] = useState<"idle" | "recording" | "processing" | "review">("idle");
  const [transcript, setTranscript] = useState("");
  const [customer, setCustomer] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [positions, setPositions] = useState<Position[]>([]);
  const [creating, setCreating] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };
  useEffect(() => () => cleanupStream(), []);

  const reset = () => {
    setPhase("idle"); setTranscript(""); setCustomer(""); setTitle(""); setNotes(""); setPositions([]);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const rec = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => { cleanupStream(); void processAudio(); };
      mediaRecorderRef.current = rec;
      rec.start();
      setPhase("recording");
    } catch {
      toast({ title: "Mikrofon nicht verfügbar", description: "Bitte Mikrofonzugriff erlauben.", variant: "destructive" });
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setPhase("processing");
  };

  const processAudio = async () => {
    try {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      if (blob.size < 1000) { toast({ title: "Aufnahme zu kurz", variant: "destructive" }); setPhase("idle"); return; }
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
      }
      const audioBase64 = btoa(binary);

      // pass known customer names so the model can match a spoken name
      const { data: custRows } = await supabase.from("customers").select("name").limit(300);
      const knownCustomers = (custRows || []).map((c: { name: string }) => c.name).filter(Boolean);

      const { data, error } = await supabase.functions.invoke("hws-parse-voice-offer", {
        body: { audioBase64, knownCustomers },
      });
      if (error) throw error;
      if (data?.error && !data?.offer) { toast({ title: "Konnte nicht verarbeiten", description: data.error, variant: "destructive" }); setPhase("idle"); return; }

      setTranscript(data.transcript || "");
      const offer = data.offer || {};
      setCustomer(offer.customer || "");
      setTitle(offer.title || "");
      setNotes(offer.notes || "");
      setPositions(Array.isArray(offer.positions) && offer.positions.length
        ? offer.positions.map((p: Partial<Position>) => ({
            description: p.description || "",
            quantity: Number(p.quantity) || 1,
            unit: p.unit || "Stk.",
            unitPrice: Number(p.unitPrice) || 0,
          }))
        : [{ description: "", quantity: 1, unit: "Stk.", unitPrice: 0 }]);
      setPhase("review");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Fehler";
      toast({ title: "Verarbeitung fehlgeschlagen", description: msg, variant: "destructive" });
      setPhase("idle");
    }
  };

  const updatePos = (i: number, patch: Partial<Position>) =>
    setPositions((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const addPos = () => setPositions((ps) => [...ps, { description: "", quantity: 1, unit: "Stk.", unitPrice: 0 }]);
  const removePos = (i: number) => setPositions((ps) => ps.filter((_, idx) => idx !== i));

  const netto = positions.reduce((s, p) => s + p.quantity * p.unitPrice, 0);
  const mwst = netto * (MWST_SATZ / 100);
  const brutto = netto + mwst;

  const createOffer = async () => {
    const active = positions.filter((p) => p.description.trim() && p.quantity > 0);
    if (!active.length) { toast({ title: "Keine Positionen", description: "Bitte mindestens eine Position angeben.", variant: "destructive" }); return; }
    setCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Nicht angemeldet");

      // resolve customer by name (optional)
      let customerId: string | null = null;
      let kundeName = customer.trim();
      if (kundeName) {
        const { data: match } = await supabase.from("customers")
          .select("id, name").ilike("name", kundeName).limit(1).maybeSingle();
        if (match) { customerId = match.id; kundeName = match.name; }
      }

      const jahr = new Date().getFullYear();
      const { data: numData, error: numErr } = await supabase.rpc("next_document_number", { p_typ: "angebot", p_jahr: jahr });
      if (numErr) throw numErr;
      const nummer = numData as string;
      const laufnummer = parseInt((nummer.match(/(\d+)$/) || ["", "1"])[1]) || 1;

      const nettoSum = active.reduce((s, p) => s + p.quantity * p.unitPrice, 0);
      const mwstBetrag = nettoSum * (MWST_SATZ / 100);

      const { data: newInvoice, error: invErr } = await supabase.from("invoices").insert({
        user_id: user.id, typ: "angebot", nummer, laufnummer, jahr,
        status: "entwurf", kunde_name: kundeName || "Unbekannt", customer_id: customerId,
        betreff: title || null, notizen: notes || null,
        datum: format(new Date(), "yyyy-MM-dd"),
        netto_summe: nettoSum, mwst_satz: MWST_SATZ, mwst_betrag: mwstBetrag, brutto_summe: nettoSum + mwstBetrag,
        zahlungsbedingungen: "14 Tage netto",
      }).select("id").single();
      if (invErr) throw invErr;

      const items = active.map((p, idx) => ({
        invoice_id: newInvoice.id, position: idx + 1,
        beschreibung: p.description, kurztext: p.description, langtext: null,
        menge: p.quantity, einheit: p.unit,
        einzelpreis: p.unitPrice, gesamtpreis: p.quantity * p.unitPrice,
        produktnummer: null, rabatt_prozent: 0,
      }));
      const { error: itemsErr } = await supabase.from("invoice_items").insert(items);
      if (itemsErr) throw itemsErr;

      toast({ title: "Angebot erstellt", description: `${nummer} · ${kundeName || "ohne Kunde"}` });
      onOpenChange(false); reset();
      navigate(`/invoices/${newInvoice.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Fehler";
      toast({ title: "Konnte Angebot nicht erstellen", description: msg, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> Angebot per Sprachnachricht</DialogTitle>
          <DialogDescription>
            Sprich Kunde, Leistungen, Mengen und Preise ein — die KI erstellt daraus ein Angebot, das du vor dem Speichern prüfen kannst.
          </DialogDescription>
        </DialogHeader>

        {(phase === "idle" || phase === "recording" || phase === "processing") && (
          <div className="flex flex-col items-center justify-center gap-4 py-8">
            {phase === "processing" ? (
              <><Loader2 className="h-10 w-10 animate-spin text-primary" /><p className="text-sm text-muted-foreground">Wird transkribiert & ausgewertet…</p></>
            ) : (
              <>
                <button
                  onClick={phase === "recording" ? stopRecording : startRecording}
                  className={`h-24 w-24 rounded-full flex items-center justify-center transition-all ${phase === "recording" ? "bg-red-500 animate-pulse" : "bg-primary hover:bg-primary/90"}`}
                >
                  {phase === "recording" ? <Square className="h-10 w-10 text-white" /> : <Mic className="h-10 w-10 text-primary-foreground" />}
                </button>
                <p className="text-sm text-muted-foreground">
                  {phase === "recording" ? "Aufnahme läuft — zum Beenden tippen" : "Zum Aufnehmen tippen"}
                </p>
              </>
            )}
          </div>
        )}

        {phase === "review" && (
          <div className="space-y-4">
            {transcript && (
              <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground italic">„{transcript}"</div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Kunde</Label><Input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Kundenname" /></div>
              <div><Label>Betreff</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z.B. Elektroinstallation" /></div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Positionen</Label>
                <Button type="button" variant="outline" size="sm" onClick={addPos}><Plus className="h-4 w-4 mr-1" />Position</Button>
              </div>
              <div className="space-y-2">
                {positions.map((p, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <Input className="col-span-5" value={p.description} onChange={(e) => updatePos(i, { description: e.target.value })} placeholder="Beschreibung" />
                    <Input className="col-span-2" type="number" value={p.quantity} onChange={(e) => updatePos(i, { quantity: Number(e.target.value) })} placeholder="Menge" />
                    <Input className="col-span-2" value={p.unit} onChange={(e) => updatePos(i, { unit: e.target.value })} placeholder="Einheit" />
                    <Input className="col-span-2" type="number" value={p.unitPrice} onChange={(e) => updatePos(i, { unitPrice: Number(e.target.value) })} placeholder="€ / Einh." />
                    <Button type="button" variant="ghost" size="icon" className="col-span-1" onClick={() => removePos(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                ))}
              </div>
            </div>
            <div><Label>Notizen</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
            <div className="flex justify-end gap-6 text-sm border-t pt-3">
              <span className="text-muted-foreground">Netto: <strong className="text-foreground">{netto.toFixed(2)} €</strong></span>
              <span className="text-muted-foreground">+{MWST_SATZ}% MwSt: <strong className="text-foreground">{mwst.toFixed(2)} €</strong></span>
              <span className="text-muted-foreground">Brutto: <strong className="text-foreground">{brutto.toFixed(2)} €</strong></span>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {phase === "review" && (
            <>
              <Button variant="outline" onClick={reset}>Neu aufnehmen</Button>
              <Button onClick={createOffer} disabled={creating}>
                {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Angebot erstellen
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { UserPlus, Eye, EyeOff, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreateUserDialog({ open, onOpenChange, onCreated }: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [sendSms, setSendSms] = useState(true);

  const [form, setForm] = useState({
    username: "",
    password: "",
    rolle: "mitarbeiter",
    vorname: "",
    nachname: "",
    telefon: "",
    email: "",
    adresse: "",
    plz: "",
    ort: "",
    geburtsdatum: "",
    sv_nummer: "",
    eintrittsdatum: "",
    stundenlohn: "",
  });

  const update = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let pw = "";
    for (let i = 0; i < 8; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    update("password", pw);
  };

  const handleCreate = async () => {
    if (!form.username.trim() || !form.password || !form.vorname.trim() || !form.nachname.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Benutzername, Passwort, Vor- und Nachname sind Pflicht" });
      return;
    }
    if (form.password.length < 6) {
      toast({ variant: "destructive", title: "Fehler", description: "Passwort muss mindestens 6 Zeichen haben" });
      return;
    }

    setSaving(true);
    try {
      // 1. Create user via Edge Function
      const { data, error } = await supabase.functions.invoke("create-user", {
        body: form,
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      // 2. Send SMS if enabled and phone number provided
      if (sendSms && form.telefon.trim()) {
        try {
          const { data: smsData, error: smsError } = await supabase.functions.invoke("send-sms-invite", {
            body: {
              phone: form.telefon.trim(),
              username: form.username.trim().toLowerCase(),
              password: form.password,
              vorname: form.vorname.trim(),
            },
          });
          if (smsError || smsData?.error) {
            toast({ variant: "destructive", title: "SMS fehlgeschlagen", description: smsData?.error || smsError?.message || "SMS konnte nicht gesendet werden" });
          } else {
            toast({ title: "SMS gesendet", description: `Einladung an ${form.telefon} gesendet` });
          }
        } catch (smsErr: any) {
          toast({ variant: "destructive", title: "SMS fehlgeschlagen", description: smsErr.message });
        }
      }

      toast({ title: "Benutzer erstellt", description: `${form.vorname} ${form.nachname} (${form.username})` });
      onCreated();
      onOpenChange(false);
      // Reset form
      setForm({
        username: "", password: "", rolle: "mitarbeiter",
        vorname: "", nachname: "", telefon: "", email: "",
        adresse: "", plz: "", ort: "",
        geburtsdatum: "", sv_nummer: "", eintrittsdatum: "", stundenlohn: "",
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Fehler", description: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Neuen Benutzer anlegen
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Zugangsdaten */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Zugangsdaten</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Benutzername *</Label>
                <Input
                  value={form.username}
                  onChange={e => update("username", e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""))}
                  placeholder="z.B. max.m"
                />
                <p className="text-xs text-muted-foreground mt-0.5">Kleinbuchstaben, Zahlen, Punkt, Bindestrich</p>
              </div>
              <div>
                <Label>Passwort *</Label>
                <div className="flex gap-1">
                  <div className="relative flex-1">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={form.password}
                      onChange={e => update("password", e.target.value)}
                      placeholder="Min. 6 Zeichen"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={generatePassword} className="shrink-0">
                    Generieren
                  </Button>
                </div>
              </div>
            </div>
            <div>
              <Label>Rolle</Label>
              <Select value={form.rolle} onValueChange={v => update("rolle", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mitarbeiter">Mitarbeiter</SelectItem>
                  <SelectItem value="vorarbeiter">Vorarbeiter</SelectItem>
                  <SelectItem value="administrator">Administrator</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Persönliche Daten */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Persönliche Daten</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Vorname *</Label>
                <Input value={form.vorname} onChange={e => update("vorname", e.target.value)} />
              </div>
              <div>
                <Label>Nachname *</Label>
                <Input value={form.nachname} onChange={e => update("nachname", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Telefon</Label>
                <Input value={form.telefon} onChange={e => update("telefon", e.target.value)} placeholder="+43..." />
              </div>
              <div>
                <Label>E-Mail</Label>
                <Input type="email" value={form.email} onChange={e => update("email", e.target.value)} placeholder="optional" />
              </div>
            </div>
          </div>

          {/* Adresse */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Adresse</h3>
            <AddressAutocomplete
              label="Straße & Nr."
              value={form.adresse}
              onChange={(v) => update("adresse", v)}
              onSelect={(addr) => {
                setForm((prev) => ({
                  ...prev,
                  adresse: addr.street,
                  plz: addr.plz,
                  ort: addr.ort,
                }));
              }}
            />
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>PLZ</Label>
                <Input value={form.plz} onChange={e => update("plz", e.target.value)} />
              </div>
              <div className="col-span-2">
                <Label>Ort</Label>
                <Input value={form.ort} onChange={e => update("ort", e.target.value)} />
              </div>
            </div>
          </div>

          {/* Beschäftigung */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Beschäftigung</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Geburtsdatum</Label>
                <Input type="date" value={form.geburtsdatum} onChange={e => update("geburtsdatum", e.target.value)} />
              </div>
              <div>
                <Label>SV-Nummer</Label>
                <Input value={form.sv_nummer} onChange={e => update("sv_nummer", e.target.value)} placeholder="1234 010190" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Eintrittsdatum</Label>
                <Input type="date" value={form.eintrittsdatum} onChange={e => update("eintrittsdatum", e.target.value)} />
              </div>
              <div>
                <Label>Stundenlohn (€)</Label>
                <Input type="number" step="0.01" min="0" value={form.stundenlohn} onChange={e => update("stundenlohn", e.target.value)} />
              </div>
            </div>
          </div>

          {/* SMS Einladung */}
          <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/30">
            <div>
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Send className="h-4 w-4" />
                SMS-Einladung senden
              </p>
              <p className="text-xs text-muted-foreground">Benutzername und Passwort per SMS an die Telefonnummer senden</p>
            </div>
            <Switch checked={sendSms} onCheckedChange={setSendSms} disabled={!form.telefon.trim()} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? "Erstellt..." : "Benutzer erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

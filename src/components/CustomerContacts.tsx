import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Plus, Pencil, Trash2, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Props {
  customerId: string;
}

interface Contact {
  id?: string;
  customer_id: string;
  anrede: string;
  titel: string;
  vorname: string;
  nachname: string;
  position: string;
  email: string;
  telefon: string;
  telefon2: string;
  ist_hauptkontakt: boolean;
  notizen: string;
}

const emptyContact = (customerId: string): Contact => ({
  customer_id: customerId,
  anrede: "",
  titel: "",
  vorname: "",
  nachname: "",
  position: "",
  email: "",
  telefon: "",
  telefon2: "",
  ist_hauptkontakt: false,
  notizen: "",
});

export function CustomerContacts({ customerId }: Props) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (customerId) {
      loadContacts();
    }
  }, [customerId]);

  async function loadContacts() {
    const { data, error } = await supabase
      .from("customer_contacts" as never)
      .select("*")
      .eq("customer_id", customerId)
      .order("ist_hauptkontakt", { ascending: false })
      .order("nachname");

    if (error) {
      toast({ title: "Fehler beim Laden der Kontakte", variant: "destructive" });
      return;
    }

    if (data) {
      setContacts(data as unknown as Contact[]);
    }
  }

  function openNewDialog() {
    setEditContact(emptyContact(customerId));
    setDialogOpen(true);
  }

  function openEditDialog(contact: Contact) {
    setEditContact({ ...contact });
    setDialogOpen(true);
  }

  function updateField(field: keyof Contact, value: unknown) {
    if (!editContact) return;
    setEditContact({ ...editContact, [field]: value });
  }

  async function handleSave() {
    if (!editContact) return;
    if (!editContact.nachname.trim()) {
      toast({ title: "Nachname ist erforderlich", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      // If setting as primary, unset others first
      if (editContact.ist_hauptkontakt) {
        await supabase
          .from("customer_contacts" as never)
          .update({ ist_hauptkontakt: false } as never)
          .eq("customer_id", customerId);
      }

      const row = {
        customer_id: editContact.customer_id,
        anrede: editContact.anrede,
        titel: editContact.titel,
        vorname: editContact.vorname,
        nachname: editContact.nachname,
        position: editContact.position,
        email: editContact.email,
        telefon: editContact.telefon,
        telefon2: editContact.telefon2,
        ist_hauptkontakt: editContact.ist_hauptkontakt,
        notizen: editContact.notizen,
      };

      if (editContact.id) {
        const { error } = await supabase
          .from("customer_contacts" as never)
          .update(row as never)
          .eq("id", editContact.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("customer_contacts" as never)
          .insert(row as never);
        if (error) throw error;
      }

      toast({ title: editContact.id ? "Kontakt aktualisiert" : "Kontakt erstellt" });
      setDialogOpen(false);
      setEditContact(null);
      await loadContacts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unbekannter Fehler";
      toast({
        title: "Fehler beim Speichern",
        description: message,
        variant: "destructive",
      });
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (deleteConfirmId !== id) {
      setDeleteConfirmId(id);
      return;
    }

    try {
      const { error } = await supabase
        .from("customer_contacts" as never)
        .delete()
        .eq("id", id);
      if (error) throw error;

      toast({ title: "Kontakt geloescht" });
      setDeleteConfirmId(null);
      await loadContacts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unbekannter Fehler";
      toast({
        title: "Fehler beim Loeschen",
        description: message,
        variant: "destructive",
      });
    }
  }

  async function toggleHauptkontakt(contact: Contact) {
    const newValue = !contact.ist_hauptkontakt;

    try {
      // Unset all first if setting a new primary
      if (newValue) {
        await supabase
          .from("customer_contacts" as never)
          .update({ ist_hauptkontakt: false } as never)
          .eq("customer_id", customerId);
      }

      const { error } = await supabase
        .from("customer_contacts" as never)
        .update({ ist_hauptkontakt: newValue } as never)
        .eq("id", contact.id);
      if (error) throw error;

      await loadContacts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unbekannter Fehler";
      toast({
        title: "Fehler beim Aktualisieren",
        description: message,
        variant: "destructive",
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Ansprechpartner
          </div>
          <Button size="sm" onClick={openNewDialog}>
            <Plus className="h-4 w-4 mr-1" />
            Neuer Kontakt
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {contacts.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-4">
            Keine Ansprechpartner vorhanden.
          </p>
        ) : (
          <div className="space-y-3">
            {contacts.map((contact) => (
              <div
                key={contact.id}
                className="flex items-center gap-3 p-3 border rounded-lg"
              >
                {/* Primary indicator */}
                <button
                  onClick={() => toggleHauptkontakt(contact)}
                  className="shrink-0"
                  title={contact.ist_hauptkontakt ? "Hauptkontakt" : "Als Hauptkontakt setzen"}
                >
                  <Star
                    className={`h-5 w-5 ${
                      contact.ist_hauptkontakt
                        ? "fill-yellow-400 text-yellow-400"
                        : "text-muted-foreground hover:text-yellow-400"
                    }`}
                  />
                </button>

                {/* Contact info */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium">
                    {contact.anrede ? `${contact.anrede} ` : ""}
                    {contact.titel ? `${contact.titel} ` : ""}
                    {contact.vorname} {contact.nachname}
                  </div>
                  <div className="text-sm text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                    {contact.position && <span>{contact.position}</span>}
                    {contact.telefon && <span>{contact.telefon}</span>}
                    {contact.email && <span>{contact.email}</span>}
                  </div>
                </div>

                {/* Actions */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openEditDialog(contact)}
                  title="Bearbeiten"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant={deleteConfirmId === contact.id ? "destructive" : "ghost"}
                  size="icon"
                  onClick={() => handleDelete(contact.id!)}
                  title={deleteConfirmId === contact.id ? "Nochmal klicken zum Loeschen" : "Loeschen"}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Edit / New Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editContact?.id ? "Kontakt bearbeiten" : "Neuer Kontakt"}
              </DialogTitle>
            </DialogHeader>

            {editContact && (
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="anrede">Anrede</Label>
                    <Select
                      value={editContact.anrede}
                      onValueChange={(v) => updateField("anrede", v)}
                    >
                      <SelectTrigger id="anrede">
                        <SelectValue placeholder="Anrede" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Herr">Herr</SelectItem>
                        <SelectItem value="Frau">Frau</SelectItem>
                        <SelectItem value="Divers">Divers</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="titel">Titel</Label>
                    <Input
                      id="titel"
                      value={editContact.titel}
                      onChange={(e) => updateField("titel", e.target.value)}
                      placeholder="z.B. Dr., Ing."
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="vorname">Vorname</Label>
                    <Input
                      id="vorname"
                      value={editContact.vorname}
                      onChange={(e) => updateField("vorname", e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="nachname">Nachname *</Label>
                    <Input
                      id="nachname"
                      value={editContact.nachname}
                      onChange={(e) => updateField("nachname", e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="position">Position</Label>
                  <Input
                    id="position"
                    value={editContact.position}
                    onChange={(e) => updateField("position", e.target.value)}
                    placeholder="z.B. Geschaeftsfuehrer, Bauleiter"
                  />
                </div>

                <div>
                  <Label htmlFor="email">E-Mail</Label>
                  <Input
                    id="email"
                    type="email"
                    value={editContact.email}
                    onChange={(e) => updateField("email", e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="telefon">Telefon</Label>
                    <Input
                      id="telefon"
                      type="tel"
                      value={editContact.telefon}
                      onChange={(e) => updateField("telefon", e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="telefon2">Telefon 2</Label>
                    <Input
                      id="telefon2"
                      type="tel"
                      value={editContact.telefon2}
                      onChange={(e) => updateField("telefon2", e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Switch
                    id="hauptkontakt"
                    checked={editContact.ist_hauptkontakt}
                    onCheckedChange={(checked) => updateField("ist_hauptkontakt", checked)}
                  />
                  <Label htmlFor="hauptkontakt">Hauptkontakt</Label>
                </div>

                <div>
                  <Label htmlFor="notizen">Notizen</Label>
                  <Input
                    id="notizen"
                    value={editContact.notizen}
                    onChange={(e) => updateField("notizen", e.target.value)}
                    placeholder="Interne Notizen"
                  />
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Abbrechen
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Speichern..." : "Speichern"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Plus, X, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export interface CustomerData {
  id: string;
  name: string;
  anrede?: string;
  titel?: string;
  adresse?: string;
  plz?: string;
  ort?: string;
  land?: string;
  email?: string;
  telefon?: string;
  uid_nummer?: string;
  kundennummer?: string;
}

interface CustomerSelectProps {
  value: string | null;
  onChange: (customerId: string | null, customer: CustomerData | null) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
}

const emptyNewCustomer = {
  name: "",
  anrede: "",
  titel: "",
  adresse: "",
  plz: "",
  ort: "",
  land: "Österreich",
  email: "",
  telefon: "",
  uid_nummer: "",
};

export function CustomerSelect({
  value,
  onChange,
  placeholder = "Kunde auswählen...",
  required = false,
  className,
}: CustomerSelectProps) {
  const [customers, setCustomers] = useState<CustomerData[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState(emptyNewCustomer);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const selectedCustomer = customers.find((c) => c.id === value) ?? null;

  const loadCustomers = useCallback(async () => {
    const { data } = await supabase
      .from("customers")
      .select(
        "id, name, anrede, titel, adresse, plz, ort, land, email, telefon, uid_nummer, kundennummer"
      )
      .order("name");
    if (data) {
      setCustomers(data as CustomerData[]);
    }
  }, []);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const handleSelect = (customer: CustomerData) => {
    onChange(customer.id, customer);
    setPopoverOpen(false);
  };

  const handleClear = () => {
    onChange(null, null);
  };

  const handleCreateCustomer = async () => {
    if (!newCustomer.name.trim()) {
      toast({
        title: "Name erforderlich",
        description: "Bitte geben Sie einen Kundennamen ein.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const insertData: Record<string, string> = {
        name: newCustomer.name.trim(),
        land: newCustomer.land || "Österreich",
      };
      if (newCustomer.anrede) insertData.anrede = newCustomer.anrede;
      if (newCustomer.titel) insertData.titel = newCustomer.titel;
      if (newCustomer.adresse) insertData.adresse = newCustomer.adresse;
      if (newCustomer.plz) insertData.plz = newCustomer.plz;
      if (newCustomer.ort) insertData.ort = newCustomer.ort;
      if (newCustomer.email) insertData.email = newCustomer.email;
      if (newCustomer.telefon) insertData.telefon = newCustomer.telefon;
      if (newCustomer.uid_nummer) insertData.uid_nummer = newCustomer.uid_nummer;

      const { data, error } = await supabase
        .from("customers")
        .insert(insertData)
        .select(
          "id, name, anrede, titel, adresse, plz, ort, land, email, telefon, uid_nummer, kundennummer"
        )
        .single();

      if (error) throw error;

      const created = data as CustomerData;
      setCustomers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      onChange(created.id, created);
      setDialogOpen(false);
      setNewCustomer(emptyNewCustomer);
      toast({ title: "Kunde erstellt", description: created.name });
    } catch (err: any) {
      toast({
        title: "Fehler",
        description: err.message || "Kunde konnte nicht erstellt werden.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const updateNew = (field: string, val: string) => {
    setNewCustomer((prev) => ({ ...prev, [field]: val }));
  };

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={popoverOpen}
            className={cn(
              "w-full justify-between font-normal",
              !selectedCustomer && "text-muted-foreground",
              className
            )}
          >
            <span className="flex items-center gap-1.5 truncate">
              <Search className="w-4 h-4 shrink-0" />
              {selectedCustomer ? selectedCustomer.name : placeholder}
            </span>
            {selectedCustomer && (
              <span
                role="button"
                className="ml-1 shrink-0 rounded-full p-0.5 hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation();
                  handleClear();
                }}
              >
                <X className="w-3.5 h-3.5" />
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Kunde suchen..." />
            <CommandList>
              <CommandEmpty>Kein Kunde gefunden</CommandEmpty>
              <CommandGroup>
                {!required && (
                  <CommandItem
                    value="__clear__"
                    onSelect={() => {
                      handleClear();
                      setPopoverOpen(false);
                    }}
                  >
                    <span className="text-muted-foreground">Kein Kunde</span>
                  </CommandItem>
                )}
                {customers.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.name}
                    onSelect={() => handleSelect(c)}
                  >
                    <div className="flex items-center gap-2 w-full">
                      {value === c.id && (
                        <Check className="w-4 h-4 shrink-0 text-primary" />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium truncate">{c.name}</p>
                        {(c.plz || c.ort) && (
                          <p className="text-xs text-muted-foreground">
                            {[c.plz, c.ort].filter(Boolean).join(" ")}
                          </p>
                        )}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup>
                <CommandItem
                  value="__neuer_kunde__"
                  onSelect={() => {
                    setPopoverOpen(false);
                    setDialogOpen(true);
                  }}
                  className="text-primary"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Neuer Kunde
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Neuen Kunden erstellen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={newCustomer.name}
                  onChange={(e) => updateNew("name", e.target.value)}
                  placeholder="Firmenname oder Nachname"
                  autoFocus
                />
              </div>
              <div>
                <Label>Anrede</Label>
                <Select
                  value={newCustomer.anrede}
                  onValueChange={(v) => updateNew("anrede", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Anrede wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Herr">Herr</SelectItem>
                    <SelectItem value="Frau">Frau</SelectItem>
                    <SelectItem value="Firma">Firma</SelectItem>
                    <SelectItem value="Divers">Divers</SelectItem>
                    <SelectItem value="Familie">Familie</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Titel</Label>
                <Input
                  value={newCustomer.titel}
                  onChange={(e) => updateNew("titel", e.target.value)}
                  placeholder="z.B. Ing., DI"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <Label>Adresse</Label>
                <Input
                  value={newCustomer.adresse}
                  onChange={(e) => updateNew("adresse", e.target.value)}
                  placeholder="Straße und Hausnummer"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>PLZ</Label>
                  <Input
                    value={newCustomer.plz}
                    onChange={(e) => updateNew("plz", e.target.value)}
                    placeholder="PLZ"
                  />
                </div>
                <div className="col-span-2">
                  <Label>Ort</Label>
                  <Input
                    value={newCustomer.ort}
                    onChange={(e) => updateNew("ort", e.target.value)}
                    placeholder="Ort"
                  />
                </div>
              </div>
              <div>
                <Label>Land</Label>
                <Input
                  value={newCustomer.land}
                  onChange={(e) => updateNew("land", e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>E-Mail</Label>
                <Input
                  type="email"
                  value={newCustomer.email}
                  onChange={(e) => updateNew("email", e.target.value)}
                  placeholder="email@beispiel.at"
                />
              </div>
              <div>
                <Label>Telefon</Label>
                <Input
                  value={newCustomer.telefon}
                  onChange={(e) => updateNew("telefon", e.target.value)}
                  placeholder="+43..."
                />
              </div>
            </div>

            <div>
              <Label>UID-Nummer</Label>
              <Input
                value={newCustomer.uid_nummer}
                onChange={(e) => updateNew("uid_nummer", e.target.value)}
                placeholder="ATU..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
                setNewCustomer(emptyNewCustomer);
              }}
            >
              Abbrechen
            </Button>
            <Button onClick={handleCreateCustomer} disabled={saving}>
              {saving ? "Speichern..." : "Erstellen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

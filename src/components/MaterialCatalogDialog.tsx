import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { Search, Package, ArrowUp } from "lucide-react";

interface CatalogItem {
  id: string;
  name: string;
  kurzbezeichnung: string | null;
  einheit: string;
  netto_preis: number;
  produktgruppe: string | null;
}

interface MaterialCatalogDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (item: { material: string; menge: number; einheit: string; einzelpreis: number }) => void;
}

export function MaterialCatalogDialog({ open, onClose, onSelect }: MaterialCatalogDialogProps) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<CatalogItem | null>(null);
  const [menge, setMenge] = useState("");

  useEffect(() => {
    if (open) {
      fetchItems();
      setSearch("");
      setSelectedItem(null);
      setMenge("");
    }
  }, [open]);

  const fetchItems = async () => {
    setLoading(true);
    const { data } = await supabase.from("invoice_templates")
      .select("id, name, einheit, einzelpreis, kategorie")
      .order("kategorie, name");
    if (data) {
      setItems(data.map(d => ({
        id: d.id,
        name: d.name,
        kurzbezeichnung: (d as any).kurzbezeichnung || null,
        einheit: d.einheit || "Stk.",
        netto_preis: Number(d.einzelpreis) || 0,
        produktgruppe: d.kategorie || "Allgemein",
      })));
    }
    setLoading(false);
  };

  const s = search.toLowerCase();
  const filtered = items.filter(i => {
    if (!s) return true;
    return (i.kurzbezeichnung || "").toLowerCase().includes(s) || i.name.toLowerCase().includes(s);
  }).slice(0, 50);

  // Group by produktgruppe
  const grouped = new Map<string, CatalogItem[]>();
  filtered.forEach(i => {
    const g = i.produktgruppe || "Allgemein";
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g)!.push(i);
  });

  const handleSelect = () => {
    if (!selectedItem || !menge.trim()) return;
    onSelect({
      material: selectedItem.kurzbezeichnung || selectedItem.name,
      menge: Number(menge) || 1,
      einheit: selectedItem.einheit,
      einzelpreis: selectedItem.netto_preis,
    });
    setSelectedItem(null);
    setMenge("");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Materialkatalog
          </DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Material suchen..."
            className="pl-9"
            autoFocus
          />
        </div>

        {/* Selected item — quick menge input */}
        {selectedItem && (
          <div className="border rounded-lg p-3 bg-orange-50 border-orange-200 space-y-2">
            <p className="text-sm font-medium">{selectedItem.kurzbezeichnung || selectedItem.name}</p>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                step="0.1"
                min="0"
                placeholder="Menge"
                value={menge}
                onChange={(e) => setMenge(e.target.value)}
                className="flex-1 h-9"
                autoFocus
              />
              <span className="text-sm text-muted-foreground shrink-0 w-12">{selectedItem.einheit}</span>
              <Button
                size="sm"
                className="gap-1 h-9 bg-orange-600 hover:bg-orange-700 shrink-0"
                disabled={!menge.trim()}
                onClick={handleSelect}
              >
                <ArrowUp className="h-3.5 w-3.5" />
                Entnehmen
              </Button>
            </div>
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSelectedItem(null)}>
              Anderes Material wählen
            </Button>
          </div>
        )}

        {/* Results */}
        {!selectedItem && (
          <div className="overflow-y-auto flex-1 space-y-3">
            {loading ? (
              <p className="text-center text-muted-foreground py-8">Lädt...</p>
            ) : filtered.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">Nichts gefunden</p>
            ) : (
              Array.from(grouped.entries()).map(([gruppe, gruppeItems]) => (
                <div key={gruppe}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 py-1">{gruppe}</p>
                  <div className="space-y-0.5">
                    {gruppeItems.map(item => (
                      <button
                        key={item.id}
                        className="w-full text-left px-3 py-2 rounded-md hover:bg-accent text-sm flex items-center justify-between gap-2"
                        onClick={() => { setSelectedItem(item); setMenge(""); }}
                      >
                        <span className="truncate">{item.kurzbezeichnung || item.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{item.einheit}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

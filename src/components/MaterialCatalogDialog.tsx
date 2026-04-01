import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Search, Package, ShoppingCart, X, Plus, Minus, Check } from "lucide-react";

interface CatalogItem {
  id: string;
  name: string;
  kurzbezeichnung: string | null;
  einheit: string;
  netto_preis: number;
  produktgruppe: string | null;
}

interface SelectedEntry {
  item: CatalogItem;
  menge: number;
}

interface MaterialCatalogDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (item: { material: string; menge: number; einheit: string; einzelpreis: number }) => void | Promise<void>;
}

export function MaterialCatalogDialog({ open, onClose, onSelect }: MaterialCatalogDialogProps) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeKategorie, setActiveKategorie] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, SelectedEntry>>(new Map());
  const [showCart, setShowCart] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      fetchItems();
      setSearch("");
      setActiveKategorie(null);
      setSelected(new Map());
      setShowCart(false);
    }
  }, [open]);

  const fetchItems = async () => {
    setLoading(true);
    const { data } = await supabase.from("invoice_templates")
      .select("id, name, kurzbezeichnung, einheit, einzelpreis, kategorie")
      .order("kategorie")
      .order("name");
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
    if (activeKategorie && (i.produktgruppe || "Allgemein") !== activeKategorie) return false;
    if (!s) return true;
    return (i.kurzbezeichnung || "").toLowerCase().includes(s) || i.name.toLowerCase().includes(s) || (i.produktgruppe || "").toLowerCase().includes(s);
  });

  // All categories for filter
  const kategorien = Array.from(new Set(items.map(i => i.produktgruppe || "Allgemein"))).sort();

  // Group filtered items
  const grouped = new Map<string, CatalogItem[]>();
  filtered.forEach(i => {
    const g = i.produktgruppe || "Allgemein";
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g)!.push(i);
  });

  const toggleItem = (item: CatalogItem) => {
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.set(item.id, { item, menge: 1 });
      }
      return next;
    });
  };

  const updateMenge = (id: string, menge: number) => {
    if (menge <= 0) {
      setSelected(prev => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      return;
    }
    setSelected(prev => {
      const next = new Map(prev);
      const entry = next.get(id);
      if (entry) next.set(id, { ...entry, menge });
      return next;
    });
  };

  const handleSubmitAll = async () => {
    for (const entry of selected.values()) {
      await onSelect({
        material: entry.item.kurzbezeichnung || entry.item.name,
        menge: entry.menge,
        einheit: entry.item.einheit,
        einzelpreis: entry.item.netto_preis,
      });
    }
    setSelected(new Map());
    onClose();
  };

  const selectedCount = selected.size;
  const displayName = (item: CatalogItem) => item.kurzbezeichnung || item.name;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-5 pt-5 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Materialkatalog
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col flex-1 overflow-hidden px-5 pb-5 gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Material suchen..."
              className="pl-9"
              autoFocus
            />
          </div>

          {/* Category filter */}
          {kategorien.length > 1 && (
            <div className="flex gap-1.5 flex-wrap">
              <Badge
                variant={activeKategorie === null ? "default" : "outline"}
                className="cursor-pointer text-xs"
                onClick={() => setActiveKategorie(null)}
              >
                Alle ({items.length})
              </Badge>
              {kategorien.map(k => {
                const count = items.filter(i => (i.produktgruppe || "Allgemein") === k).length;
                return (
                  <Badge
                    key={k}
                    variant={activeKategorie === k ? "default" : "outline"}
                    className="cursor-pointer text-xs"
                    onClick={() => setActiveKategorie(activeKategorie === k ? null : k)}
                  >
                    {k} ({count})
                  </Badge>
                );
              })}
            </div>
          )}

          {/* Cart toggle when items selected */}
          {selectedCount > 0 && (
            <button
              className="flex items-center justify-between w-full px-3 py-2 rounded-lg bg-orange-50 border border-orange-200 text-sm hover:bg-orange-100 transition-colors"
              onClick={() => setShowCart(!showCart)}
            >
              <span className="flex items-center gap-2 font-medium text-orange-800">
                <ShoppingCart className="h-4 w-4" />
                {selectedCount} Material{selectedCount !== 1 ? "ien" : ""} ausgewählt
              </span>
              <span className="text-orange-600 text-xs">{showCart ? "Liste anzeigen" : "Auswahl bearbeiten"}</span>
            </button>
          )}

          {/* Cart view */}
          {showCart && selectedCount > 0 && (
            <div className="border rounded-lg divide-y overflow-y-auto max-h-[40vh]">
              {Array.from(selected.values()).map(entry => (
                <div key={entry.item.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="flex-1 text-sm truncate">{displayName(entry.item)}</span>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateMenge(entry.item.id, entry.menge - 1)}>
                      <Minus className="h-3 w-3" />
                    </Button>
                    <Input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={entry.menge}
                      onChange={(e) => updateMenge(entry.item.id, Number(e.target.value) || 0)}
                      className="w-16 h-7 text-center text-sm"
                    />
                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateMenge(entry.item.id, entry.menge + 1)}>
                      <Plus className="h-3 w-3" />
                    </Button>
                    <span className="text-xs text-muted-foreground w-10">{entry.item.einheit}</span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => toggleItem(entry.item)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Material list */}
          {!showCart && (
            <div className="overflow-y-auto flex-1 space-y-3 min-h-0">
              {loading ? (
                <p className="text-center text-muted-foreground py-8">Lädt...</p>
              ) : filtered.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Nichts gefunden</p>
              ) : (
                Array.from(grouped.entries()).map(([gruppe, gruppeItems]) => (
                  <div key={gruppe}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 py-1">
                      {gruppe} <span className="font-normal">({gruppeItems.length})</span>
                    </p>
                    <div className="space-y-0.5">
                      {gruppeItems.map(item => {
                        const isSelected = selected.has(item.id);
                        return (
                          <button
                            key={item.id}
                            className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between gap-2 transition-colors ${
                              isSelected
                                ? "bg-orange-50 border border-orange-200"
                                : "hover:bg-accent"
                            }`}
                            onClick={() => toggleItem(item)}
                          >
                            <span className="flex items-center gap-2 truncate">
                              {isSelected && <Check className="h-3.5 w-3.5 text-orange-600 shrink-0" />}
                              <span className="truncate">{displayName(item)}</span>
                            </span>
                            <span className="text-xs text-muted-foreground shrink-0">{item.einheit}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Submit button */}
          {selectedCount > 0 && (
            <Button
              className="w-full gap-2 bg-orange-600 hover:bg-orange-700"
              onClick={handleSubmitAll}
            >
              <ShoppingCart className="h-4 w-4" />
              {selectedCount} Material{selectedCount !== 1 ? "ien" : ""} entnehmen
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect, useMemo } from "react";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: { id: string; vorname: string; nachname: string }[];
  existingTeamMemberIds: string[];
  onSave: (name: string, memberIds: string[]) => Promise<void>;
}

export function CreateTeamDialog({
  open,
  onOpenChange,
  profiles,
  existingTeamMemberIds,
  onSave,
}: Props) {
  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setSelectedIds(new Set());
      setSearch("");
    }
  }, [open]);

  const existingSet = useMemo(
    () => new Set(existingTeamMemberIds),
    [existingTeamMemberIds]
  );

  const filteredProfiles = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return profiles;
    return profiles.filter(
      (p) =>
        p.vorname.toLowerCase().includes(q) ||
        p.nachname.toLowerCase().includes(q)
    );
  }, [profiles, search]);

  function toggleMember(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave(name.trim(), Array.from(selectedIds));
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            Neues Team
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Team name */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Name <span className="text-red-500">*</span>
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Bautrupp 1"
              autoFocus
            />
          </div>

          {/* Members */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Mitarbeiter
            </Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Suchen..."
                className="pl-8 h-8 text-sm"
              />
            </div>
            <ScrollArea className="h-[220px] border rounded-md">
              <div className="p-1">
                {filteredProfiles.length === 0 && (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    Keine Mitarbeiter gefunden
                  </div>
                )}
                {filteredProfiles.map((p) => {
                  const alreadyInTeam = existingSet.has(p.id);
                  const checked = selectedIds.has(p.id);

                  return (
                    <label
                      key={p.id}
                      className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md cursor-pointer hover:bg-muted/40 transition-colors ${
                        alreadyInTeam ? "opacity-50" : ""
                      }`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleMember(p.id)}
                        disabled={alreadyInTeam}
                      />
                      <span className="text-sm truncate">
                        {p.vorname} {p.nachname}
                      </span>
                      {alreadyInTeam && (
                        <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
                          (bereits in Team)
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </ScrollArea>
            {selectedIds.size > 0 && (
              <p className="text-xs text-muted-foreground">
                {selectedIds.size} ausgewahlt
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Abbrechen
          </Button>
          <Button
            size="sm"
            disabled={!name.trim() || saving}
            onClick={handleSave}
          >
            {saving ? "Speichern..." : "Erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

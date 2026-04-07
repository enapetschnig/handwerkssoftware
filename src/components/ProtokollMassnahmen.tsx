import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface Massnahme {
  id?: string;
  aufgabe: string;
  verantwortlich: string;
  frist: string;
  erledigt: boolean;
}

interface Props {
  massnahmen: Massnahme[];
  onChange: (m: Massnahme[]) => void;
}

export const ProtokollMassnahmen = ({ massnahmen, onChange }: Props) => {
  const addMassnahme = () => {
    onChange([
      ...massnahmen,
      {
        id: crypto.randomUUID(),
        aufgabe: "",
        verantwortlich: "",
        frist: "",
        erledigt: false,
      },
    ]);
  };

  const removeMassnahme = (idx: number) => {
    onChange(massnahmen.filter((_, i) => i !== idx));
  };

  const updateMassnahme = (idx: number, field: keyof Massnahme, value: string | boolean) => {
    onChange(
      massnahmen.map((m, i) => (i === idx ? { ...m, [field]: value } : m))
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Maßnahmen</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={addMassnahme} className="gap-1">
            <Plus className="h-4 w-4" />
            Neue Maßnahme
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {massnahmen.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Keine Maßnahmen eingetragen
          </p>
        ) : (
          <div className="space-y-3">
            {massnahmen.map((m, idx) => (
              <div key={m.id || idx} className="flex flex-col sm:flex-row gap-2 items-start sm:items-end border rounded-lg p-3">
                <div className="flex-1 w-full">
                  <label className="text-xs text-muted-foreground">Aufgabe</label>
                  <Input
                    value={m.aufgabe}
                    onChange={(e) => updateMassnahme(idx, "aufgabe", e.target.value)}
                    placeholder="Beschreibung der Aufgabe"
                  />
                </div>
                <div className="w-full sm:w-44">
                  <label className="text-xs text-muted-foreground">Verantwortlich</label>
                  <Input
                    value={m.verantwortlich}
                    onChange={(e) => updateMassnahme(idx, "verantwortlich", e.target.value)}
                    placeholder="Name"
                  />
                </div>
                <div className="w-full sm:w-36">
                  <label className="text-xs text-muted-foreground">Frist</label>
                  <Input
                    type="date"
                    value={m.frist}
                    onChange={(e) => updateMassnahme(idx, "frist", e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2 pt-4 sm:pt-0 sm:pb-2">
                  <Checkbox
                    checked={m.erledigt}
                    onCheckedChange={(checked) => updateMassnahme(idx, "erledigt", !!checked)}
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Erledigt</span>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="shrink-0"
                  onClick={() => removeMassnahme(idx)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface Worker {
  id: string;
  employee_id: string;
  stunden: number;
  taetigkeit: string;
}

export interface Employee {
  id: string;
  vorname: string;
  nachname: string;
}

interface BautagesberichtWorkersProps {
  workers: Worker[];
  onChange: (workers: Worker[]) => void;
  employees: Employee[];
}

export const BautagesberichtWorkers = ({ workers, onChange, employees }: BautagesberichtWorkersProps) => {

  const addWorker = () => {
    onChange([
      ...workers,
      {
        id: crypto.randomUUID(),
        employee_id: "",
        stunden: 0,
        taetigkeit: "",
      },
    ]);
  };

  const removeWorker = (id: string) => {
    onChange(workers.filter((w) => w.id !== id));
  };

  const updateWorker = (id: string, field: keyof Worker, value: string | number) => {
    onChange(
      workers.map((w) => (w.id === id ? { ...w, [field]: value } : w))
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Arbeiter</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={addWorker} className="gap-1">
            <Plus className="h-4 w-4" />
            Hinzufugen
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {workers.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Keine Arbeiter eingetragen
          </p>
        ) : (
          <div className="space-y-3">
            {workers.map((worker) => (
              <div key={worker.id} className="flex flex-col sm:flex-row gap-2 items-start sm:items-end border rounded-lg p-3">
                <div className="flex-1 w-full">
                  <label className="text-xs text-muted-foreground">Mitarbeiter</label>
                  <Select
                    value={worker.employee_id}
                    onValueChange={(val) => updateWorker(worker.id, "employee_id", val)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Mitarbeiter wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map((emp) => (
                        <SelectItem key={emp.id} value={emp.id}>
                          {emp.vorname} {emp.nachname}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-full sm:w-24">
                  <label className="text-xs text-muted-foreground">Stunden</label>
                  <Input
                    type="number"
                    step="0.5"
                    min="0"
                    value={worker.stunden || ""}
                    onChange={(e) => updateWorker(worker.id, "stunden", parseFloat(e.target.value) || 0)}
                    placeholder="0"
                  />
                </div>
                <div className="flex-1 w-full">
                  <label className="text-xs text-muted-foreground">Tatigkeit</label>
                  <Input
                    value={worker.taetigkeit}
                    onChange={(e) => updateWorker(worker.id, "taetigkeit", e.target.value)}
                    placeholder="Ausgefuhrte Tatigkeit"
                  />
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="shrink-0"
                  onClick={() => removeWorker(worker.id)}
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

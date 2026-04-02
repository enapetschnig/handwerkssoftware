import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Palette, Save } from "lucide-react";

interface EmployeeColor {
  employee_id: string;
  bg_color: string;
  text_color: string;
}

interface Employee {
  id: string;
  vorname: string;
  nachname: string;
}

const DEFAULT_COLORS = [
  { bg: "#3b82f6", text: "#ffffff" }, // Blue
  { bg: "#E08A20", text: "#ffffff" }, // MONTI Orange
  { bg: "#10b981", text: "#ffffff" }, // Green
  { bg: "#8b5cf6", text: "#ffffff" }, // Purple
  { bg: "#ef4444", text: "#ffffff" }, // Red
  { bg: "#f59e0b", text: "#ffffff" }, // Amber
  { bg: "#06b6d4", text: "#ffffff" }, // Cyan
  { bg: "#ec4899", text: "#ffffff" }, // Pink
  { bg: "#14b8a6", text: "#ffffff" }, // Teal
  { bg: "#6366f1", text: "#ffffff" }, // Indigo
];

export function EmployeeColorSettings() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [colors, setColors] = useState<Record<string, EmployeeColor>>({});
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [empRes, colorRes] = await Promise.all([
      supabase.from("employees").select("id, vorname, nachname").eq("aktiv", true).order("nachname"),
      supabase.from("employee_schedule_colors").select("*"),
    ]);

    if (empRes.data) setEmployees(empRes.data);
    if (colorRes.data) {
      const map: Record<string, EmployeeColor> = {};
      colorRes.data.forEach((c: any) => {
        map[c.employee_id] = { employee_id: c.employee_id, bg_color: c.bg_color, text_color: c.text_color };
      });
      setColors(map);
    }
  }

  function getColor(empId: string, idx: number): EmployeeColor {
    if (colors[empId]) return colors[empId];
    const def = DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
    return { employee_id: empId, bg_color: def.bg, text_color: def.text };
  }

  function setColorFor(empId: string, field: "bg_color" | "text_color", value: string) {
    setColors(prev => ({
      ...prev,
      [empId]: {
        ...(prev[empId] || { employee_id: empId, bg_color: "#3b82f6", text_color: "#ffffff" }),
        [field]: value,
      },
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const rows = employees.map((emp, idx) => {
        const c = getColor(emp.id, idx);
        return { employee_id: emp.id, bg_color: c.bg_color, text_color: c.text_color };
      });

      for (const row of rows) {
        await supabase.from("employee_schedule_colors").upsert(row, { onConflict: "employee_id" });
      }

      toast({ title: "Farben gespeichert" });
    } catch (err) {
      toast({ title: "Fehler beim Speichern", variant: "destructive" });
    }
    setSaving(false);
  }

  function applyPreset(empId: string, preset: typeof DEFAULT_COLORS[0]) {
    setColors(prev => ({
      ...prev,
      [empId]: { employee_id: empId, bg_color: preset.bg, text_color: preset.text },
    }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-5 w-5" />
          Plantafel-Farben pro Mitarbeiter
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {employees.map((emp, idx) => {
          const c = getColor(emp.id, idx);
          return (
            <div key={emp.id} className="flex items-center gap-3 p-3 border rounded-lg">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                style={{ backgroundColor: c.bg_color, color: c.text_color }}
              >
                {emp.vorname?.[0]}{emp.nachname?.[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{emp.vorname} {emp.nachname}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Label className="text-xs whitespace-nowrap">Hintergrund:</Label>
                  <Input
                    type="color"
                    value={c.bg_color}
                    onChange={(e) => setColorFor(emp.id, "bg_color", e.target.value)}
                    className="w-10 h-8 p-0.5 cursor-pointer"
                  />
                  <Label className="text-xs whitespace-nowrap">Text:</Label>
                  <Input
                    type="color"
                    value={c.text_color}
                    onChange={(e) => setColorFor(emp.id, "text_color", e.target.value)}
                    className="w-10 h-8 p-0.5 cursor-pointer"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {DEFAULT_COLORS.slice(0, 5).map((preset, pi) => (
                  <button
                    key={pi}
                    className="w-5 h-5 rounded-full border border-gray-300 hover:scale-110 transition-transform"
                    style={{ backgroundColor: preset.bg }}
                    onClick={() => applyPreset(emp.id, preset)}
                    title={`Farbe ${pi + 1}`}
                  />
                ))}
              </div>
            </div>
          );
        })}

        <Button onClick={handleSave} disabled={saving} className="w-full">
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Speichern..." : "Farben speichern"}
        </Button>
      </CardContent>
    </Card>
  );
}

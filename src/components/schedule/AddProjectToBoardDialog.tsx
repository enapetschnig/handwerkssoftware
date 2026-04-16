import { useState, useEffect } from "react";
import { Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { BOARD_COLORS } from "./scheduleTypes";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableProjects: {
    id: string;
    name: string;
    status?: string;
    geplanter_start?: string | null;
    geplantes_ende?: string | null;
  }[];
  onSave: (
    projectId: string,
    color: string,
    colorMode: "status" | "custom"
  ) => Promise<void>;
}

export function AddProjectToBoardDialog({
  open,
  onOpenChange,
  availableProjects,
  onSave,
}: Props) {
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [beschreibung, setBeschreibung] = useState("");
  const [colorMode, setColorMode] = useState<"status" | "custom">("status");
  const [selectedColor, setSelectedColor] = useState(BOARD_COLORS[0]);
  const [saving, setSaving] = useState(false);

  const selectedProject = availableProjects.find(
    (p) => p.id === selectedProjectId
  );

  useEffect(() => {
    if (!open) {
      setSelectedProjectId("");
      setStartDate("");
      setEndDate("");
      setBeschreibung("");
      setColorMode("status");
      setSelectedColor(BOARD_COLORS[0]);
    }
  }, [open]);

  useEffect(() => {
    if (selectedProject) {
      setStartDate(selectedProject.geplanter_start ?? "");
      setEndDate(selectedProject.geplantes_ende ?? "");
    }
  }, [selectedProject]);

  async function handleSave() {
    if (!selectedProjectId) return;
    setSaving(true);
    try {
      await onSave(
        selectedProjectId,
        colorMode === "custom" ? selectedColor : "",
        colorMode
      );
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            Projekt hinzufugen
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="bestehendes">
          <TabsList className="w-full">
            <TabsTrigger value="bestehendes" className="flex-1">
              Bestehendes
            </TabsTrigger>
            <TabsTrigger value="neues" className="flex-1">
              Neues
            </TabsTrigger>
          </TabsList>

          <TabsContent value="bestehendes" className="space-y-4 mt-4">
            {/* Project select */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Projektname
              </Label>
              <Select
                value={selectedProjectId}
                onValueChange={setSelectedProjectId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Projekt auswahlen..." />
                </SelectTrigger>
                <SelectContent>
                  {availableProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Start / Ende */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Start
                </Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Ende
                </Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            {/* Beschreibung */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Beschreibung
              </Label>
              <Textarea
                value={beschreibung}
                onChange={(e) => setBeschreibung(e.target.value)}
                placeholder="Optional..."
                rows={2}
                className="resize-none"
              />
            </div>

            {/* Status */}
            {selectedProject?.status && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Status
                </Label>
                <div>
                  <Badge variant="secondary" className="text-xs">
                    {selectedProject.status}
                  </Badge>
                </div>
              </div>
            )}

            {/* Color */}
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Farbe
              </Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={colorMode === "status" ? "default" : "outline"}
                  className="text-xs h-7"
                  onClick={() => setColorMode("status")}
                >
                  Nach Status
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={colorMode === "custom" ? "default" : "outline"}
                  className="text-xs h-7"
                  onClick={() => setColorMode("custom")}
                >
                  Individuell
                </Button>
              </div>
              {colorMode === "custom" && (
                <div className="grid grid-cols-10 gap-1.5 pt-1">
                  {BOARD_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className="w-7 h-7 rounded-md border border-gray-200 flex items-center justify-center transition-transform hover:scale-110"
                      style={{ backgroundColor: color }}
                      onClick={() => setSelectedColor(color)}
                    >
                      {selectedColor === color && (
                        <Check className="h-3.5 w-3.5 text-gray-700" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="neues" className="mt-4">
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              Kommt bald
            </div>
          </TabsContent>
        </Tabs>

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
            disabled={!selectedProjectId || saving}
            onClick={handleSave}
          >
            {saving ? "Speichern..." : "Hinzufugen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, User, FileText, Clock, Mail, Phone, MapPin, FileSpreadsheet, Shirt, UserX, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import EmployeeDocumentsManager from "@/components/EmployeeDocumentsManager";

interface Employee {
  id: string;
  user_id: string | null;
  vorname: string;
  nachname: string;
  geburtsdatum: string | null;
  adresse: string | null;
  plz: string | null;
  ort: string | null;
  telefon: string | null;
  email: string | null;
  sv_nummer: string | null;
  eintritt_datum: string | null;
  austritt_datum: string | null;
  position: string | null;
  beschaeftigung_art: string | null;
  stundenlohn: number | null;
  iban: string | null;
  bic: string | null;
  bank_name: string | null;
  kleidungsgroesse: string | null;
  schuhgroesse: string | null;
  notizen: string | null;
  aktiv?: boolean | null;
}

/** Ein Snapshot aus deleted_users_archive (hart gelöschte Ex-Mitarbeiter). */
interface DeletedArchiveRow {
  id: string;
  vorname: string | null;
  nachname: string | null;
  email: string | null;
  telefon: string | null;
  austritt_datum: string | null;
  rolle: string | null;
  deleted_at: string;
  notiz: string | null;
}

export default function Employees() {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState<Partial<Employee>>({});
  const [newEmployee, setNewEmployee] = useState({ vorname: "", nachname: "", email: "" });
  const [showSizesDialog, setShowSizesDialog] = useState(false);
  // Reiter: aktive vs ausgeschiedene (archivierte) vs früher gelöschte MA.
  const [viewTab, setViewTab] = useState<"aktiv" | "archiv" | "geloescht">("aktiv");
  const [deletedArchive, setDeletedArchive] = useState<DeletedArchiveRow[]>([]);
  const [hiddenUserIds, setHiddenUserIds] = useState<Set<string>>(new Set());
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    checkAdminAccess();
    fetchEmployees();
    fetchDeletedArchive();
  }, []);

  const fetchDeletedArchive = async () => {
    const { data } = await (supabase.from("deleted_users_archive" as never) as any)
      .select("id, vorname, nachname, email, telefon, austritt_datum, rolle, deleted_at, notiz")
      .order("deleted_at", { ascending: false });
    setDeletedArchive(((data as DeletedArchiveRow[]) || []));
  };

  const checkAdminAccess = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate("/auth");
      return;
    }

    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (data?.role !== "administrator") {
      toast({ title: "Keine Berechtigung", description: "Nur Administratoren können auf diese Seite zugreifen", variant: "destructive" });
      navigate("/");
    }
  };

  const fetchEmployees = async () => {
    setLoading(true);
    const [{ data, error }, { data: hiddenProfs }] = await Promise.all([
      supabase.from("employees").select("*").order("nachname"),
      (supabase.from("profiles" as never) as any).select("id").eq("hidden", true),
    ]);

    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    } else {
      // ALLE Mitarbeiter laden — die Trennung aktiv/ausgeschieden passiert in
      // der UI. hiddenUserIds nur nutzen, um versteckte AKTIVE Konten (z.B.
      // Demo-Accounts) aus dem Aktiv-Reiter fernzuhalten; ausgeschiedene
      // (inaktive) MA werden IMMER gezeigt, damit sie auffindbar bleiben.
      setHiddenUserIds(new Set(((hiddenProfs as any[]) || []).map((p: any) => p.id)));
      setEmployees((data || []) as any);
    }
    setLoading(false);
  };

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const { data, error } = await supabase
        .from("employees")
        .insert({
          vorname: newEmployee.vorname,
          nachname: newEmployee.nachname,
          email: newEmployee.email || null,
        })
        .select()
        .single();

      if (error) throw error;

      toast({ title: "Erfolg", description: "Mitarbeiter wurde angelegt" });
      setShowCreateDialog(false);
      setNewEmployee({ vorname: "", nachname: "", email: "" });
      fetchEmployees();
    } catch (error: any) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    }
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee) return;

    try {
      const { error } = await supabase
        .from("employees")
        .update(formData)
        .eq("id", selectedEmployee.id);

      if (error) throw error;

      toast({ title: "Erfolg", description: "Änderungen gespeichert" });
      fetchEmployees();
      setSelectedEmployee(null);
    } catch (error: any) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    }
  };

  // Mitarbeiter ausscheiden = archivieren (NICHT löschen). Alle Daten bleiben
  // erhalten, der Login wird gesperrt. Jederzeit reaktivierbar.
  const handleArchiveEmployee = async (emp: Employee) => {
    setArchiving(true);
    try {
      const today = format(new Date(), "yyyy-MM-dd");
      // Zuerst den Login sperren (falls Benutzerkonto verknüpft) — schlägt das
      // fehl, brechen wir ab, bevor employees.aktiv geändert wird. So entsteht
      // kein Zustand "archiviert, aber Login noch offen".
      if (emp.user_id) {
        const { error: pErr } = await supabase.from("profiles").update({ is_active: false } as any).eq("id", emp.user_id);
        if (pErr) throw pErr;
      }
      const { error } = await supabase
        .from("employees")
        .update({ aktiv: false, austritt_datum: emp.austritt_datum || today } as any)
        .eq("id", emp.id);
      if (error) throw error;
      toast({ title: "Mitarbeiter ausgeschieden", description: "Ins Archiv verschoben — alle Daten bleiben erhalten." });
      setSelectedEmployee(null);
      fetchEmployees();
    } catch (error: any) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    } finally {
      setArchiving(false);
    }
  };

  // Ausgeschiedenen Mitarbeiter wieder aktivieren. Setzt aktiv=true + entsperrt
  // den Login (Rollen bleiben unverändert erhalten).
  const handleReactivateEmployee = async (emp: Employee) => {
    setArchiving(true);
    try {
      if (emp.user_id) {
        const { error: pErr } = await supabase.from("profiles").update({ is_active: true } as any).eq("id", emp.user_id);
        if (pErr) throw pErr;
      }
      const { error } = await supabase
        .from("employees")
        .update({ aktiv: true, austritt_datum: null } as any)
        .eq("id", emp.id);
      if (error) throw error;
      toast({ title: "Mitarbeiter reaktiviert", description: "Wieder in der aktiven Liste." });
      setSelectedEmployee(null);
      fetchEmployees();
    } catch (error: any) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    } finally {
      setArchiving(false);
    }
  };

  useEffect(() => {
    if (selectedEmployee) {
      setFormData(selectedEmployee);
    }
  }, [selectedEmployee]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Lade Mitarbeiter...</p>
      </div>
    );
  }

  // Versteckte AKTIVE Konten (z.B. Demo-Accounts) bleiben aus dem Aktiv-Reiter
  // ausgeblendet; ausgeschiedene (inaktive) MA werden immer angezeigt.
  const isHiddenActive = (e: Employee) => !!e.user_id && hiddenUserIds.has(e.user_id);
  const activeEmployees = employees.filter((e) => e.aktiv !== false && !isHiddenActive(e));
  const archivedEmployees = employees.filter((e) => e.aktiv === false);
  const visibleEmployees = viewTab === "archiv" ? archivedEmployees : activeEmployees;

  return (
    <div className="container mx-auto p-4">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="text-3xl font-bold">Mitarbeiterverwaltung</h1>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowSizesDialog(true)}>
            <Shirt className="w-4 h-4 mr-2" />
            Arbeitskleidung/Schuhe Größen
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Neuer Mitarbeiter
          </Button>
        </div>
      </div>

      {/* Reiter: Aktive / Ausgeschieden / Früher gelöscht */}
      <div className="mb-4 flex items-center gap-1 border-b">
        <button
          type="button"
          onClick={() => setViewTab("aktiv")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            viewTab === "aktiv" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Aktive <span className="opacity-70">({activeEmployees.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setViewTab("archiv")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            viewTab === "archiv" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          🗄️ Ausgeschieden <span className="opacity-70">({archivedEmployees.length})</span>
        </button>
        {deletedArchive.length > 0 && (
          <button
            type="button"
            onClick={() => setViewTab("geloescht")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              viewTab === "geloescht" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Früher gelöscht <span className="opacity-70">({deletedArchive.length})</span>
          </button>
        )}
      </div>

      {viewTab === "geloescht" ? (
        /* Read-only: hart gelöschte Ex-Mitarbeiter aus deleted_users_archive.
           Reine Nachweis-Ansicht — eine Reaktivierung ist hier nicht möglich
           (das Benutzerkonto müsste neu angelegt werden). */
        <div>
          <p className="text-sm text-muted-foreground mb-3">
            Diese Mitarbeiter wurden früher endgültig gelöscht. Die Daten sind als Nachweis erhalten,
            eine Reaktivierung ist hier aber nicht möglich (Benutzerkonto müsste neu angelegt werden).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {deletedArchive.map((d) => (
              <Card key={d.id} className="opacity-90">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Avatar><AvatarFallback>{(d.vorname?.[0] || "?")}{(d.nachname?.[0] || "")}</AvatarFallback></Avatar>
                    {d.vorname} {d.nachname}
                  </CardTitle>
                  <CardDescription>{d.rolle || "Mitarbeiter"}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-muted-foreground" />{d.email || "—"}</div>
                    <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-muted-foreground" />{d.telefon || "—"}</div>
                    {d.austritt_datum && <div className="text-muted-foreground">Austritt: {format(new Date(d.austritt_datum), "dd.MM.yyyy")}</div>}
                    <div className="text-muted-foreground">Gelöscht: {format(new Date(d.deleted_at), "dd.MM.yyyy")}</div>
                    {d.notiz && <div className="text-xs text-muted-foreground italic">„{d.notiz}"</div>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : visibleEmployees.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          {viewTab === "archiv" ? "Keine ausgeschiedenen Mitarbeiter." : "Keine aktiven Mitarbeiter."}
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibleEmployees.map((emp) => (
          <Card
            key={emp.id}
            className={`cursor-pointer hover:shadow-lg transition-shadow ${emp.aktiv === false ? "border-dashed opacity-90" : ""}`}
            onClick={() => setSelectedEmployee(emp)}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Avatar>
                  <AvatarFallback>
                    {emp.vorname[0]}
                    {emp.nachname[0]}
                  </AvatarFallback>
                </Avatar>
                <span className="flex-1">{emp.vorname} {emp.nachname}</span>
                {emp.aktiv === false && (
                  <Badge variant="outline" className="text-amber-600 border-amber-300 shrink-0">Ausgeschieden</Badge>
                )}
              </CardTitle>
              <CardDescription>{emp.position || "Mitarbeiter"}</CardDescription>
            </CardHeader>

            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  {emp.email || "Keine E-Mail"}
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-muted-foreground" />
                  {emp.telefon || "Keine Telefonnummer"}
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-muted-foreground" />
                  {emp.plz} {emp.ort || "Kein Ort"}
                </div>
                {emp.eintritt_datum && (
                  <div className="text-muted-foreground mt-2">
                    Seit: {format(new Date(emp.eintritt_datum), "dd.MM.yyyy")}
                    {emp.aktiv === false && emp.austritt_datum && ` · Austritt: ${format(new Date(emp.austritt_datum), "dd.MM.yyyy")}`}
                  </div>
                )}
                {emp.aktiv === false && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2 gap-1"
                    disabled={archiving}
                    onClick={(e) => { e.stopPropagation(); handleReactivateEmployee(emp); }}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reaktivieren
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      )}

      {/* Detail-Dialog */}
      <Dialog open={!!selectedEmployee} onOpenChange={() => setSelectedEmployee(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>
              {selectedEmployee?.vorname} {selectedEmployee?.nachname}
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="stammdaten">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="stammdaten">
                <User className="w-4 h-4 mr-2" />
                Stammdaten
              </TabsTrigger>
              <TabsTrigger value="dokumente">
                <FileText className="w-4 h-4 mr-2" />
                Dokumente
              </TabsTrigger>
              <TabsTrigger value="stunden">
                <Clock className="w-4 h-4 mr-2" />
                Überstunden
              </TabsTrigger>
            </TabsList>

            {/* Tab 1: Stammdaten */}
            <TabsContent value="stammdaten">
              <ScrollArea className="h-[500px] pr-4">
                <form onSubmit={handleSaveEmployee} className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Persönliche Daten</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Vorname *</Label>
                        <Input
                          value={formData.vorname || ""}
                          onChange={(e) => setFormData({ ...formData, vorname: e.target.value })}
                          required
                        />
                      </div>
                      <div>
                        <Label>Nachname *</Label>
                        <Input
                          value={formData.nachname || ""}
                          onChange={(e) => setFormData({ ...formData, nachname: e.target.value })}
                          required
                        />
                      </div>
                      <div>
                        <Label>Geburtsdatum</Label>
                        <Input
                          type="date"
                          value={formData.geburtsdatum || ""}
                          onChange={(e) => setFormData({ ...formData, geburtsdatum: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-lg font-semibold mb-3">Kontaktdaten</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-2">
                        <Label>Adresse</Label>
                        <Input
                          value={formData.adresse || ""}
                          onChange={(e) => setFormData({ ...formData, adresse: e.target.value })}
                          placeholder="Straße und Hausnummer"
                        />
                      </div>
                      <div>
                        <Label>PLZ</Label>
                        <Input
                          value={formData.plz || ""}
                          onChange={(e) => setFormData({ ...formData, plz: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Ort</Label>
                        <Input
                          value={formData.ort || ""}
                          onChange={(e) => setFormData({ ...formData, ort: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Telefon</Label>
                        <Input
                          type="tel"
                          value={formData.telefon || ""}
                          onChange={(e) => setFormData({ ...formData, telefon: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>E-Mail</Label>
                        <Input
                          type="email"
                          value={formData.email || ""}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-lg font-semibold mb-3">Beschäftigung</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>SV-Nummer</Label>
                        <Input
                          value={formData.sv_nummer || ""}
                          onChange={(e) => setFormData({ ...formData, sv_nummer: e.target.value })}
                          placeholder="1234 010180"
                        />
                      </div>
                      <div>
                        <Label>Position</Label>
                        <Input
                          value={formData.position || ""}
                          onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                          placeholder="z.B. Zimmermann"
                        />
                      </div>
                      <div>
                        <Label>Eintrittsdatum</Label>
                        <Input
                          type="date"
                          value={formData.eintritt_datum || ""}
                          onChange={(e) => setFormData({ ...formData, eintritt_datum: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Austrittsdatum</Label>
                        <Input
                          type="date"
                          value={formData.austritt_datum || ""}
                          onChange={(e) => setFormData({ ...formData, austritt_datum: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Beschäftigungsart</Label>
                        <Select
                          value={formData.beschaeftigung_art || ""}
                          onValueChange={(v) => setFormData({ ...formData, beschaeftigung_art: v })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Wählen..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="vollzeit">Vollzeit</SelectItem>
                            <SelectItem value="teilzeit">Teilzeit</SelectItem>
                            <SelectItem value="geringfuegig">Geringfügig</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Stundenlohn (€)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={formData.stundenlohn || ""}
                          onChange={(e) =>
                            setFormData({ ...formData, stundenlohn: parseFloat(e.target.value) })
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-lg font-semibold mb-3">Bankverbindung</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-2">
                        <Label>IBAN</Label>
                        <Input
                          value={formData.iban || ""}
                          onChange={(e) => setFormData({ ...formData, iban: e.target.value })}
                          placeholder="AT12 3456 7890 1234 5678"
                        />
                      </div>
                      <div>
                        <Label>BIC</Label>
                        <Input
                          value={formData.bic || ""}
                          onChange={(e) => setFormData({ ...formData, bic: e.target.value })}
                          placeholder="BKAUATWW"
                        />
                      </div>
                      <div>
                        <Label>Bank</Label>
                        <Input
                          value={formData.bank_name || ""}
                          onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-lg font-semibold mb-3">Arbeitskleidung</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Kleidungsgröße</Label>
                        <Select
                          value={formData.kleidungsgroesse || ""}
                          onValueChange={(v) => setFormData({ ...formData, kleidungsgroesse: v })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Wählen..." />
                          </SelectTrigger>
                          <SelectContent>
                            {["S", "M", "L", "XL", "XXL", "XXXL"].map((size) => (
                              <SelectItem key={size} value={size}>
                                {size}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Schuhgröße</Label>
                        <Select
                          value={formData.schuhgroesse || ""}
                          onValueChange={(v) => setFormData({ ...formData, schuhgroesse: v })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Wählen..." />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: 17 }, (_, i) => 36 + i).map((size) => (
                              <SelectItem key={size} value={size.toString()}>
                                {size}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <Label>Notizen</Label>
                    <Textarea
                      value={formData.notizen || ""}
                      onChange={(e) => setFormData({ ...formData, notizen: e.target.value })}
                      rows={4}
                      placeholder="Sonstige Anmerkungen..."
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row justify-between gap-2">
                    {selectedEmployee?.aktiv === false ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="gap-1 text-green-700 border-green-300 hover:bg-green-50"
                        disabled={archiving}
                        onClick={() => selectedEmployee && handleReactivateEmployee(selectedEmployee)}
                      >
                        <RotateCcw className="w-4 h-4" />
                        Reaktivieren
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        className="gap-1 text-amber-700 border-amber-300 hover:bg-amber-50"
                        disabled={archiving}
                        onClick={() => selectedEmployee && handleArchiveEmployee(selectedEmployee)}
                      >
                        <UserX className="w-4 h-4" />
                        Ausscheiden (archivieren)
                      </Button>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" onClick={() => setSelectedEmployee(null)}>
                        Abbrechen
                      </Button>
                      <Button type="submit">Speichern</Button>
                    </div>
                  </div>
                </form>
              </ScrollArea>
            </TabsContent>

            {/* Tab 2: Dokumente */}
            <TabsContent value="dokumente">
              {selectedEmployee && (
                <EmployeeDocumentsManager
                  employeeId={selectedEmployee.id}
                  userId={selectedEmployee.user_id || selectedEmployee.id}
                />
              )}
            </TabsContent>

            {/* Tab 3: Überstunden */}
            <TabsContent value="stunden">
              <div className="space-y-4 p-4">
                <p className="text-sm text-muted-foreground">
                  Zur vollständigen Stundenauswertung wechseln Sie bitte zur Stundenauswertung-Seite.
                </p>
                <Button
                  onClick={() => {
                    if (selectedEmployee?.user_id) {
                      navigate(`/hours-report?employee=${selectedEmployee.user_id}`);
                      setSelectedEmployee(null);
                    } else {
                      toast({
                        title: "Keine User-ID",
                        description: "Dieser Mitarbeiter hat noch keinen Benutzer-Account",
                        variant: "destructive",
                      });
                    }
                  }}
                  className="w-full"
                >
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Zur Stundenauswertung
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Create-Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neuer Mitarbeiter</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateEmployee} className="space-y-4">
            <div>
              <Label>Vorname *</Label>
              <Input
                value={newEmployee.vorname}
                onChange={(e) => setNewEmployee({ ...newEmployee, vorname: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>Nachname *</Label>
              <Input
                value={newEmployee.nachname}
                onChange={(e) => setNewEmployee({ ...newEmployee, nachname: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>E-Mail (optional)</Label>
              <Input
                type="email"
                value={newEmployee.email}
                onChange={(e) => setNewEmployee({ ...newEmployee, email: e.target.value })}
              />
            </div>
            <Button type="submit" className="w-full">
              Mitarbeiter anlegen
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Größen-Übersicht Dialog */}
      <Dialog open={showSizesDialog} onOpenChange={setShowSizesDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shirt className="w-5 h-5" />
              Arbeitskleidung & Schuhgrößen - Übersicht
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[600px]">
            <div className="rounded-md border">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Name</th>
                    <th className="px-4 py-3 text-left font-semibold">Position</th>
                    <th className="px-4 py-3 text-center font-semibold">Kleidungsgröße</th>
                    <th className="px-4 py-3 text-center font-semibold">Schuhgröße</th>
                  </tr>
                </thead>
                <tbody>
                  {activeEmployees
                    .slice()
                    .sort((a, b) => a.nachname.localeCompare(b.nachname))
                    .map((emp, idx) => (
                      <tr 
                        key={emp.id} 
                        className={`border-t hover:bg-muted/30 cursor-pointer transition-colors ${
                          idx % 2 === 0 ? 'bg-background' : 'bg-muted/10'
                        }`}
                        onClick={() => {
                          setShowSizesDialog(false);
                          setSelectedEmployee(emp);
                        }}
                      >
                        <td className="px-4 py-3 font-medium">
                          {emp.vorname} {emp.nachname}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {emp.position || "Mitarbeiter"}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {emp.kleidungsgroesse ? (
                            <span className="inline-flex items-center justify-center w-12 h-8 rounded-md bg-primary/10 text-primary font-semibold">
                              {emp.kleidungsgroesse}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {emp.schuhgroesse ? (
                            <span className="inline-flex items-center justify-center w-12 h-8 rounded-md bg-secondary/50 text-secondary-foreground font-semibold">
                              {emp.schuhgroesse}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {activeEmployees.filter(e => !e.kleidungsgroesse && !e.schuhgroesse).length > 0 && (
              <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-md">
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  ℹ️ {activeEmployees.filter(e => !e.kleidungsgroesse && !e.schuhgroesse).length} Mitarbeiter
                  haben noch keine Größenangaben. Klicke auf einen Mitarbeiter um die Daten zu ergänzen.
                </p>
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageCircle } from "lucide-react";

interface WhatsAppStatusProps {
  isAdmin: boolean;
}

export function WhatsAppStatus({ isAdmin }: WhatsAppStatusProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-green-600" />
          <CardTitle className="text-lg">WhatsApp Assistent</CardTitle>
          <Badge variant="outline" className="text-green-600 border-green-600 ml-auto">
            Aktiv
          </Badge>
        </div>
        <CardDescription>
          Stunden buchen, Fotos hochladen und Einteilung abfragen per WhatsApp
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-sm text-muted-foreground space-y-2">
          <p className="font-medium text-foreground">So funktioniert's:</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>Einfach normal schreiben, z.B. <span className="font-mono text-xs bg-muted px-1 rounded">"8h Musterstraße Kabel verlegt"</span></li>
            <li>Foto mit Projektname als Beschreibung senden</li>
            <li><span className="font-mono text-xs bg-muted px-1 rounded">"Wo muss ich heute hin?"</span> für deine Einteilung</li>
            <li><span className="font-mono text-xs bg-muted px-1 rounded">"Projekte"</span> um alle aktiven Projekte zu sehen</li>
          </ul>
          {isAdmin && (
            <p className="text-xs pt-2 border-t mt-3">
              Einstellungen unter <span className="font-medium">Verwaltung → WhatsApp Einstellungen</span>
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

import { useState, useEffect, useRef } from "react";
import { Camera, Trash2, X, ZoomIn, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogClose } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface BerichtPhoto {
  id: string;
  file_path: string;
  file_name: string;
  beschreibung: string | null;
  created_at: string;
}

interface BautagesberichtPhotosProps {
  berichtId: string;
}

export const BautagesberichtPhotos = ({ berichtId }: BautagesberichtPhotosProps) => {
  const { toast } = useToast();
  const [photos, setPhotos] = useState<BerichtPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchPhotos();
  }, [berichtId]);

  const fetchPhotos = async () => {
    const { data, error } = await (supabase.from("bautagesbericht_photos" as never) as any)
      .select("*")
      .eq("bautagesbericht_id", berichtId)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setPhotos(data as BerichtPhoto[]);
    }
    setLoading(false);
  };

  const getPublicUrl = (filePath: string): string => {
    const { data } = supabase.storage
      .from("bautagesbericht-photos")
      .getPublicUrl(filePath);
    return data.publicUrl;
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Sie muessen angemeldet sein",
      });
      setUploading(false);
      return;
    }

    let uploadedCount = 0;

    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) {
        toast({
          variant: "destructive",
          title: "Ungueltiger Dateityp",
          description: `${file.name} ist kein Bild`,
        });
        continue;
      }

      if (file.size > 10 * 1024 * 1024) {
        toast({
          variant: "destructive",
          title: "Datei zu gross",
          description: `${file.name} ist groesser als 10MB`,
        });
        continue;
      }

      const fileName = `${berichtId}/${Date.now()}_${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from("bautagesbericht-photos")
        .upload(fileName, file);

      if (uploadError) {
        toast({
          variant: "destructive",
          title: "Upload fehlgeschlagen",
          description: uploadError.message,
        });
        continue;
      }

      const { error: dbError } = await (supabase.from("bautagesbericht_photos" as never) as any)
        .insert({
          bautagesbericht_id: berichtId,
          user_id: user.id,
          file_path: fileName,
          file_name: file.name,
        });

      if (dbError) {
        await supabase.storage.from("bautagesbericht-photos").remove([fileName]);
        toast({
          variant: "destructive",
          title: "Fehler",
          description: "Foto konnte nicht gespeichert werden",
        });
        continue;
      }

      uploadedCount++;
    }

    if (uploadedCount > 0) {
      toast({
        title: "Erfolg",
        description: `${uploadedCount} Foto${uploadedCount > 1 ? "s" : ""} hochgeladen`,
      });
      fetchPhotos();
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setUploading(false);
  };

  const handleDelete = async (photo: BerichtPhoto) => {
    await supabase.storage.from("bautagesbericht-photos").remove([photo.file_path]);

    const { error } = await (supabase.from("bautagesbericht_photos" as never) as any)
      .delete()
      .eq("id", photo.id);

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Foto konnte nicht geloescht werden",
      });
    } else {
      toast({ title: "Erfolg", description: "Foto geloescht" });
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    }
  };

  const handleUpdateBeschreibung = async (photoId: string, beschreibung: string) => {
    await (supabase.from("bautagesbericht_photos" as never) as any)
      .update({ beschreibung })
      .eq("id", photoId);
    setPhotos((prev) =>
      prev.map((p) => (p.id === photoId ? { ...p, beschreibung } : p))
    );
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Fotos
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="gap-2"
            >
              <Upload className="h-4 w-4" />
              {uploading ? "Laedt..." : "Foto hinzufuegen"}
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleUpload}
          />
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              Laedt Fotos...
            </div>
          ) : photos.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Keine Fotos vorhanden
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {photos.map((photo) => (
                <div key={photo.id} className="space-y-1">
                  <div className="relative group aspect-square">
                    <img
                      src={getPublicUrl(photo.file_path)}
                      alt={photo.file_name}
                      className="w-full h-full object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => setSelectedPhoto(getPublicUrl(photo.file_path))}
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors rounded-lg pointer-events-none" />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-1 right-1 h-7 w-7 bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                      onClick={() => setSelectedPhoto(getPublicUrl(photo.file_path))}
                    >
                      <ZoomIn className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute bottom-1 right-1 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleDelete(photo)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <Input
                    placeholder="Beschreibung..."
                    value={photo.beschreibung || ""}
                    onChange={(e) => handleUpdateBeschreibung(photo.id, e.target.value)}
                    className="text-xs h-7"
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedPhoto} onOpenChange={() => setSelectedPhoto(null)}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 overflow-hidden">
          <DialogClose className="absolute right-4 top-4 z-10 rounded-sm bg-black/50 p-2 opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
            <X className="h-5 w-5 text-white" />
            <span className="sr-only">Close</span>
          </DialogClose>
          {selectedPhoto && (
            <img
              src={selectedPhoto}
              alt="Vollbild"
              className="w-full h-full object-contain max-h-[90vh]"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

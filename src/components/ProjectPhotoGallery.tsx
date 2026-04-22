import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PhotoGallery, type PhotoItem } from "@/components/PhotoGallery";

/**
 * Projekt-Foto-Galerie — nutzt die generische PhotoGallery mit dem
 * "documents"-Schema als Persistenz (typ='photos'). Das gibt Projekten
 * das gleiche Look-and-Feel wie Ersttermin/Bautagesbericht: Grid 2/3/4
 * Spalten, Drag&Drop, Lightbox, Kommentar pro Foto + Kommentar-Dialog
 * direkt nach Upload.
 *
 * Storage-Bucket: project-photos (public).
 * DB-Tabelle: documents (typ='photos', project_id, user_id, file_url,
 * beschreibung).
 */

interface DocRow {
  id: string;
  name: string;
  file_url: string;
  beschreibung: string | null;
  created_at: string;
}

export function ProjectPhotoGallery({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDocs = async () => {
    const { data } = await supabase
      .from("documents")
      .select("id, name, file_url, beschreibung, created_at")
      .eq("project_id", projectId)
      .eq("typ", "photos")
      .order("created_at", { ascending: false });
    setDocs(((data as any[]) || []) as DocRow[]);
    setLoading(false);
  };

  useEffect(() => { fetchDocs(); }, [projectId]);

  const handleUpload = async (file: File, comment: string | null) => {
    if (!file.type.startsWith("image/")) {
      toast({ variant: "destructive", title: "Ungültiger Dateityp", description: "Nur Bilder erlaubt." });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ variant: "destructive", title: "Datei zu groß", description: "Max. 20 MB pro Foto." });
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const filePath = `${projectId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("project-photos")
      .upload(filePath, file, { contentType: file.type });
    if (upErr) {
      toast({ variant: "destructive", title: "Upload fehlgeschlagen", description: upErr.message });
      return;
    }
    const { data: urlData } = supabase.storage.from("project-photos").getPublicUrl(filePath);
    const { error: dbErr } = await supabase.from("documents").insert({
      project_id: projectId,
      user_id: user.id,
      typ: "photos",
      name: file.name,
      file_url: urlData.publicUrl,
      beschreibung: comment || null,
    } as any);
    if (dbErr) {
      // Rollback — verwaistes Storage-File wieder entfernen
      await supabase.storage.from("project-photos").remove([filePath]);
      toast({ variant: "destructive", title: "Foto konnte nicht gespeichert werden", description: dbErr.message });
      return;
    }
    await fetchDocs();
  };

  const handleUpdateComment = async (photoId: string, comment: string) => {
    const { error } = await supabase
      .from("documents")
      .update({ beschreibung: comment } as any)
      .eq("id", photoId);
    if (error) {
      toast({ variant: "destructive", title: "Kommentar nicht gespeichert", description: error.message });
      return;
    }
    setDocs(prev => prev.map(d => d.id === photoId ? { ...d, beschreibung: comment } : d));
  };

  const handleDelete = async (photo: PhotoItem) => {
    const doc = docs.find(d => d.id === photo.id);
    if (!doc) return;
    // Pfad aus der Public-URL extrahieren (letzten zwei Segmente)
    const urlParts = doc.file_url.split("/");
    const filePath = `${projectId}/${urlParts[urlParts.length - 1]}`;
    await supabase.storage.from("project-photos").remove([filePath]);
    const { error } = await supabase.from("documents").delete().eq("id", doc.id);
    if (error) {
      toast({ variant: "destructive", title: "Foto konnte nicht gelöscht werden", description: error.message });
      return;
    }
    setDocs(prev => prev.filter(d => d.id !== photo.id));
  };

  const items: PhotoItem[] = docs.map(d => ({
    id: d.id,
    url: d.file_url,
    fileName: d.name,
    beschreibung: d.beschreibung,
    createdAt: d.created_at,
  }));

  return (
    <PhotoGallery
      photos={items}
      loading={loading}
      onUpload={handleUpload}
      onUpdateComment={handleUpdateComment}
      onDelete={handleDelete}
    />
  );
}

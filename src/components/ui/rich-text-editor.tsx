// WYSIWYG Rich-Text-Editor für Email-Bodies + Template-Editor.
// Basiert auf react-quill-new (Quill 2.0, React 18+ kompatibel).
// Output ist HTML-String — kompatibel mit Resend `html`-Field und
// unserer email_templates.body_html-Spalte.
import { useMemo } from "react";
import ReactQuill from "react-quill-new";
import "react-quill-new/dist/quill.snow.css";

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}

export function RichTextEditor({ value, onChange, placeholder, rows = 8, className }: Props) {
  const modules = useMemo(() => ({
    toolbar: [
      [{ header: [1, 2, 3, false] }],
      ["bold", "italic", "underline"],
      [{ list: "ordered" }, { list: "bullet" }],
      ["link"],
      ["clean"],
    ],
  }), []);

  const formats = [
    "header", "bold", "italic", "underline",
    "list", "bullet", "link",
  ];

  // Mindesthöhe an „rows" anlehnen, damit das Feld optisch zur
  // Textarea-Variante passt (rows*22px Body + 42px Toolbar).
  const minHeight = rows * 22 + 42;

  return (
    <div className={`rte-wrap ${className || ""}`} style={{ ["--rte-min-h" as never]: `${minHeight}px` }}>
      <ReactQuill
        theme="snow"
        value={value || ""}
        onChange={onChange}
        modules={modules}
        formats={formats}
        placeholder={placeholder}
      />
      <style>{`
        .rte-wrap .ql-container {
          min-height: var(--rte-min-h);
          font-family: inherit;
          font-size: 13px;
        }
        .rte-wrap .ql-editor {
          min-height: var(--rte-min-h);
        }
        .rte-wrap .ql-toolbar {
          border-top-left-radius: 6px;
          border-top-right-radius: 6px;
          border-color: hsl(var(--border));
        }
        .rte-wrap .ql-container {
          border-bottom-left-radius: 6px;
          border-bottom-right-radius: 6px;
          border-color: hsl(var(--border));
        }
      `}</style>
    </div>
  );
}

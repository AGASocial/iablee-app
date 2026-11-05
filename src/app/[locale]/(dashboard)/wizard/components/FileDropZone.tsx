import { useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FileUploadItem } from "./types";

interface FileDropZoneProps {
  files: FileUploadItem[];
  maxFiles: number;
  maxFileSizeMb: number;
  accept?: string;
  disabled?: boolean;
  onAddFiles: (files: FileList | null) => void;
  onRemoveFile: (id: string) => void;
  translate: (key: string, values?: Record<string, string | number>) => string;
}

export function FileDropZone({
  files,
  maxFiles,
  maxFileSizeMb,
  accept,
  disabled = false,
  onAddFiles,
  onRemoveFile,
  translate,
}: FileDropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    onAddFiles(event.dataTransfer.files);
  };

  const openFileDialog = () => {
    if (!disabled) inputRef.current?.click();
  };

  const statusLabel = (status: FileUploadItem["status"]) => {
    if (status === "pending") return translate("wizard-file-status-pending");
    if (status === "uploading") return translate("wizard-file-status-uploading");
    if (status === "uploaded") return translate("wizard-file-status-uploaded");
    return translate("wizard-file-status-error");
  };

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={translate("wizard-file-dropzone-label")}
        onClick={openFileDialog}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openFileDialog();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`rounded-xl border border-dashed p-4 text-center transition ${
          dragging ? "border-primary bg-brand-tint" : "border-border bg-card"
        }`}
      >
        <Upload className="mx-auto mb-2 h-5 w-5 text-primary" aria-hidden="true" />
        <p className="text-sm text-foreground">{translate("wizard-file-dropzone-title")}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {translate("wizard-file-dropzone-limits", { count: maxFiles, size: maxFileSizeMb })}
        </p>
        <Button type="button" variant="outline" className="mt-3 h-10" disabled={disabled}>
          {translate("wizard-file-dropzone-action")}
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept || "*"}
        className="hidden"
        onChange={(event) => {
          onAddFiles(event.target.files);
          event.currentTarget.value = "";
        }}
        disabled={disabled}
      />

      {files.length > 0 ? (
        <ul className="space-y-2">
          {files.map((fileItem) => (
            <li key={fileItem.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">{fileItem.file.name}</p>
                <p className="text-xs text-muted-foreground">{statusLabel(fileItem.status)}</p>
                {fileItem.error ? <p className="text-xs text-destructive">{fileItem.error}</p> : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={() => onRemoveFile(fileItem.id)}
                aria-label={translate("wizard-file-remove")}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

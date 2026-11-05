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

  const handleDrop = (event: React.DragEvent<HTMLButtonElement>) => {
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
      <button
        type="button"
        data-file-dropzone="true"
        aria-label={translate("wizard-file-dropzone-label")}
        disabled={disabled}
        onClick={openFileDialog}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`w-full rounded-xl border border-dashed p-4 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
          dragging ? "border-primary bg-brand-tint" : "border-border bg-card"
        }`}
      >
        <Upload className="mx-auto mb-2 h-5 w-5 text-primary" aria-hidden="true" />
        <p className="text-sm text-foreground">{translate("wizard-file-dropzone-title")}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {translate("wizard-file-dropzone-limits", { count: maxFiles, size: maxFileSizeMb })}
        </p>
        <span className="mt-3 inline-flex h-10 items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground">
          {translate("wizard-file-dropzone-action")}
        </span>
      </button>

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

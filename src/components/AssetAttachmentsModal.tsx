"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Download, Trash2, Upload, Eye, File, Image, Video, Music, FileText, X } from "lucide-react";
import type { Asset, AssetAttachment } from "@/models/asset";
import { toast } from "sonner"; // Assuming sonner is used for toasts based on package.json

interface AssetAttachmentsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: Asset;
  onFilesUpdated: () => void;
}

// Extended interface for UI state
interface AttachmentWithState extends AssetAttachment {
  url?: string;
  error?: string;
  isLoading?: boolean;
}

export default function AssetAttachmentsModal({
  open,
  onOpenChange,
  asset,
  onFilesUpdated
}: AssetAttachmentsModalProps) {
  const t = useTranslations();
  const [attachments, setAttachments] = useState<AttachmentWithState[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<AttachmentWithState | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Detect viewport to adjust filename truncation on mobile
  useEffect(() => {
    const updateIsMobile = () => {
      if (typeof window !== 'undefined') {
        setIsMobile(window.innerWidth < 640);
      }
    };
    updateIsMobile();
    window.addEventListener('resize', updateIsMobile);
    return () => window.removeEventListener('resize', updateIsMobile);
  }, []);

  const loadAttachments = useCallback(async () => {
    if (!asset.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/assets/${asset.id}/attachments`);
      if (!res.ok) throw new Error('Failed to load attachments');
      const data: AssetAttachment[] = await res.json();
      setAttachments(data);
    } catch (error) {
      console.error('Error loading files:', error);
      toast.error(t('errorLoadingFiles') || 'Error loading files');
      setAttachments([]);
    } finally {
      setLoading(false);
    }
  }, [asset.id, t]);

  useEffect(() => {
    if (open) {
      loadAttachments();
    }
  }, [open, loadAttachments]);

  const getProxyUrl = (attachmentId: string) => {
    return `/api/assets/attachments/${attachmentId}`;
  };

  const openPreview = (file: AttachmentWithState) => {
    // For proxy, we just need the URL. The browser/auth handling is done via cookie in the API request.
    const url = getProxyUrl(file.id);
    setPreviewFile({ ...file, url });
  };

  // Truncate filename keeping extension; use middle ellipsis for better context
  const truncateFilename = (name: string, maxLength: number): string => {
    if (!name || name.length <= maxLength) return name;
    const dotIndex = name.lastIndexOf('.');
    const extension = dotIndex > 0 ? name.slice(dotIndex) : '';
    const base = dotIndex > 0 ? name.slice(0, dotIndex) : name;
    const ellipsis = '...';
    const available = Math.max(0, maxLength - extension.length - ellipsis.length);
    const front = Math.ceil(available * 0.6);
    const back = available - front;
    return `${base.slice(0, front)}${ellipsis}${base.slice(base.length - back)}${extension}`;
  };

  const getFileType = (extension: string): string => {
    const imageTypes = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
    const videoTypes = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv'];
    const audioTypes = ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a'];
    const documentTypes = ['pdf', 'doc', 'docx', 'txt', 'rtf'];

    if (imageTypes.includes(extension)) return 'image';
    if (videoTypes.includes(extension)) return 'video';
    if (audioTypes.includes(extension)) return 'audio';
    if (documentTypes.includes(extension)) return 'document';
    return 'other';
  };

  const getFileIcon = (fileType: string) => {
    switch (fileType) {
      case 'image': return <Image className="w-5 h-5" aria-label="Image file" />;
      case 'video': return <Video className="w-5 h-5" />;
      case 'audio': return <Music className="w-5 h-5" />;
      case 'document': return <FileText className="w-5 h-5" />;
      default: return <File className="w-5 h-5" />;
    }
  };

  const handleDownload = async (file: AttachmentWithState) => {
    try {
      const url = getProxyUrl(file.id);

      // We can use a simple anchor tag download if it's same-origin (which API is)
      // but to ensure headers are respected or to handle auth explicitly if needed:
      const a = document.createElement('a');
      a.href = url;
      a.download = file.file_name; // The API also sets Content-Disposition
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading file:', error);
      toast.error(t('errorDownloadingFile') || 'Error downloading file');
    }
  };

  const handleDelete = async (file: AttachmentWithState) => {
    if (!confirm(t('deleteFileConfirm'))) return;

    try {
      const res = await fetch(`/api/assets/attachments/${file.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error('Failed to delete file');
      }

      onFilesUpdated();
      await loadAttachments();
      toast.success(t('fileDeleted') || 'File deleted successfully');
    } catch (error) {
      console.error('Error deleting file:', error);
      toast.error(t('errorDeletingFile') || 'Error deleting file');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    setUploading(true);
    try {
      for (const file of Array.from(selectedFiles)) {
        // 1. Upload to Storage via API
        const formData = new FormData();
        formData.append('file', file);

        const uploadRes = await fetch('/api/storage/upload', {
          method: 'POST',
          body: formData,
        });

        if (!uploadRes.ok) {
          const err = await uploadRes.json();
          throw new Error(err.error || 'Upload failed');
        }

        const uploadData = await uploadRes.json();

        // 2. Create Attachment Record via API
        const extension = file.name.split('.').pop()?.toLowerCase() || '';
        const fileType = getFileType(extension);

        const res = await fetch(`/api/assets/${asset.id}/attachments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_path: uploadData.path,
            file_name: uploadData.fileName, // Use sanitized name from server
            file_type: fileType,
            file_size: file.size
          })
        });

        if (!res.ok) {
          throw new Error('Failed to save attachment record');
        }
      }

      onFilesUpdated();
      await loadAttachments();
      toast.success(t('filesUploaded') || 'Files uploaded successfully');
    } catch (error) {
      console.error('Error uploading files:', error);
      toast.error(t('errorUploadingFiles') || 'Error uploading files');
    } finally {
      setUploading(false);
      // Reset input
      e.target.value = '';
    }
  };

  /* eslint-disable @next/next/no-img-element */
  const renderPreview = (file: AttachmentWithState) => {
    if (file.error === 'not_found') {
      return (
        <div className="flex items-center justify-center p-8 text-center bg-gray-50 dark:bg-gray-800 rounded-lg h-64">
          <div>
            <File className="w-16 h-16 mx-auto mb-4 text-red-500" />
            <p className="text-red-600 font-medium mb-2">{t('fileNotFound')}</p>
            <p className="text-sm text-gray-500 mb-4">{t('fileNotFoundDesc') || "The file could not be found."}</p>
          </div>
        </div>
      );
    }
    if (!file.url) return null;

    // Normalize file_type: could be MIME (e.g. "image/jpeg") or simple (e.g. "image")
    const normalizedType = file.file_type.includes('/')
      ? file.file_type.split('/')[0]   // "image/jpeg" → "image"
      : file.file_type;                // already "image"

    switch (normalizedType) {
      case 'image':
        return (
          <div className="flex items-center justify-center p-4">
            <img
              src={file.url}
              alt={file.file_name}
              className="max-w-full max-h-96 object-contain rounded-lg shadow-lg"
            />
          </div>
        );
      case 'video':
        return (
          <div className="flex items-center justify-center p-4">
            <video
              src={file.url}
              controls
              className="max-w-full max-h-96 rounded-lg shadow-lg"
            >
              Your browser does not support the video tag.
            </video>
          </div>
        );
      case 'audio':
        return (
          <div className="flex items-center justify-center p-4">
            <audio
              src={file.url}
              controls
              className="w-full max-w-md"
            >
              Your browser does not support the audio tag.
            </audio>
          </div>
        );
      case 'document':
        if (file.file_name.toLowerCase().endsWith('.pdf')) {
          return (
            <div className="w-full h-96">
              <iframe
                src={file.url}
                className="w-full h-full border-0 rounded-lg"
                title={file.file_name}
              />
            </div>
          );
        }
        return (
          <div className="flex items-center justify-center p-8 text-center">
            <div>
              <FileText className="w-16 h-16 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-600">{t('previewNotAvailable')}</p>
              <Button
                onClick={() => handleDownload(file)}
                className="mt-4"
              >
                <Download className="w-4 h-4 mr-2" />
                {t('download')}
              </Button>
            </div>
          </div>
        );
      default:
        return (
          <div className="flex items-center justify-center p-8 text-center">
            <div>
              <File className="w-16 h-16 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-600">{t('previewNotAvailable')}</p>
              <Button
                onClick={() => handleDownload(file)}
                className="mt-4"
              >
                <Download className="w-4 h-4 mr-2" />
                {t('download')}
              </Button>
            </div>
          </div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-7xl md:max-w-7xl lg:max-w-7xl w-[95vw] max-h-[90vh] bg-white dark:bg-gray-800 border-0 shadow-2xl p-0">
        <DialogHeader className="p-6 pb-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <DialogTitle className="text-gray-900 dark:text-white text-xl font-semibold">
            {t('assetAttachments')} - {asset?.asset_name || ''}
          </DialogTitle>
          <DialogClose asChild />
        </DialogHeader>

        <div className="flex flex-col h-full bg-white dark:bg-gray-800">
          {/* Upload Section */}
          <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <div className="flex items-center gap-4">
              <input
                type="file"
                multiple
                onChange={handleFileUpload}
                className="hidden"
                id="file-upload"
                accept="*"
              />
              <label htmlFor="file-upload">
                <Button
                  asChild
                  disabled={uploading}
                  className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white dark:bg-gray-700 dark:hover:bg-gray-600"
                >
                  <span>
                    <Upload className="w-4 h-4" />
                    {uploading ? t('uploading') : t('uploadFiles')}
                  </span>
                </Button>
              </label>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {attachments.length} {t('filesAttached')}
              </span>
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-hidden bg-white dark:bg-gray-800">
            {loading ? (
              <div className="flex items-center justify-center h-64 bg-white dark:bg-gray-800">
                <div className="text-gray-500 dark:text-gray-400">{t('loading')}</div>
              </div>
            ) : attachments.length === 0 ? (
              <div className="flex items-center justify-center h-64 bg-white dark:bg-gray-800">
                <div className="text-center">
                  <File className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-500" />
                  <p className="text-gray-600 dark:text-gray-400">{t('noFilesAttached')}</p>
                </div>
              </div>
            ) : previewFile ? (
              /* Preview Mode */
              <div className="h-full flex flex-col bg-white dark:bg-gray-800">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-white dark:bg-gray-800">
                  <h3 className="font-medium text-gray-900 dark:text-white">
                    {previewFile.file_name}
                  </h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPreviewFile(null)}
                    className="border-gray-300 dark:border-gray-600"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <div className="flex-1 overflow-auto bg-white dark:bg-gray-800">
                  {renderPreview(previewFile)}
                </div>
              </div>
            ) : (
              /* File List Mode */
              <div className="h-full overflow-auto bg-white dark:bg-gray-800">
                <div className="p-6">
                  <div className="space-y-3">
                    {attachments.map((file, index) => (
                      <div
                        key={file.id || index}
                        className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow bg-white dark:bg-gray-700"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                          <div className="flex-shrink-0 text-gray-500 dark:text-gray-400">
                            {getFileIcon(file.file_type.includes('/') ? file.file_type.split('/')[0] : file.file_type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p
                              className="text-sm font-medium text-gray-900 dark:text-white truncate"
                              title={file.file_name}
                            >
                              {truncateFilename(file.file_name, isMobile ? 22 : 40)}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                              {file.file_type} {file.file_size ? `• ${(file.file_size / 1024).toFixed(1)} KB` : ''}
                            </p>
                          </div>
                          <div className="flex gap-2 w-full sm:w-auto mt-1 sm:mt-0 sm:flex-shrink-0 justify-start sm:justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openPreview(file)}
                              className="border-gray-300 dark:border-gray-600 whitespace-nowrap"
                            >
                              <Eye className="w-4 h-4 mr-1" />
                              {t('preview')}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDownload(file)}
                              className="border-gray-300 dark:border-gray-600"
                              title={t('download')}
                            >
                              <Download className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleDelete(file)}
                              title={t('delete')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

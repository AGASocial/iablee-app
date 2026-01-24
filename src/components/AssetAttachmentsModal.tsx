"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { Download, Trash2, Upload, Eye, File, Image, Video, Music, FileText, X } from "lucide-react";
import type { Asset } from "@/models/asset";

interface AssetAttachmentsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: Asset;
  onFilesUpdated: () => void;
}

interface FileWithMetadata {
  path: string;
  name: string;
  type: string;
  size?: number;
  url?: string;
}

export default function AssetAttachmentsModal({ 
  open, 
  onOpenChange, 
  asset, 
  onFilesUpdated 
}: AssetAttachmentsModalProps) {
  const t = useTranslations();
  const [files, setFiles] = useState<FileWithMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileWithMetadata | null>(null);
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

  useEffect(() => {
    if (open) {
      loadFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, asset?.id]);

  const buildFilesFromPaths = async (paths: string[]): Promise<FileWithMetadata[]> => {
    return Promise.all(
      paths.map(async (filePath) => {
        const fileName = filePath.split('/').pop() || filePath;
        const extension = fileName.split('.').pop()?.toLowerCase() || '';
        const fileType = getFileType(extension);

        let url: string | undefined;
        try {
          const { data: signedData } = await supabase.storage
            .from('assets')
            .createSignedUrl(filePath, 60 * 60);
          if (signedData?.signedUrl) url = signedData.signedUrl;
        } catch {}
        if (!url) {
          const { data: urlData } = supabase.storage.from('assets').getPublicUrl(filePath);
          url = urlData.publicUrl;
        }
        return { path: filePath, name: fileName, type: fileType, url } as FileWithMetadata;
      })
    );
  };

  const loadFiles = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('digital_assets')
        .select('files')
        .eq('id', asset.id)
        .single();
      if (error) throw error;
      const paths = Array.isArray(data?.files) ? (data!.files as string[]) : [];
      const filesWithMetadata = await buildFilesFromPaths(paths);
      setFiles(filesWithMetadata);
    } catch (error) {
      console.error('Error loading files:', error);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  const openPreview = async (file: FileWithMetadata) => {
    try {
      // Prefer a signed URL for preview (works with private buckets)
      const { data, error } = await supabase.storage
        .from('assets')
        .createSignedUrl(file.path, 60 * 60);
      if (!error && data?.signedUrl) {
        setPreviewFile({ ...file, url: data.signedUrl });
        return;
      }
      // Fallback: use whatever URL we already have (public)
      if (file.url) {
        setPreviewFile(file);
        return;
      }
      // Last resort: download blob and preview locally
      const dl = await supabase.storage.from('assets').download(file.path);
      if (dl.data) {
        const blobUrl = URL.createObjectURL(dl.data);
        setPreviewFile({ ...file, url: blobUrl });
        return;
      }
      throw error || dl.error;
    } catch (err) {
      console.error('Error opening preview:', err);
      alert('Error loading preview');
    }
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

  const handleDownload = async (file: FileWithMetadata) => {
    try {
      // Generate a signed URL that triggers download
      const { data, error } = await supabase.storage
        .from('assets')
        .createSignedUrl(file.path, 60 * 60, { download: true });
      if (error || !data?.signedUrl) throw error || new Error('No signed url');

      const a = document.createElement('a');
      a.href = data.signedUrl;
      a.download = file.name;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading file:', error);
      alert('Error downloading file');
    }
  };

  const handleDelete = async (file: FileWithMetadata) => {
    if (!confirm(t('deleteFileConfirm'))) return;
    
    try {
      // Remove from storage
      const { error: storageError } = await supabase.storage
        .from('assets')
        .remove([file.path]);
      
      if (storageError) throw storageError;
      
      // Update asset files array
      const updatedFiles = asset?.files?.filter(f => f !== file.path) || [];
      const { error: dbError } = await supabase
        .from('digital_assets')
        .update({ 
          files: updatedFiles.length > 0 ? updatedFiles : null,
          number_of_files: updatedFiles.length
        })
        .eq('id', asset?.id);
      
      if (dbError) throw dbError;
      
      onFilesUpdated();
      await loadFiles();
    } catch (error) {
      console.error('Error deleting file:', error);
      alert('Error deleting file');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;
    
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      
      const newFilePaths: string[] = [];
      
      for (const file of Array.from(selectedFiles)) {
        // Sanitize file name
        const safeFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const filePath = `${user.id}/${Date.now()}-${safeFileName}`;
        
        const { data, error } = await supabase.storage
          .from('assets')
          .upload(filePath, file);
        
        if (error) throw error;
        newFilePaths.push(data.path);
      }
      
      // Update asset with new files
      const existingFiles = asset?.files || [];
      const allFiles = [...existingFiles, ...newFilePaths];
      
      const { error: dbError } = await supabase
        .from('digital_assets')
        .update({ 
          files: allFiles,
          number_of_files: allFiles.length
        })
        .eq('id', asset?.id);
      
      if (dbError) throw dbError;
      
      onFilesUpdated();
      await loadFiles();
    } catch (error) {
      console.error('Error uploading files:', error);
      alert('Error uploading files');
    } finally {
      setUploading(false);
    }
  };

  const renderPreview = (file: FileWithMetadata) => {
    if (!file.url) return null;
    
    switch (file.type) {
      case 'image':
        return (
          <div className="flex items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img 
              src={file.url} 
              alt={file.name}
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
        if (file.name.toLowerCase().endsWith('.pdf')) {
          return (
            <div className="w-full h-96">
              <iframe 
                src={file.url}
                className="w-full h-full border-0 rounded-lg"
                title={file.name}
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
                {files.length} {t('filesAttached')}
              </span>
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-hidden bg-white dark:bg-gray-800">
            {loading ? (
              <div className="flex items-center justify-center h-64 bg-white dark:bg-gray-800">
                <div className="text-gray-500 dark:text-gray-400">{t('loading')}</div>
              </div>
            ) : files.length === 0 ? (
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
                    {previewFile.name}
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
                    {files.map((file, index) => (
                      <div 
                        key={index}
                        className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow bg-white dark:bg-gray-700"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                          <div className="flex-shrink-0 text-gray-500 dark:text-gray-400">
                            {getFileIcon(file.type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p 
                              className="text-sm font-medium text-gray-900 dark:text-white truncate"
                              title={file.name}
                            >
                              {truncateFilename(file.name, isMobile ? 22 : 40)}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                              {file.type}
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

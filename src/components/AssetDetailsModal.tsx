"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
    Mail, Mic, Camera, Video, File, LucideIcon,
    Calendar, User, Paperclip, Download, ExternalLink,
    Edit, Trash2, X, Check, Pencil
} from "lucide-react";
import type { Asset, AssetAttachment } from "@/models/asset";
import { Badge } from "@/components/ui/badge";
import AddAssetForm from "./AddAssetForm";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Beneficiary } from "@/models/beneficiary";

// Reusing style config to match AddAssetModal
const typeStyles: Record<string, { gradient: string; iconBg: string; iconColor: string; borderColor: string }> = {
    letter: {
        gradient: 'from-rose-50 to-pink-50 dark:from-rose-950/30 dark:to-pink-950/30',
        iconBg: 'bg-rose-100 dark:bg-rose-900/40',
        iconColor: 'text-rose-600 dark:text-rose-400',
        borderColor: 'border-rose-200 dark:border-rose-800',
    },
    audio: {
        gradient: 'from-violet-50 to-purple-50 dark:from-violet-950/30 dark:to-purple-950/30',
        iconBg: 'bg-violet-100 dark:bg-violet-900/40',
        iconColor: 'text-violet-600 dark:text-violet-400',
        borderColor: 'border-violet-200 dark:border-violet-800',
    },
    photo: {
        gradient: 'from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30',
        iconBg: 'bg-amber-100 dark:bg-amber-900/40',
        iconColor: 'text-amber-600 dark:text-amber-400',
        borderColor: 'border-amber-200 dark:border-amber-800',
    },
    video: {
        gradient: 'from-sky-50 to-cyan-50 dark:from-sky-950/30 dark:to-cyan-950/30',
        iconBg: 'bg-sky-100 dark:bg-sky-900/40',
        iconColor: 'text-sky-600 dark:text-sky-400',
        borderColor: 'border-sky-200 dark:border-sky-800',
    },
    document: {
        gradient: 'from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30',
        iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
        iconColor: 'text-emerald-600 dark:text-emerald-400',
        borderColor: 'border-emerald-200 dark:border-emerald-800',
    },
};

const defaultStyle = {
    gradient: 'from-gray-50 to-slate-50 dark:from-gray-950/30 dark:to-slate-950/30',
    iconBg: 'bg-gray-100 dark:bg-gray-900/40',
    iconColor: 'text-gray-600 dark:text-gray-400',
    borderColor: 'border-gray-200 dark:border-gray-800',
};

interface AssetDetailsModalProps {
    asset: Asset | null;
    open: boolean;
    onClose: () => void;
    onDelete: (id: string) => void;
    onManageFiles: (asset: Asset) => void;
    beneficiaries?: Beneficiary[];
    onAssignBeneficiary?: (beneficiaryId: string | null) => Promise<void>;
    onAssetUpdated?: () => void;
}

export default function AssetDetailsModal({
    asset,
    open,
    onClose,
    onDelete,
    onManageFiles,
    beneficiaries = [],
    onAssignBeneficiary,
    onAssetUpdated
}: AssetDetailsModalProps) {
    const t = useTranslations();
    const [attachments, setAttachments] = useState<AssetAttachment[]>([]);
    const [loadingFiles, setLoadingFiles] = useState(false);
    const [updatingBeneficiary, setUpdatingBeneficiary] = useState(false);
    const [isEditing, setIsEditing] = useState(false);

    useEffect(() => {
        if (asset && open) {
            fetchAttachments();
            setIsEditing(false);
        } else {
            setAttachments([]);
            setIsEditing(false);
        }
    }, [asset, open]);

    const fetchAttachments = async () => {
        if (!asset) return;
        setLoadingFiles(true);
        try {
            const res = await fetch(`/api/assets/${asset.id}/attachments`);
            if (res.ok) {
                const data = await res.json();
                setAttachments(data);
            }
        } catch (error) {
            console.error("Failed to fetch attachments", error);
        } finally {
            setLoadingFiles(false);
        }
    };

    const handleBeneficiarySelect = async (beneficiaryId: string | null) => {
        if (onAssignBeneficiary) {
            setUpdatingBeneficiary(true);
            try {
                await onAssignBeneficiary(beneficiaryId);
            } finally {
                setUpdatingBeneficiary(false);
            }
        }
    };

    const handleEditSuccess = () => {
        setIsEditing(false);
        if (onAssetUpdated) {
            onAssetUpdated();
        }
    };

    if (!asset) return null;

    const style = typeStyles[asset.asset_type] || defaultStyle;
    const iconMap: Record<string, LucideIcon> = { Mail, Mic, Camera, Video, File };
    const Icon = iconMap[asset.asset_type_details.icon] || File;

    // Render content based on asset type
    const renderContent = () => {
        if (isEditing) {
            return (
                <div className="p-1">
                    <AddAssetForm
                        assetType={asset.asset_type}
                        asset={asset}
                        onSuccess={handleEditSuccess}
                        onCancel={() => setIsEditing(false)}
                    />
                </div>
            );
        }

        const customFields = asset.custom_fields || {};

        switch (asset.asset_type) {
            case 'letter':
                return (
                    <div className="relative p-6 bg-white dark:bg-gray-900/50 rounded-xl border border-border mt-4 shadow-sm">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-rose-400/50 to-transparent opacity-50" />
                        <h4 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider">{t('messageContent') || 'Message'}</h4>
                        <div className="prose dark:prose-invert max-w-none text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                            {customFields.message_content ? String(customFields.message_content) : <span className="italic text-muted-foreground">{t('noContent') || 'No content provided.'}</span>}
                        </div>
                    </div>
                );

            case 'photo':
                return (
                    <div className="space-y-4 mt-4">
                        {customFields.photo_caption && (
                            <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
                                <h4 className="text-xs font-semibold text-muted-foreground mb-1 uppercase">{t('caption') || 'Caption'}</h4>
                                <p className="text-gray-700 dark:text-gray-300">{String(customFields.photo_caption)}</p>
                            </div>
                        )}

                        {/* Preview Gallery */}
                        {attachments.length > 0 && (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                {attachments.slice(0, 6).map((file) => (
                                    <div key={file.id} className="relative aspect-square rounded-lg overflow-hidden bg-muted border border-border group">
                                        {file.file_type.startsWith('image') ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={`/api/assets/attachments/${file.id}`}
                                                alt={file.file_name}
                                                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-muted-foreground bg-secondary/50">
                                                <File className="w-8 h-8" />
                                            </div>
                                        )}
                                    </div>
                                ))}
                                {attachments.length > 6 && (
                                    <div className="relative aspect-square rounded-lg overflow-hidden bg-muted border border-border flex items-center justify-center cursor-pointer hover:bg-muted/80 transition-colors" onClick={() => onManageFiles(asset)}>
                                        <span className="font-semibold text-muted-foreground">+{attachments.length - 6}</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );

            case 'video':
                return (
                    <div className="space-y-4 mt-4">
                        {customFields.video_caption && (
                            <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
                                <h4 className="text-xs font-semibold text-muted-foreground mb-1 uppercase">{t('caption') || 'Caption'}</h4>
                                <p className="text-gray-700 dark:text-gray-300">{String(customFields.video_caption)}</p>
                            </div>
                        )}

                        {/* Video Previews (thumbnails or first video) */}
                        {attachments.length > 0 && (
                            <div className="rounded-xl overflow-hidden border border-border bg-black/5">
                                {attachments.find(f => f.file_type.includes('video')) ? (
                                    <video
                                        src={`/api/assets/attachments/${attachments.find(f => f.file_type.includes('video'))?.id}`}
                                        className="w-full max-h-[300px] object-contain bg-black"
                                        controls
                                    />
                                ) : (
                                    <div className="p-8 text-center text-muted-foreground">
                                        <Video className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                        <p>{t('videoFile')}</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );

            case 'audio':
                return (
                    <div className="space-y-4 mt-4">
                        {/* Audio Player for first audio file */}
                        {attachments.length > 0 && attachments.some(f => f.file_type.includes('audio')) && (
                            <div className="p-4 bg-muted/50 rounded-xl border border-border flex items-center gap-4">
                                <div className={`p-3 rounded-full ${style.iconBg} ${style.iconColor}`}>
                                    <Mic className="w-5 h-5" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate mb-2">
                                        {attachments.find(f => f.file_type.includes('audio'))?.file_name}
                                    </p>
                                    <audio
                                        src={`/api/assets/attachments/${attachments.find(f => f.file_type.includes('audio'))?.id}`}
                                        controls
                                        className="w-full h-8"
                                    />
                                </div>
                            </div>
                        )}

                        {/* Fallback if no file but it's an audio asset */}
                        {attachments.length === 0 && (
                            <div className="p-8 text-center border-2 border-dashed border-muted rounded-xl bg-muted/20">
                                <Mic className="w-10 h-10 mx-auto text-muted-foreground mb-2 opacity-50" />
                                <p className="text-sm text-muted-foreground">{t('noAudioRecorded') || 'No audio recorded yet.'}</p>
                            </div>
                        )}
                    </div>
                );

            case 'document':
                return (
                    <div className="space-y-4 mt-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
                                <h4 className="text-xs font-semibold text-muted-foreground mb-1 uppercase">{t('documentType') || 'Type'}</h4>
                                <p className="text-gray-900 dark:text-gray-100 font-medium capitalize">
                                    {String(customFields.document_type || 'Document')}
                                </p>
                            </div>
                            {customFields.observations && (
                                <div className="p-4 bg-muted/30 rounded-lg border border-border/50 sm:col-span-2">
                                    <h4 className="text-xs font-semibold text-muted-foreground mb-1 uppercase">{t('observations') || 'Observations'}</h4>
                                    <p className="text-gray-700 dark:text-gray-300">{String(customFields.observations)}</p>
                                </div>
                            )}
                        </div>

                        {/* Document List */}
                        {attachments.length > 0 && (
                            <div className="border border-border rounded-xl overflow-hidden divide-y divide-border">
                                {attachments.slice(0, 3).map(file => (
                                    <div key={file.id} className="p-3 flex items-center gap-3 hover:bg-muted/50 transition-colors">
                                        <File className="w-5 h-5 text-blue-500" />
                                        <span className="text-sm truncate flex-1">{file.file_name}</span>
                                        <a
                                            href={`/api/assets/attachments/${file.id}`}
                                            download={file.file_name}
                                            className="p-1.5 text-muted-foreground hover:text-primary hover:bg-secondary rounded-md"
                                        >
                                            <Download className="w-4 h-4" />
                                        </a>
                                    </div>
                                ))}
                                {attachments.length > 3 && (
                                    <div
                                        className="p-2 text-center text-xs font-medium text-muted-foreground hover:bg-muted/50 cursor-pointer transition-colors"
                                        onClick={() => onManageFiles(asset)}
                                    >
                                        {t('viewAllFiles', { count: attachments.length })}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );

            default:
                // Generic View for unknown types
                return (
                    <div className="space-y-4 mt-4">
                        {Object.entries(customFields).map(([key, value]) => (
                            <div key={key} className="p-3 bg-muted/30 rounded-lg">
                                <span className="text-xs font-semibold text-muted-foreground uppercase block mb-1">
                                    {t(key) || key.replace(/_/g, ' ')}
                                </span>
                                <p>{String(value)}</p>
                            </div>
                        ))}
                    </div>
                );
        }
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl w-full p-0 gap-0 overflow-hidden border-0 shadow-2xl [&>button]:hidden">
                {/* Header with Type Gradient */}
                <div className={`px-6 py-6 pb-8 bg-gradient-to-br ${style.gradient} border-b ${style.borderColor}`}>
                    <div className="flex justify-between items-start">
                        <div className="flex items-center gap-4">
                            <div className={`w-14 h-14 rounded-2xl ${style.iconBg} flex items-center justify-center shadow-sm`}>
                                <Icon className={`w-7 h-7 ${style.iconColor}`} />
                            </div>
                            <div>
                                <Badge variant="secondary" className="mb-1.5 opacity-80 backdrop-blur-md bg-white/50 dark:bg-black/20 hover:bg-white/60">
                                    {t(asset.asset_type_details.name)}
                                </Badge>
                                <DialogTitle className="text-2xl font-bold tracking-tight text-foreground">
                                    {asset.asset_name}
                                </DialogTitle>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 relative z-10">
                            {!isEditing && (
                                <Button
                                    variant="secondary"
                                    size="icon"
                                    className="h-9 w-9 bg-white/40 dark:bg-black/20 hover:bg-white/60 dark:hover:bg-black/30 text-foreground transition-colors backdrop-blur-sm"
                                    onClick={() => setIsEditing(true)}
                                    title={t('edit')}
                                >
                                    <Pencil className="w-4 h-4" />
                                </Button>
                            )}
                            <DialogClose className="rounded-full p-2 hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
                                <X className="w-5 h-5 text-foreground/70" />
                            </DialogClose>
                        </div>
                    </div>

                    <h2 className="text-2xl sm:text-3xl font-bold text-foreground leading-tight tracking-tight mb-4 pr-8">
                        {/* {asset.asset_name} */}
                    </h2>

                    {/* Main Info Grid - Only show in view mode */}
                    {!isEditing && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                            <div className="flex flex-col gap-2">
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild disabled={updatingBeneficiary}>
                                        <div className="p-3.5 rounded-xl border border-border bg-card shadow-sm flex items-center gap-3 relative group cursor-pointer hover:bg-muted/50 transition-colors">
                                            <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-sm">
                                                {asset.beneficiary?.full_name?.charAt(0) || <User className="w-5 h-5 opacity-60" />}
                                            </div>
                                            <div className="flex-1 overflow-hidden">
                                                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{t('beneficiary')}</p>
                                                <p className="text-sm font-semibold truncate">
                                                    {asset.beneficiary?.full_name || <span className="text-muted-foreground italic">{t('unassigned')}</span>}
                                                </p>
                                            </div>
                                        </div>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-[200px] max-h-[300px] overflow-y-auto">
                                        <DropdownMenuLabel>{t('assignBeneficiary')}</DropdownMenuLabel>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={() => handleBeneficiarySelect(null)}>
                                            <span className="italic text-muted-foreground">{t('unassigned')}</span>
                                            {asset.beneficiary === null && <Check className="ml-auto w-4 h-4" />}
                                        </DropdownMenuItem>
                                        {beneficiaries.map((b) => (
                                            <DropdownMenuItem key={b.id} onClick={() => handleBeneficiarySelect(b.id)}>
                                                <span className="truncate">{b.full_name}</span>
                                                {asset.beneficiary?.id === b.id && <Check className="ml-auto w-4 h-4" />}
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                {updatingBeneficiary && <p className="text-xs text-center text-muted-foreground animate-pulse">{t('saving') || 'Saving...'}</p>}
                            </div>


                            {/* Validity / Status */}
                            <div className="p-3.5 rounded-xl border border-border bg-card shadow-sm flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                                    <Calendar className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{t('validUntil')}</p>
                                    <p className="text-sm font-semibold">
                                        {asset.valid_until ? new Date(asset.valid_until).toLocaleDateString() : t('forever') || 'Forever'}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Body content */}
                <div className="px-6 py-6 max-h-[60vh] overflow-y-auto">
                    {/* Type Specific Content */}
                    <div className="mb-6">
                        {renderContent()}
                    </div>

                    {/* Files Summary Section (if not already managed by type logic extensively) */}
                    <div className="flex items-center justify-between p-4 bg-muted/20 rounded-xl border border-border/60">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                                <Paperclip className="w-4 h-4" />
                            </div>
                            <div>
                                <p className="text-sm font-medium">{attachments.length} {t('filesAttached')}</p>
                                <p className="text-xs text-muted-foreground">{t('manageAssetFiles')}</p>
                            </div>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => onManageFiles(asset)}>
                            {t('manageFiles')}
                        </Button>
                    </div>
                </div>

                {/* Footer */}
                {!isEditing && (
                    <div className="p-4 sm:px-6 border-t bg-muted/5 flex justify-between items-center">
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => onDelete(asset.id)}>
                            <Trash2 className="w-4 h-4 mr-2" />
                            {t('delete')}
                        </Button>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={onClose}>{t('close')}</Button>
                            {/* Removed redundant Edit button as it is now in the header */}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

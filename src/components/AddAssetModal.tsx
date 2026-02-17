"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Mail, Mic, Camera, Video, File, LucideIcon } from "lucide-react";
import AddAssetForm from './AddAssetForm';
import type { Asset } from "@/models/asset";
import { getAvailableAssetTypes, type AssetType as DatabaseAssetType } from '@/lib/assetTypes';

// Visual style config per asset type — inspired by the Stitch design
const typeStyles: Record<string, { gradient: string; iconBg: string; iconColor: string }> = {
  letter: {
    gradient: 'from-rose-50 to-pink-50 dark:from-rose-950/30 dark:to-pink-950/30',
    iconBg: 'bg-rose-100 dark:bg-rose-900/40',
    iconColor: 'text-rose-600 dark:text-rose-400',
  },
  audio: {
    gradient: 'from-violet-50 to-purple-50 dark:from-violet-950/30 dark:to-purple-950/30',
    iconBg: 'bg-violet-100 dark:bg-violet-900/40',
    iconColor: 'text-violet-600 dark:text-violet-400',
  },
  photo: {
    gradient: 'from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30',
    iconBg: 'bg-amber-100 dark:bg-amber-900/40',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  video: {
    gradient: 'from-sky-50 to-cyan-50 dark:from-sky-950/30 dark:to-cyan-950/30',
    iconBg: 'bg-sky-100 dark:bg-sky-900/40',
    iconColor: 'text-sky-600 dark:text-sky-400',
  },
  document: {
    gradient: 'from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30',
    iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
};

const defaultStyle = {
  gradient: 'from-gray-50 to-slate-50 dark:from-gray-950/30 dark:to-slate-950/30',
  iconBg: 'bg-gray-100 dark:bg-gray-900/40',
  iconColor: 'text-gray-600 dark:text-gray-400',
};

// Fallback descriptions when translations are unavailable
const fallbackDescriptions: Record<string, string> = {
  letter: 'A letter is a written message that you can send to your beneficiaries.',
  audio: 'An audio is a recorded message that you can send to your beneficiaries.',
  photo: 'A photo is an image that you can send to your beneficiaries.',
  video: 'A video is a video that you can send to your beneficiaries.',
  document: 'A document is a document that you can send to your beneficiaries.',
};

export default function AddAssetModal({ open, onOpenChange, onAssetAdded, asset }: { open: boolean; onOpenChange: (v: boolean) => void, onAssetAdded?: () => void, asset?: Asset }) {
  const t = useTranslations();
  const [step, setStep] = useState(1);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [assetTypes, setAssetTypes] = useState<DatabaseAssetType[]>([]);
  const [assetTypesLoading, setAssetTypesLoading] = useState(true);

  useEffect(() => {
    async function fetchAssetTypes() {
      try {
        setAssetTypesLoading(true);
        const availableAssetTypes = await getAvailableAssetTypes();
        setAssetTypes(availableAssetTypes);
      } catch (error) {
        console.error('Error fetching asset types:', error);
      } finally {
        setAssetTypesLoading(false);
      }
    }

    if (open) {
      fetchAssetTypes();
    }

    if (asset) {
      setSelectedType(asset.asset_type);
      setStep(2);
    } else {
      setSelectedType(null);
      setStep(1);
    }
  }, [asset, open]);

  const handleTypeSelect = (type: string) => {
    setSelectedType(type);
    setStep(2);
  };

  const handleClose = () => {
    setStep(1);
    setSelectedType(null);
    onOpenChange(false);
  };

  const handleSuccess = () => {
    handleClose();
    if (onAssetAdded) onAssetAdded();
  };

  const handleBack = () => {
    setStep(1);
    setSelectedType(null);
  };

  // Determine description text for a type
  const getTypeDescription = (type: DatabaseAssetType): string => {
    const descKey = type.description || type.label + 'Desc';
    const translated = t(descKey);
    if (translated !== descKey) return translated;
    return fallbackDescriptions[type.key] || 'Digital asset';
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl w-full bg-card border border-border/60 shadow-2xl p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-2">
          <div className="flex items-center gap-3">
            {step === 2 && !asset && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="p-1 h-8 w-8 rounded-full hover:bg-muted flex-shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
            )}
            <div className="flex-1 text-center">
              <DialogTitle className="text-2xl font-heading font-bold text-foreground">
                {step === 1 ? t("chooseAssetType") : t("addAssetDetails")}
              </DialogTitle>
              {step === 1 && (
                <p className="text-sm text-muted-foreground mt-1">
                  {t("selectAssetTypeDesc") !== "selectAssetTypeDesc"
                    ? t("selectAssetTypeDesc")
                    : "Select the type of digital asset you want to store for your beneficiaries."}
                </p>
              )}
            </div>
          </div>
          <DialogClose asChild>
          </DialogClose>
        </DialogHeader>

        <div className="px-6 pb-6">
          {step === 1 && (
            <div className="mt-4">
              {assetTypesLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading asset types...</span>
                </div>
              ) : (
                (() => {
                  console.log('Asset types:', assetTypes);
                  const firstRow = assetTypes.slice(0, 2);
                  const secondRow = assetTypes.slice(2);

                  return (
                    <div className="space-y-3">
                      {/* First row: 2 columns */}
                      <div className="grid grid-cols-2 gap-3">
                        {firstRow.map((type) => (
                          <AssetTypeCard
                            key={type.key}
                            type={type}
                            style={typeStyles[type.key] || defaultStyle}
                            description={getTypeDescription(type)}
                            label={t(type.label)}
                            onClick={() => handleTypeSelect(type.key)}
                          />
                        ))}
                      </div>
                      {/* Second row: 3 columns */}
                      {secondRow.length > 0 && (
                        <div className="grid grid-cols-3 gap-3">
                          {secondRow.map((type) => (
                            <AssetTypeCard
                              key={type.key}
                              type={type}
                              style={typeStyles[type.key] || defaultStyle}
                              description={getTypeDescription(type)}
                              label={t(type.label)}
                              onClick={() => handleTypeSelect(type.key)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()
              )}
            </div>
          )}
          {step === 2 && selectedType && (
            <AddAssetForm
              assetType={selectedType}
              asset={asset}
              onSuccess={handleSuccess}
              onCancel={handleClose}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Extracted card component for each asset type
function AssetTypeCard({
  type,
  style,
  description,
  label,
  onClick,
}: {
  type: DatabaseAssetType;
  style: { gradient: string; iconBg: string; iconColor: string };
  description: string;
  label: string;
  onClick: () => void;
}) {
  const iconMap: Record<string, LucideIcon> = { Mail, Mic, Camera, Video, File };
  const Icon = iconMap[type.icon] || File;

  return (
    <button
      className={`
        group relative flex flex-col items-center text-center p-5 rounded-2xl
        bg-gradient-to-br ${style.gradient}
        border border-border/40
        transition-all duration-300 ease-out
        hover:scale-[1.03] hover:-translate-y-1
        hover:shadow-xl hover:border-border/80
        active:scale-[0.98]
        cursor-pointer
      `}
      onClick={onClick}
    >
      {/* Icon */}
      <div className={`
        w-14 h-14 rounded-2xl ${style.iconBg}
        flex items-center justify-center mb-3
        transition-transform duration-300
        group-hover:scale-110 group-hover:rotate-3
      `}>
        <Icon className={`w-7 h-7 ${style.iconColor}`} />
      </div>

      {/* Label */}
      <h3 className="text-sm font-bold text-foreground mb-1">
        {label}
      </h3>

      {/* Description */}
      <p className="text-[11px] leading-relaxed text-muted-foreground line-clamp-3">
        {description}
      </p>
    </button>
  );
}
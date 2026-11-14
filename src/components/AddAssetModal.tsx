"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Mail, Mic, Camera, Video, File, LucideIcon } from "lucide-react";
import AddAssetForm from './AddAssetForm';
import type { Asset } from "@/models/asset";
import { useAssetTypes, type AssetType } from '@/lib/assetTypes';

// Visual style config per asset type — inspired by the Stitch design
const typeStyles: Record<string, { surface: string; iconBg: string; iconColor: string }> = {
  letter: {
    surface: 'bg-brand-chip dark:bg-card',
    iconBg: 'bg-brand-tint dark:bg-muted',
    iconColor: 'text-brand-plum dark:text-foreground',
  },
  audio: {
    surface: 'bg-brand-tint dark:bg-card',
    iconBg: 'bg-brand-chip dark:bg-muted',
    iconColor: 'text-brand-navy dark:text-foreground',
  },
  photo: {
    surface: 'bg-warning dark:bg-card',
    iconBg: 'bg-status-pending-bg dark:bg-muted',
    iconColor: 'text-warning-foreground dark:text-foreground',
  },
  video: {
    surface: 'bg-brand-tint dark:bg-card',
    iconBg: 'bg-primary/10 dark:bg-muted',
    iconColor: 'text-primary dark:text-foreground',
  },
  document: {
    surface: 'bg-status-active-bg dark:bg-card',
    iconBg: 'bg-success/15 dark:bg-muted',
    iconColor: 'text-success dark:text-foreground',
  },
};

const defaultStyle = {
  surface: 'bg-muted dark:bg-card',
  iconBg: 'bg-muted',
  iconColor: 'text-foreground',
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
  const { data: assetTypes = [], isLoading: assetTypesLoading } = useAssetTypes({ enabled: open });

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setStep(1);
      setSelectedType(null);
    } else if (asset) {
      setSelectedType(asset.asset_type);
      setStep(2);
    }
    onOpenChange(nextOpen);
  };

  const effectiveStep = asset && open ? 2 : step;
  const effectiveSelectedType = asset && open ? asset.asset_type : selectedType;

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
  const getTypeDescription = (type: AssetType): string => {
    const descKey = type.description || type.label + 'Desc';
    const translated = t(descKey);
    if (translated !== descKey) return translated;
    return fallbackDescriptions[type.key] || 'Digital asset';
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? handleOpenChange(true) : handleClose())}>
      <DialogContent className="max-w-2xl w-full bg-card border border-border/60 shadow-2xl p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-2">
          <div className="flex items-center gap-3">
            {effectiveStep === 2 && !asset && (
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
                {effectiveStep === 1 ? t("chooseAssetType") : t("addAssetDetails")}
              </DialogTitle>
              {effectiveStep === 1 && (
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
          {effectiveStep === 1 && (
            <div className="mt-4">
              {assetTypesLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading asset types...</span>
                </div>
              ) : (
                (() => {
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
          {effectiveStep === 2 && effectiveSelectedType && (
            <AddAssetForm
              assetType={effectiveSelectedType}
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
  type: AssetType;
  style: { surface: string; iconBg: string; iconColor: string };
  description: string;
  label: string;
  onClick: () => void;
}) {
  const iconMap: Record<string, LucideIcon> = { Mail, Mic, Camera, Video, File };
  const Icon = iconMap[type.icon] || File;

  return (
    <button
      type="button"
      data-asset-type={type.key}
      data-asset-type-option="true"
      className={`
        group relative flex flex-col items-center text-center p-5 rounded-2xl
        ${style.surface}
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
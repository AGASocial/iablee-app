"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Mail, Mic, Camera, Video, File, LucideIcon } from "lucide-react";
import AddAssetForm from './AddAssetForm';
import type { Asset } from "@/models/asset";
import { getAvailableAssetTypes, type AssetType as DatabaseAssetType } from '@/lib/assetTypes';

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

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg w-full glass-panel border-white/10 dark:border-white/5">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {step === 2 && !asset && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="p-1 h-8 w-8 rounded-full hover:bg-white/10"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
            )}
            <DialogTitle className="flex-1 text-xl font-heading font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-600">
              {step === 1 ? t("chooseAssetType") : t("addAssetDetails")}
            </DialogTitle>
          </div>
          <DialogClose asChild>
          </DialogClose>
        </DialogHeader>
        {step === 1 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4">
            {assetTypesLoading ? (
              <div className="col-span-full flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <span className="ml-2 text-sm text-muted-foreground">Loading asset types...</span>
              </div>
            ) : (
              assetTypes.map((type) => {
                // Icon mapping - same as in constants/assetTypes.ts
                const iconMap: Record<string, LucideIcon> = {
                  Mail,
                  Mic,
                  Camera,
                  Video,
                  File,
                };
                const Icon = iconMap[type.icon] || File;
                const isSelected = selectedType === type.key;

                return (
                  <button
                    key={type.key}
                    className={`flex flex-col items-center justify-center p-4 rounded-xl border transition-all duration-200 group
                      ${isSelected
                        ? 'bg-primary/20 border-primary shadow-[0_0_15px_rgba(var(--primary-rgb),0.3)]'
                        : 'bg-background/40 border-white/10 hover:bg-primary/10 hover:border-primary/50 hover:scale-[1.02] hover:shadow-lg'
                      }
                    `}
                    onClick={() => handleTypeSelect(type.key)}
                  >
                    <div className={`p-3 rounded-full mb-3 transition-colors ${isSelected ? 'bg-primary text-primary-foreground' : 'bg-background/80 text-primary group-hover:bg-primary group-hover:text-primary-foreground'}`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <span className="text-sm font-medium text-foreground">{t(type.label)}</span>
                  </button>
                );
              })
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
      </DialogContent>
    </Dialog>
  );
} 
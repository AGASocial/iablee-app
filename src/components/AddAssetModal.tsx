"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import AddAssetForm from './AddAssetForm';
import type { Asset } from "@/models/asset";
import { ASSET_TYPES } from '@/constants/assetTypes';

export default function AddAssetModal({ open, onOpenChange, onAssetAdded, asset }: { open: boolean; onOpenChange: (v: boolean) => void, onAssetAdded?: () => void, asset?: Asset }) {
  const t = useTranslations();
  const [step, setStep] = useState(1);
  const [selectedType, setSelectedType] = useState<string | null>(null);

  useEffect(() => {
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
      <DialogContent className="max-w-lg w-full">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {step === 2 && !asset && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="p-1 h-auto"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
            )}
            <DialogTitle className="flex-1">
              {step === 1 ? t("chooseAssetType") : t("addAssetDetails")}
            </DialogTitle>
          </div>
          <DialogClose asChild>
          </DialogClose>
        </DialogHeader>
        {step === 1 && (
          <div className="grid grid-cols-3 gap-4 mt-4">
            {ASSET_TYPES.map((type) => {
              const Icon = type.icon;
              const isSelected = selectedType === type.key;
              return (
                <button
                  key={type.key}
                  className={`flex flex-col items-center justify-center p-4 border rounded-lg transition ${isSelected ? 'bg-blue-100 dark:bg-blue-900 border-blue-500' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                  onClick={() => handleTypeSelect(type.key)}
                >
                  <Icon className="w-10 h-10 mb-2 text-blue-500" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-900">{t(type.key)}</span>
                  {isSelected && <span className="mt-1 text-xs text-blue-600">{t('selectedType')}</span>}
                </button>
              );
            })}
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
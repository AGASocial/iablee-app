"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, Banknote, Shield, FileText, Home, BarChart, Award, LineChart, PieChart, Bitcoin, Vault, MoreHorizontal } from "lucide-react";
import AddAssetForm from './AddAssetForm';

const assetTypes = [
  { key: "bank", label: "bankAccount", icon: Banknote },
  { key: "life", label: "lifeInsurance", icon: Shield },
  { key: "insurance", label: "insurance", icon: Shield },
  { key: "retirement", label: "retirementPlan", icon: FileText },
  { key: "realestate", label: "realEstate", icon: Home },
  { key: "stocks", label: "companyStocks", icon: BarChart },
  { key: "rsus", label: "rsus", icon: Award },
  { key: "stockoptions", label: "stockOptions", icon: LineChart },
  { key: "shares", label: "companyShares", icon: PieChart },
  { key: "crypto", label: "cryptocurrency", icon: Bitcoin },
  { key: "safety", label: "safetyBox", icon: Vault },
  { key: "other", label: "other", icon: MoreHorizontal },
];

export default function AddAssetModal({ open, onOpenChange, onAssetAdded }: { open: boolean; onOpenChange: (v: boolean) => void, onAssetAdded?: () => void }) {
  const t = useTranslations();
  const [step, setStep] = useState(1);
  const [selectedType, setSelectedType] = useState<string | null>(null);

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

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg w-full">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? t("chooseAssetType") : t("addAssetDetails")}
          </DialogTitle>
          <DialogClose asChild>
          </DialogClose>
        </DialogHeader>
        {step === 1 && (
          <div className="grid grid-cols-3 gap-4 mt-4">
            {assetTypes.map((type) => {
              const Icon = type.icon;
              return (
                <button
                  key={type.key}
                  className="flex flex-col items-center justify-center p-4 border rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                  onClick={() => handleTypeSelect(type.key)}
                >
                  <Icon className="w-10 h-10 mb-2 text-blue-500" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{t(type.label)}</span>
                </button>
              );
            })}
          </div>
        )}
        {step === 2 && selectedType && (
          <AddAssetForm
            assetType={selectedType}
            onSuccess={handleSuccess}
            onCancel={handleClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
} 
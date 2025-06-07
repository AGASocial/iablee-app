"use client";

import { useTranslations } from 'next-intl';
import { Button } from "@/components/ui/button";
import AddAssetModal from '@/components/AddAssetModal';
import { useState } from 'react';

// Dummy data for demonstration
const digitalAssets = [
  {
    id: 1,
    assetName: "Cloud Storage",
    assetType: "Cloud",
    beneficiary: "Sophia Clark",
    status: "assigned"
  },
  {
    id: 2,
    assetName: "Crypto Wallet",
    assetType: "Financial",
    beneficiary: "Ethan Carter",
    status: "assigned"
  },
  {
    id: 3,
    assetName: "Email Account",
    assetType: "Email",
    beneficiary: "Olivia Bennett",
    status: "pending"
  },
  {
    id: 4,
    assetName: "Social Media",
    assetType: "Social",
    beneficiary: "Liam Harper",
    status: "unassigned"
  },
  {
    id: 5,
    assetName: "Online Banking",
    assetType: "Financial",
    beneficiary: "Ava Foster",
    status: "assigned"
  }
];

export default function DigitalAssetsPage() {
  const t = useTranslations();
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="p-8">
      <AddAssetModal open={modalOpen} onOpenChange={setModalOpen} />
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white">{t('digitalAssetsTitle')}</h1>
        <Button className="rounded-full px-6 py-2 text-base font-medium" onClick={() => setModalOpen(true)}>{t('addNewAsset')}</Button>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-gray-700">
        <table className="min-w-full divide-y divide-gray-700 bg-gray-900 dark:bg-gray-900">
          <thead>
            <tr>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">{t('assetName')}</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">{t('assetType')}</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">{t('assignedBeneficiary')}</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">{t('status')}</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">{t('actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {digitalAssets.map(asset => (
              <tr key={asset.id}>
                <td className="px-6 py-4 whitespace-nowrap text-gray-100">{asset.assetName}</td>
                <td className="px-6 py-4 whitespace-nowrap text-gray-400">{asset.assetType}</td>
                <td className="px-6 py-4 whitespace-nowrap text-gray-100">{asset.beneficiary}</td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-block rounded-full px-4 py-1 text-sm font-medium ${
                    asset.status === 'assigned' ? 'bg-gray-800 text-gray-100' :
                    asset.status === 'pending' ? 'bg-yellow-800 text-yellow-200' :
                    'bg-gray-700 text-gray-300'
                  }`}>
                    {t(asset.status)}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-gray-400">
                  <button className="mr-4 hover:underline">{t('edit')}</button>
                  <button className="hover:underline">{t('delete')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
} 
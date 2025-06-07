"use client";

import { useTranslations } from 'next-intl';
import { Button } from "@/components/ui/button";
import AddAssetModal from '@/components/AddAssetModal';
import { useState, useEffect } from 'react';
import { supabase } from "@/lib/supabase";

export default function DigitalAssetsPage() {
  const t = useTranslations();
  const [modalOpen, setModalOpen] = useState(false);
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAssets() {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setAssets([]);
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from('digital_assets')
        .select('id, asset_name, asset_type, status, beneficiary:beneficiary_id(full_name)')
        .eq('user_id', user.id);
      if (error) {
        setAssets([]);
      } else {
        setAssets(data || []);
      }
      setLoading(false);
    }
    fetchAssets();
  }, []);

  return (
    <div className="p-8">
      <AddAssetModal open={modalOpen} onOpenChange={setModalOpen} />
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white">{t('digitalAssetsTitle')}</h1>
        <Button className="rounded-full px-6 py-2 text-base font-medium" onClick={() => setModalOpen(true)}>{t('addNewAsset')}</Button>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-gray-700">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">{t('loading') || 'Loading...'}</div>
        ) : (
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
              {assets.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-gray-400">
                    {t('noAssetsFound')}
                      <Button className="mt-2 ml-2 bg-gray-800 text-gray-100" onClick={() => setModalOpen(true)}>{t('addAsset')}</Button>
                  </td>
                </tr>
              ) : (
                assets.map(asset => (
                  <tr key={asset.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-100">{asset.asset_name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-400">{asset.asset_type}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-100">{asset.beneficiary?.full_name || '-'}</td>
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
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
} 
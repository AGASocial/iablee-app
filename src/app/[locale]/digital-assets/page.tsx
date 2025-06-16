"use client";

import { useTranslations } from 'next-intl';
import { Button } from "@/components/ui/button";
import AddAssetModal from '@/components/AddAssetModal';
import { useState, useEffect } from 'react';
import { supabase } from "@/lib/supabase";
import { Pencil, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';

export default function DigitalAssetsPage() {
  const t = useTranslations();
  const [modalOpen, setModalOpen] = useState(false);
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editAsset, setEditAsset] = useState<any | null>(null);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<any | null>(null);
  const [beneficiaries, setBeneficiaries] = useState<any[]>([]);
  const [selectedBeneficiaryId, setSelectedBeneficiaryId] = useState<string | null>(null);

  const fetchAssets = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('digital_assets')
      .select('id, asset_name, asset_type, status, email, password, website, valid_until, description, files, beneficiary_id, beneficiary:beneficiary_id(id, full_name)')
      .eq('user_id', user?.id)
      .order('asset_name', { ascending: true });
    setAssets(data || []);
    setLoading(false);
  };

  const fetchBeneficiaries = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('beneficiaries')
      .select('id, full_name, email')
      .eq('user_id', user?.id)
      .order('full_name', { ascending: true });
    setBeneficiaries(data || []);
  };

  useEffect(() => {
    fetchAssets();
  }, []);

  async function handleDeleteAsset(id: string) {
    if (!confirm(t('deleteConfirmDigitalAsset'))) return;
    setLoading(true);
    try {
      await supabase.from('digital_assets').delete().eq('id', id);
      fetchAssets();
    } catch (e) {
      alert('Error deleting asset');
    } finally {
      setLoading(false);
    }
  }

  function handleEditAsset(asset: any) {
    setEditAsset(asset);
    setModalOpen(true);
  }

  async function handleSaveAsset(updatedAsset: any) {
    setLoading(true);
    try {
      if (editAsset) {
        // Update
        const { error } = await supabase.from('digital_assets').update({
          asset_name: updatedAsset.asset_name,
          asset_type: updatedAsset.asset_type,
          status: updatedAsset.status,
          beneficiary_id: updatedAsset.beneficiary_id,
          email: updatedAsset.email,
          password: updatedAsset.password,
          website: updatedAsset.website,
          valid_until: updatedAsset.valid_until ? updatedAsset.valid_until : null,
          description: updatedAsset.description,
          files: updatedAsset.files,
        }).eq('id', editAsset.id);
        if (error) throw error;
      } else {
        // Insert (if you want to support add from here)
      }
      setModalOpen(false);
      setEditAsset(null);
      // Refetch data after update
      const { data: refreshed } = await supabase
        .from('digital_assets')
        .select('id, asset_name, asset_type, status, email, password, website, valid_until, description, files, beneficiary:beneficiary_id(id,full_name)')
        .eq('user_id', assets[0]?.user_id);
      setAssets(refreshed || []);
    } catch (e) {
      alert('Error saving asset');
    } finally {
      setLoading(false);
    }
  }

  const openAssignModal = (asset: any) => {
    console.log('DEBUG: asset', asset);
    setSelectedAsset(asset);
    setSelectedBeneficiaryId(asset.beneficiary?.id || null);
    setAssignModalOpen(true);
    fetchBeneficiaries();
  };

  const handleAssignBeneficiary = async () => {
    if (!selectedAsset || !selectedBeneficiaryId) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('digital_assets').update({
        beneficiary_id: selectedBeneficiaryId,
        status: 'assigned',
      }).eq('id', selectedAsset.id);
      if (error) throw error;
      setAssignModalOpen(false);
      setSelectedAsset(null);
      setSelectedBeneficiaryId(null);
      fetchAssets();
    } catch (e) {
      alert('Error assigning beneficiary');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      <AddAssetModal
        key={editAsset ? editAsset.id : 'new'}
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) setEditAsset(null);
        }}
        asset={editAsset}
        onAssetAdded={fetchAssets}
      />
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
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">{t('assetType')}</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">{t('assetName')}</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">{t('assignedBeneficiary')}</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">{t('status')}</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">{t('validUntil')}</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">{t('numberOfFiles')}</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">{t('actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {assets.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-400">
                    {t('noAssetsFound')}
                    <Button className="mt-2 ml-2 bg-gray-800 text-gray-100" onClick={() => setModalOpen(true)}>{t('addAsset')}</Button>
                  </td>
                </tr>
              ) : (
                assets.map(asset => (
                  <tr key={asset.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-400">{asset.asset_type}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-100">{asset.asset_name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-100 rounded-full cursor-pointer" onClick={() => openAssignModal(asset)}>{asset.beneficiary?.full_name || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span onClick={() => openAssignModal(asset)}
                        className={`inline-block rounded-full px-4 py-1 text-sm font-medium cursor-pointer ${asset.status === 'assigned' ? 'bg-gray-800 text-gray-100' :
                            asset.status === 'pending' ? 'bg-yellow-800 text-yellow-200' :
                              'bg-gray-700 text-gray-300'
                          }`}

                        title={t('assignBeneficiary')}
                      >
                        {t(asset.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-100">{asset.valid_until ? new Date(asset.valid_until).toLocaleDateString() : '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-100">{asset.number_of_files ?? (Array.isArray(asset.files) ? asset.files.length : (asset.files ? 1 : 0))}</td>
                    <td className="px-6 py-4 whitespace-nowrap flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex items-center gap-1"
                        onClick={() => handleEditAsset(asset)}
                      >
                        <Pencil className="w-4 h-4" />
                        {t('edit')}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="flex items-center gap-1"
                        onClick={() => handleDeleteAsset(asset.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                        {t('delete')}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
      <Dialog open={assignModalOpen} onOpenChange={(open) => { setAssignModalOpen(open); if (!open) { setSelectedAsset(null); setSelectedBeneficiaryId(null); } }}>
        <DialogContent className="max-w-lg w-full bg-white border border-gray-200 dark:bg-gray-900 dark:border-gray-700">
          <DialogHeader>
            <DialogTitle className="text-gray-900 dark:text-white">{t('assignBeneficiary')}</DialogTitle>
            <DialogClose asChild />
          </DialogHeader>
          <div className="mt-4 space-y-2">
            {beneficiaries.length === 0 ? (
              <div className="text-gray-400 dark:text-gray-400">{t('noBeneficiaries')}</div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {beneficiaries.map(b => (
                  <button
                    key={b.id}
                    className={`flex flex-row items-center justify-between p-4 border rounded-lg transition text-left w-full 
                      ${selectedBeneficiaryId === b.id
                        ? 'bg-blue-100 border-blue-500 text-gray-900 dark:bg-blue-900 dark:text-white dark:border-blue-400'
                        : 'bg-gray-50 border-gray-200 text-gray-900 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700 dark:hover:bg-gray-700'}
                    `}
                    onClick={() => setSelectedBeneficiaryId(b.id)}
                  >
                    <div>
                      <span className="font-medium text-gray-900 dark:text-white">{b.full_name}</span>
                      <span className="block text-sm text-gray-500 dark:text-gray-300">{b.email}</span>
                    </div>
                    {selectedBeneficiaryId === b.id && <span className="ml-4 text-xs text-blue-600 dark:text-blue-300">{t('selected')}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="outline" onClick={() => setAssignModalOpen(false)}>{t('cancel')}</Button>
            <Button onClick={handleAssignBeneficiary} disabled={!selectedBeneficiaryId || loading}>
              {loading ? t('saving') : t('save')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
} 
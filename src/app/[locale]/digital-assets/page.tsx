"use client";

import { useTranslations } from 'next-intl';
import { Button } from "@/components/ui/button";
import AddAssetModal from '@/components/AddAssetModal';
import { useState, useEffect } from 'react';
import { supabase } from "@/lib/supabase";
import { Pencil, Trash2, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import type { Asset, Beneficiary } from '@/models/asset';
import { ProtectedRoute } from '@/components/ProtectedRoute';

export default function DigitalAssetsPage() {
  const t = useTranslations();
  const [modalOpen, setModalOpen] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [editAsset, setEditAsset] = useState<Asset | null>(null);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [selectedBeneficiaryId, setSelectedBeneficiaryId] = useState<string | null>(null);
  const [selectedAssetDetails, setSelectedAssetDetails] = useState<Asset | null>(null);

  const fetchAssets = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase
      .from('digital_assets')
      .select('id, asset_name, asset_type, status, email, password, website, valid_until, description, files, beneficiary_id, beneficiary:beneficiary_id(id, full_name)')
      .eq('user_id', user?.id)
      .order('asset_name', { ascending: true });
    setAssets(((data || []).map((asset: unknown) => {
      const typedAsset = asset as Asset;
      return {
        ...typedAsset,
        beneficiary: Array.isArray(typedAsset.beneficiary) ? typedAsset.beneficiary[0] || null : typedAsset.beneficiary || null,
      };
    }) as Asset[]));
    setLoading(false);
  };

  const fetchBeneficiaries = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase
      .from('beneficiaries')
      .select('id, full_name, email')
      .eq('user_id', user?.id)
      .order('full_name', { ascending: true });
    setBeneficiaries((data || []) as Beneficiary[]);
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
    } catch {
      alert('Error deleting asset');
    } finally {
      setLoading(false);
    }
  }

  function handleEditAsset(asset: Asset) {
    setEditAsset(asset);
    setModalOpen(true);
  }

  const openAssignModal = (asset: Asset) => {
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
    } catch {
      alert('Error assigning beneficiary');
    } finally {
      setLoading(false);
    }
  };

  // Helper for status badge (copied from dashboard)
  function StatusBadge({ status }: { status: string }) {
    const statusStyles: Record<string, string> = {
      active: "bg-green-100 text-green-800",
      pending: "bg-yellow-100 text-yellow-800",
      inactive: "bg-red-100 text-red-800",
    };
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusStyles[status.toLowerCase()] || "bg-gray-100 text-gray-800"}`}>
        {status}
      </span>
    );
  }

  return (
    <ProtectedRoute>
      <div className="p-4 sm:p-8">
        <AddAssetModal
          key={editAsset ? editAsset.id : 'new'}
          open={modalOpen}
          onOpenChange={(open) => {
            setModalOpen(open);
            if (!open) setEditAsset(null);
          }}
          asset={editAsset || undefined}
          onAssetAdded={fetchAssets}
        />
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white">{t('digitalAssetsTitle')}</h1>
          <Button className="hidden sm:inline-flex rounded-full px-6 py-2 text-base font-medium" onClick={() => setModalOpen(true)}>{t('addNewAsset')}</Button>
        </div>
        <Button
          className="sm:hidden w-full mb-4 flex items-center justify-center gap-2"
          onClick={() => setModalOpen(true)}
          aria-label={t('addNewAsset')}
        >
          <Plus className="w-5 h-5" />
        </Button>
        <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-700">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">{t('loading') || 'Loading...'}</div>
          ) : (
            <div className="w-full min-w-[200px] sm:min-w-[600px]">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-900">
                <thead>
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900 dark:text-white hidden sm:table-cell">{t('assetType')}</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900 dark:text-white">{t('assetName')}</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900 dark:text-white hidden sm:table-cell">{t('assignedBeneficiary')}</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900 dark:text-white hidden sm:table-cell">{t('status')}</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900 dark:text-white hidden sm:table-cell">{t('validUntil')}</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900 dark:text-white hidden sm:table-cell">{t('numberOfFiles')}</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900 dark:text-white hidden sm:table-cell">{t('actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {assets.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-muted-foreground">
                        {t('noAssetsFound')}
                        <Button className="mt-2 ml-2 bg-gray-800 text-gray-100" onClick={() => setModalOpen(true)}>{t('addAsset')}</Button>
                      </td>
                    </tr>
                  ) : (
                    assets.map(asset => (
                      <tr key={asset.id} className="bg-white dark:bg-gray-900">
                        <td className="px-6 py-4 whitespace-nowrap text-muted-foreground hidden sm:table-cell">{asset.asset_type}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-900 dark:text-white cursor-pointer" onClick={() => window.innerWidth < 640 ? setSelectedAssetDetails(asset) : undefined}>{asset.asset_name}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-900 dark:text-white rounded-full cursor-pointer hidden sm:table-cell" onClick={() => openAssignModal(asset)}>{asset.beneficiary?.full_name || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                          <span onClick={() => openAssignModal(asset)} title={t('assignBeneficiary')}>
                            <StatusBadge status={asset.status} />
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-900 dark:text-white hidden sm:table-cell">{asset.valid_until ? new Date(asset.valid_until).toISOString().slice(0, 10) : '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-900 dark:text-white hidden sm:table-cell">{asset.number_of_files ?? (Array.isArray(asset.files) ? asset.files.length : (asset.files ? 1 : 0))}</td>
                        <td className="px-6 py-4 whitespace-nowrap flex gap-2 hidden sm:flex">
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
            </div>
          )}
        </div>
        {/* Mobile details modal */}
        {selectedAssetDetails && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-2 sm:hidden">
            <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg p-6 w-full max-w-sm border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">{selectedAssetDetails.asset_name}</h3>
              <div className="space-y-2">
                <div><span className="font-semibold">{t('assetType')}:</span> {selectedAssetDetails.asset_type}</div>
                <div><span className="font-semibold">{t('assignedBeneficiary')}:</span> {selectedAssetDetails.beneficiary?.full_name || '-'}</div>
                <div><span className="font-semibold">{t('status')}:</span> <StatusBadge status={selectedAssetDetails.status} /></div>
                <div><span className="font-semibold">{t('validUntil')}:</span> {selectedAssetDetails.valid_until ? new Date(selectedAssetDetails.valid_until).toISOString().slice(0, 10) : '-'}</div>
                <div><span className="font-semibold">{t('numberOfFiles')}:</span> {selectedAssetDetails.number_of_files ?? (Array.isArray(selectedAssetDetails.files) ? selectedAssetDetails.files.length : (selectedAssetDetails.files ? 1 : 0))}</div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <Button variant="outline" onClick={() => { setSelectedAssetDetails(null); handleEditAsset(selectedAssetDetails); }}>{t('edit')}</Button>
                <Button variant="destructive" onClick={() => { handleDeleteAsset(selectedAssetDetails.id); setSelectedAssetDetails(null); }}>{t('delete')}</Button>
                <Button onClick={() => setSelectedAssetDetails(null)}>{t('cancel')}</Button>
              </div>
            </div>
          </div>
        )}
        <Dialog open={assignModalOpen} onOpenChange={(open) => { setAssignModalOpen(open); if (!open) { setSelectedAsset(null); setSelectedBeneficiaryId(null); } }}>
          <DialogContent className="max-w-lg w-full bg-white border border-gray-200 dark:bg-gray-900 dark:border-gray-700 p-4 sm:p-8">
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
    </ProtectedRoute>
  );
} 
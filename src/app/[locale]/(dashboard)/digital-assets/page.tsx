"use client";

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import AddAssetModal from '@/components/AddAssetModal';
import AssetAttachmentsModal from '@/components/AssetAttachmentsModal';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from "@/lib/supabase";
import { Pencil, Trash2, Plus, Paperclip, LucideIcon, Mail, Mic, Camera, Video, File } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import type { Asset } from '@/models/asset';
import { Beneficiary } from '@/models/beneficiary';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { toast } from 'sonner';

export default function DigitalAssetsPage() {
  const t = useTranslations();
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [editAsset, setEditAsset] = useState<Asset | null>(null);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [selectedBeneficiaryId, setSelectedBeneficiaryId] = useState<string | null>(null);
  const [selectedAssetDetails, setSelectedAssetDetails] = useState<Asset | null>(null);
  const [attachmentsModalOpen, setAttachmentsModalOpen] = useState(false);
  const [selectedAssetForAttachments, setSelectedAssetForAttachments] = useState<Asset | null>(null);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/assets');
      if (!response.ok) throw new Error('Failed to fetch assets');

      const data = await response.json();
      console.log('DEBUG: data', data);

      setAssets(((data || []).map((asset: unknown) => {
        const typedAsset = asset as Asset;
        return {
          ...typedAsset,
          beneficiary: Array.isArray(typedAsset.beneficiary) ? typedAsset.beneficiary[0] || null : typedAsset.beneficiary || null,
        };
      }) as Asset[]));
    } catch (error) {
      console.error('Error fetching assets:', error);
      toast.error(t('errorFetchingAssets') || 'Error fetching assets');
    } finally {
      setLoading(false);
    }
  }, [t]);

  const fetchBeneficiaries = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase
      .from('beneficiaries')
      .select('id, full_name, email')
      .eq('user_id', user?.id)
      .order('full_name', { ascending: true });
    setBeneficiaries((data || []) as Beneficiary[]);
  };

  const handleAddAsset = async () => {
    try {
      // Check if user can create an asset
      const response = await fetch('/api/subscription/check-limit?type=asset');
      const result = await response.json();

      if (!result.allowed) {
        // Show limit reached message with upgrade option
        toast.error(t('assetLimitReached'), {
          description: t('assetLimitReachedDescription', { limit: result.limit }),
          action: {
            label: t('viewPlans'),
            onClick: () => router.push('/billing/plans'),
          },
          duration: 5000,
        });
        return;
      }

      // Open the modal if allowed
      setModalOpen(true);
    } catch (error) {
      console.error('Error checking asset limit:', error);
      // On error, allow creation (fail open)
      setModalOpen(true);
    }
  };

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

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
    setSelectedAsset(asset);
    setSelectedBeneficiaryId(asset.beneficiary?.id || null);
    setAssignModalOpen(true);
    fetchBeneficiaries();
  };

  const handleAssignBeneficiary = async (beneficiaryId: string | null = selectedBeneficiaryId) => {
    console.log('DEBUG: handleAssignBeneficiary', selectedBeneficiaryId, selectedAsset);
    if (!selectedAsset) return;
    setLoading(true);
    try {
      console.log('DEBUG: selectedBeneficiaryId', selectedBeneficiaryId);

      // Determine if we're assigning or removing a beneficiary
      const isRemoving = beneficiaryId === null;
      const updateData = {
        beneficiary_id: beneficiaryId,
        status: isRemoving ? 'unassigned' : 'assigned',
      };
      console.log('DEBUG: updateData', updateData);
      const { error } = await supabase.from('digital_assets').update(updateData).eq('id', selectedAsset.id);
      console.log('DEBUG: error', error);
      if (error) throw error;

      setAssignModalOpen(false);
      setSelectedAsset(null);
      setSelectedBeneficiaryId(null);
      fetchAssets();
    } catch {
      alert('Error updating beneficiary assignment');
    } finally {
      setLoading(false);
    }
  };

  const openAttachmentsModal = (asset: Asset) => {
    setSelectedAssetForAttachments(asset);
    setAttachmentsModalOpen(true);
  };

  const getFileCount = (asset: Asset): number => {
    return asset.number_of_files ?? (Array.isArray(asset.files) ? asset.files.length : (asset.files ? 1 : 0));
  };


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
        {selectedAssetForAttachments && (
          <AssetAttachmentsModal
            open={attachmentsModalOpen}
            onOpenChange={(open) => {
              setAttachmentsModalOpen(open);
              if (!open) setSelectedAssetForAttachments(null);
            }}
            asset={selectedAssetForAttachments}
            onFilesUpdated={fetchAssets}
          />
        )}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white">{t('digitalAssetsTitle')}</h1>
          <Button className="hidden sm:inline-flex rounded-full px-6 py-2 text-base font-medium bg-gray-800 text-gray-100" onClick={handleAddAsset}>{t('addNewAsset')}</Button>
        </div>
        <Button
          className="sm:hidden w-full mb-4 flex items-center justify-center gap-2"
          onClick={handleAddAsset}
          aria-label={t('addNewAsset')}
        >
          <Plus className="w-5 h-5" />
        </Button>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-fade-in-up delay-100">
          {loading ? (
            <div className="col-span-full flex items-center justify-center py-20 text-muted-foreground">
              <div className="flex flex-col items-center gap-4">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                <p>{t('loading') || 'Loading...'}</p>
              </div>
            </div>
          ) : assets.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center py-20 text-center glass-panel rounded-2xl border-dashed border-2 border-muted">
              <div className="h-20 w-20 rounded-full bg-muted/30 flex items-center justify-center mb-6">
                <File className="h-10 w-10 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold mb-2">{t('noAssetsFound')}</h3>
              <p className="text-muted-foreground mb-6 max-w-sm">{t('startByAddingAsset')}</p>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/25" onClick={handleAddAsset}>
                <Plus className="mr-2 h-4 w-4" /> {t('addAsset')}
              </Button>
            </div>
          ) : (
            assets.map((asset, index) => {
              const iconMap: Record<string, LucideIcon> = {
                Mail,
                Mic,
                Camera,
                Video,
                File,
              };
              const Icon = iconMap[asset.asset_type_details.icon] || File;
              // Stagger animation
              const delayClass = index < 5 ? `delay-${(index + 1) * 100}` : '';

              return (
                <div
                  key={asset.id}
                  className={`group relative glass-card p-5 rounded-2xl transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1 hover:shadow-xl hover:border-primary/20 flex flex-col justify-between h-full animate-fade-in-up ${delayClass}`}
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="p-3 rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white transition-colors duration-300 shadow-inner">
                      <Icon className="w-6 h-6" />
                    </div>
                    {/* Status Pill - could be dynamic based on status if that field exists reliably */}
                    {/* <div className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-green-500/10 text-green-500 border border-green-500/20">
                      Active
                    </div> */}
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 absolute top-4 right-4 bg-background/80 backdrop-blur-sm rounded-lg p-1 shadow-sm border border-border/50">
                      <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-blue-500" onClick={() => handleEditAsset(asset)} title={t('edit')}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-red-500" onClick={() => handleDeleteAsset(asset.id)} title={t('delete')}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className="mb-4">
                    <h3 className="font-bold text-lg mb-1 line-clamp-1 group-hover:text-primary transition-colors cursor-pointer" onClick={() => handleEditAsset(asset)}>
                      {asset.asset_name}
                    </h3>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-3">
                      {t(asset.asset_type_details.name)}
                    </p>

                    <div className="space-y-2">
                      <div
                        className="flex items-center gap-2 text-sm p-2 rounded-lg bg-muted/30 hover:bg-muted/60 transition-colors cursor-pointer"
                        onClick={() => openAssignModal(asset)}
                      >
                        <div className="h-6 w-6 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-[10px] font-bold text-indigo-600 dark:text-indigo-300">
                          {asset.beneficiary?.full_name?.charAt(0) || '?'}
                        </div>
                        <span className={`text-xs font-medium truncate ${!asset.beneficiary ? 'text-muted-foreground italic' : ''}`}>
                          {asset.beneficiary?.full_name || t('assignBeneficiary')}
                        </span>
                      </div>

                      {asset.valid_until && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground px-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                          {t('validUntil')}: {new Date(asset.valid_until).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Card Footer */}
                  <div className="mt-auto pt-3 border-t border-border/50 flex items-center justify-between">
                    <button
                      onClick={() => openAttachmentsModal(asset)}
                      className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition-colors group/files"
                    >
                      <Paperclip className="w-3.5 h-3.5 group-hover/files:scale-110 transition-transform" />
                      {getFileCount(asset)} {t('files')}
                    </button>

                    {/* Mobile-friendly action trigger for small screens if needed, otherwise rely on the hover/tap */}
                  </div>
                </div>
              );
            })
          )}
        </div>
        {/* Mobile details modal */}
        {selectedAssetDetails && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-2 sm:hidden">
            <div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg shadow-lg p-6 w-full max-w-sm border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">{selectedAssetDetails.asset_name}</h3>
              <div className="space-y-2">
                <div><span className="font-semibold dark:text-white">{t('assetType')}:</span> {t(selectedAssetDetails.asset_type)}</div>
                <div><span className="font-semibold dark:text-white">{t('assignedBeneficiary')}:</span> {selectedAssetDetails.beneficiary?.full_name || '-'}</div>
                {/* <div><span className="font-semibold dark:text-white">{t('status')}:</span> <StatusBadge status={selectedAssetDetails.status} /></div> */}
                <div><span className="font-semibold dark:text-white">{t('validUntil')}:</span> {selectedAssetDetails.valid_until ? new Date(selectedAssetDetails.valid_until).toISOString().slice(0, 10) : '-'}</div>
                <div>
                  <span className="font-semibold">{t('numberOfFiles')}:</span>
                  <button
                    onClick={() => {
                      setSelectedAssetDetails(null);
                      openAttachmentsModal(selectedAssetDetails);
                    }}
                    className="ml-2 flex items-center gap-1 text-blue-600 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
                  >
                    <Paperclip className="w-3 h-3" />
                    {getFileCount(selectedAssetDetails)}
                  </button>
                </div>
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
              <Button variant="destructive" onClick={() => handleAssignBeneficiary(null)} disabled={selectedBeneficiaryId === null || loading}>
                {loading ? t('saving') : t('removeBeneficiary')}
              </Button>
              <Button variant="outline" onClick={() => setAssignModalOpen(false)}>{t('cancel')}</Button>
              <Button onClick={() => handleAssignBeneficiary(selectedBeneficiaryId)} disabled={!selectedBeneficiaryId || loading}>
                {loading ? t('saving') : t('assignBeneficiary')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </ProtectedRoute>
  );
} 
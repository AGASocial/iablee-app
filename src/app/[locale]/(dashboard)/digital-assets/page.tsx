"use client";

import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from "@/components/ui/button";
import AddAssetModal from '@/components/AddAssetModal';
import AssetDetailsModal from '@/components/AssetDetailsModal';
import AssetAttachmentsModal from '@/components/AssetAttachmentsModal';
import { FilterBar } from '@/components/FilterBar';
import { useState, useEffect, useCallback } from 'react';

import { Trash2, Plus, Paperclip, LucideIcon, Mail, Mic, Camera, Video, File } from "lucide-react";
import DeleteConfirmationModal from '@/components/DeleteConfirmationModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose, DialogFooter } from '@/components/ui/dialog';
import type { Asset } from '@/models/asset';
import { Beneficiary } from '@/models/beneficiary';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { toast } from 'sonner';

import { useSecurity } from '@/context/SecurityContext';

export default function DigitalAssetsPage() {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locked, loading: securityLoading } = useSecurity(); // Get security state
  const [modalOpen, setModalOpen] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [selectedBeneficiaryId, setSelectedBeneficiaryId] = useState<string | null>(null);
  const [selectedAssetDetails, setSelectedAssetDetails] = useState<Asset | null>(null);
  const [attachmentsModalOpen, setAttachmentsModalOpen] = useState(false);
  const [selectedAssetForAttachments, setSelectedAssetForAttachments] = useState<Asset | null>(null);
  const [limitReached, setLimitReached] = useState(true);
  const [limitInfo, setLimitInfo] = useState<{ limit?: number; current?: number } | null>(null);

  // Filtering State
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});

  // Derived filtered assets
  const filteredAssets = assets.filter(asset => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesName = asset.asset_name.toLowerCase().includes(query);
      const matchesDescription = asset.description?.toLowerCase().includes(query);
      if (!matchesName && !matchesDescription) return false;
    }

    // Type filter
    if (activeFilters.type && activeFilters.type !== 'all') {
      if (asset.asset_type_details.name !== activeFilters.type) return false;
    }

    // Beneficiary filter
    if (activeFilters.beneficiary && activeFilters.beneficiary !== 'all') {
      const hasBeneficiary = !!asset.beneficiary;
      if (activeFilters.beneficiary === 'assigned' && !hasBeneficiary) return false;
      if (activeFilters.beneficiary === 'unassigned' && hasBeneficiary) return false;
    }

    // Attachments filter
    if (activeFilters.attachments && activeFilters.attachments !== 'all') {
      const hasAttachments = (asset.number_of_files || 0) > 0 || (asset.files && asset.files.length > 0);
      if (activeFilters.attachments === 'yes' && !hasAttachments) return false;
      if (activeFilters.attachments === 'no' && hasAttachments) return false;
    }

    return true;
  });

  // Extract unique asset types for filter options
  const assetTypeOptions = Array.from(new Set(assets.map(a => a.asset_type_details.name)))
    .map(type => ({ label: t(type), value: type }));

  const filterConfigs = [
    {
      key: 'type',
      label: t('assetType') || 'Asset Type',
      options: assetTypeOptions,
    },
    {
      key: 'beneficiary',
      label: t('beneficiaryStatus') || 'Beneficiary Status',
      options: [
        { label: t('assigned') || 'Assigned', value: 'assigned' },
        { label: t('unassigned') || 'Unassigned', value: 'unassigned' },
      ],
    },
    {
      key: 'attachments',
      label: t('attachments') || 'Attachments',
      options: [
        { label: t('yes') || 'Yes', value: 'yes' },
        { label: t('no') || 'No', value: 'no' },
      ],
    },
  ];

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/assets');
      if (!response.ok) throw new Error('Failed to fetch assets');

      const data = await response.json();

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

  const fetchBeneficiaries = useCallback(async () => {
    try {
      const res = await fetch('/api/beneficiaries');
      if (res.ok) {
        const data = await res.json();
        setBeneficiaries((data || []) as Beneficiary[]);
      }
    } catch (error) {
      console.error('Error fetching beneficiaries:', error);
    }
  }, []);

  const fetchLimitStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/subscription/check-limit?type=asset');
      if (res.ok) {
        const result = await res.json();
        setLimitReached(!result.allowed);
        if (!result.allowed) {
          setLimitInfo({ limit: result.limit, current: result.current });
        } else {
          setLimitInfo(null);
        }
      }
    } catch (error) {
      console.error('Error checking asset limit:', error);
    }
  }, []);

  const handleAddAsset = () => {
    setModalOpen(true);
  };

  useEffect(() => {
    // Only fetch if unlocked AND security check is done to avoid errors
    if (!locked && !securityLoading) {
      fetchAssets();
      fetchLimitStatus();
      fetchBeneficiaries();
    }
  }, [fetchAssets, fetchLimitStatus, fetchBeneficiaries, locked, securityLoading]);

  // Auto-open modal when ?action=add is present in the URL
  useEffect(() => {
    const action = searchParams.get('action');
    if (action === 'add') {
      setModalOpen(true);
      const params = new URLSearchParams(searchParams);
      params.delete('action');
      router.replace(`${window.location.pathname}?${params.toString()}`, { scroll: false });
    }
  }, [searchParams, router]);

  useEffect(() => {
    const assetId = searchParams.get('assetId');
    // ... existing existing existing
    if (assetId && assets.length > 0 && !selectedAssetDetails) {
      const assetToOpen = assets.find(a => a.id === assetId);
      if (assetToOpen) {
        setSelectedAssetDetails(assetToOpen);
      }
    }
  }, [searchParams, assets, selectedAssetDetails]);

  // Sync selectedAssetDetails with assets list when it changes (e.g. after edit)
  useEffect(() => {
    if (selectedAssetDetails) {
      const updatedAsset = assets.find(a => a.id === selectedAssetDetails.id);
      if (updatedAsset && JSON.stringify(updatedAsset) !== JSON.stringify(selectedAssetDetails)) {
        setSelectedAssetDetails(updatedAsset);
      }
    }
  }, [assets, selectedAssetDetails]);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [assetToDelete, setAssetToDelete] = useState<string | null>(null);

  function handleDeleteAsset(id: string) {
    setAssetToDelete(id);
    setDeleteModalOpen(true);
  }

  async function confirmDeleteAsset() {
    if (!assetToDelete) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/assets/${assetToDelete}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      fetchAssets();
      fetchLimitStatus();
      setDeleteModalOpen(false);
      setAssetToDelete(null);
    } catch {
      // Use toast instead of alert for consistency if available, but keeping alert based on previous code or transitioning
      // The previous code used alert('Error deleting asset'). Let's use toast if available or stick to alert. 
      // The file imports 'toast' from 'sonner'.
      toast.error(t('errorDeletingAsset') || 'Error deleting asset');
    } finally {
      setLoading(false);
    }
  }


  const openAssignModal = (asset: Asset) => {
    setSelectedAsset(asset);
    setSelectedBeneficiaryId(asset.beneficiary?.id || null);
    setAssignModalOpen(true);
    fetchBeneficiaries();
  };

  const handleAssignBeneficiary = async (beneficiaryId: string | null = selectedBeneficiaryId) => {
    const targetAsset = selectedAsset || selectedAssetDetails;
    if (!targetAsset) return;

    setLoading(true);
    try {
      // Determine if we're assigning or removing a beneficiary
      const isRemoving = beneficiaryId === null;
      const updateData = {
        beneficiary_id: beneficiaryId,
        status: isRemoving ? 'unassigned' : 'assigned',
      };
      const res = await fetch(`/api/assets/${targetAsset.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });
      if (!res.ok) throw new Error('Failed to update');

      setAssignModalOpen(false);
      setSelectedAsset(null);
      setSelectedBeneficiaryId(null);

      await fetchAssets();

      // Update the selectedAssetDetails if it's open so the UI updates immediately
      if (selectedAssetDetails && selectedAssetDetails.id === targetAsset.id) {
        // Re-fetch or update locally. Since fetchAssets updates 'assets', we need to find the updated asset
        // and update selectedAssetDetails. 
        // Helper function to get the updated asset from the list would be best, but we can't easily access the verify fresh state here immediately after fetchAssets without a ref or waiting. 
        // Actually, fetchAssets awaits the update. So 'assets' state won't be updated in this closure yet.
        // Let's manually verify by fetching the single asset or just manually updating the local state object.
        // Manually updating is faster for UI responsiveness.

        // We need the beneficiary object to display it. Since we only have ID, we can find it in 'beneficiaries'.
        const newBeneficiary = beneficiaries.find(b => b.id === beneficiaryId) || undefined;

        setSelectedAssetDetails(prev => prev ? ({ ...prev, beneficiary: newBeneficiary, beneficiary_id: beneficiaryId || undefined }) : null);
      }

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
          key="new"
          open={modalOpen}
          onOpenChange={setModalOpen}
          onAssetAdded={() => { fetchAssets(); fetchLimitStatus(); }}
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
          <div>
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white">{t('digitalAssetsTitle')}</h1>
            {limitReached && limitInfo && (
              <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                {t('assetLimitReachedDescription', { limit: limitInfo.limit ?? 0 })} —{' '}
                <button className="underline font-medium hover:text-amber-700" onClick={() => router.push('/billing/plans')}>
                  {t('viewPlans')}
                </button>
              </p>
            )}
          </div>
          <Button className="hidden sm:inline-flex rounded-full px-6 py-2 text-base font-medium bg-gray-800 text-gray-100" onClick={handleAddAsset} disabled={limitReached}>{t('addNewAsset')}</Button>
        </div>


        <FilterBar
          onSearch={setSearchQuery}
          onFilterChange={(key, value) => setActiveFilters(prev => ({ ...prev, [key]: value }))}
          onClearFilters={() => { setSearchQuery(''); setActiveFilters({}); }}
          filters={filterConfigs}
          activeFilters={activeFilters}
          searchQuery={searchQuery}
          placeholder={t('searchAssets') || 'Search assets...'}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-fade-in-up delay-100">
          {loading ? (
            <div className="col-span-full flex items-center justify-center py-20 text-muted-foreground">
              <div className="flex flex-col items-center gap-4">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                <p>{t('loading') || 'Loading...'}</p>
              </div>
            </div>
          ) : filteredAssets.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center py-20 text-center glass-panel rounded-2xl border-dashed border-2 border-muted">
              <div className="h-20 w-20 rounded-full bg-muted/30 flex items-center justify-center mb-6">
                <File className="h-10 w-10 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold mb-2">{t('noAssetsFound')}</h3>
              <p className="text-muted-foreground mb-6 max-w-sm">{searchQuery || Object.keys(activeFilters).length > 0 ? t('tryAdjustingFilters') || 'Try adjusting your filters' : t('startByAddingAsset')}</p>
              {!(searchQuery || Object.keys(activeFilters).length > 0) && (
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/25" onClick={handleAddAsset} disabled={limitReached}>
                  <Plus className="mr-2 h-4 w-4" /> {t('addAsset')}
                </Button>
              )}
            </div>
          ) : (
            filteredAssets.map((asset, index) => {
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
                  className={`group relative glass-card p-5 rounded-2xl transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1 hover:shadow-xl hover:border-primary/20 flex flex-col justify-between h-full animate-fade-in-up ${delayClass} cursor-pointer`}
                  onClick={() => setSelectedAssetDetails(asset)}
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
                      <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-red-500" onClick={(e) => { e.stopPropagation(); handleDeleteAsset(asset.id); }} title={t('delete')}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className="mb-4">
                    <h3 className="font-bold text-lg mb-1 line-clamp-1 group-hover:text-primary transition-colors cursor-pointer">
                      {asset.asset_name}
                    </h3>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-3">
                      {t(asset.asset_type_details.name)}
                    </p>

                    <div className="space-y-2">
                      <div
                        className="flex items-center gap-2 text-sm p-2 rounded-lg bg-muted/30 hover:bg-muted/60 transition-colors cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); openAssignModal(asset); }}
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
                      onClick={(e) => { e.stopPropagation(); openAttachmentsModal(asset); }}
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
        {/* Details Modal */}
        <AssetDetailsModal
          asset={selectedAssetDetails}
          open={!!selectedAssetDetails}
          onClose={() => setSelectedAssetDetails(null)}
          onDelete={(id) => {
            setSelectedAssetDetails(null);
            handleDeleteAsset(id);
          }}
          onManageFiles={(asset) => {
            setSelectedAssetDetails(null);
            openAttachmentsModal(asset);
          }}
          beneficiaries={beneficiaries}
          onAssignBeneficiary={handleAssignBeneficiary}
          onAssetUpdated={fetchAssets}
        />
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
            <DialogFooter className="mt-6 gap-2 sm:gap-2">
              <Button variant="destructive" onClick={() => handleAssignBeneficiary(null)} disabled={selectedBeneficiaryId === null || loading} className="w-full sm:w-auto">
                {loading ? t('saving') : t('removeBeneficiary')}
              </Button>
              <Button variant="outline" onClick={() => setAssignModalOpen(false)} className="w-full sm:w-auto">{t('cancel')}</Button>
              <Button onClick={() => handleAssignBeneficiary(selectedBeneficiaryId)} disabled={!selectedBeneficiaryId || loading} className="w-full sm:w-auto">
                {loading ? t('saving') : t('assignBeneficiary')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <DeleteConfirmationModal
        open={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setAssetToDelete(null);
        }}
        onConfirm={confirmDeleteAsset}
        title={t('delete')}
        description={t('deleteConfirmDigitalAsset')}
        loading={loading}
      />
    </ProtectedRoute >
  );
} 
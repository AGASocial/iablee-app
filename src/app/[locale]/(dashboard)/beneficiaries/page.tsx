"use client";
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useState, useEffect, useCallback } from "react";

import { Pencil, Trash2, Plus, Users } from "lucide-react";
import DeleteConfirmationModal from '@/components/DeleteConfirmationModal';
import { toast } from 'sonner';
import AddBeneficiaryModal from '@/components/AddBeneficiaryModal';
import { Beneficiary } from '@/models/beneficiary';

// Helper for status badge (copied from dashboard)
function StatusBadge({ status }: { status: string | null }) {
    const t = useTranslations();
    const statusStyles: Record<string, string> = {
        active: "bg-green-100 text-green-800",
        pending: "bg-yellow-100 text-yellow-800",
        inactive: "bg-red-100 text-red-800",
    };
    return (
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusStyles[(status || '').toLowerCase()] || "bg-gray-100 text-gray-800"}`}>
            {t('status')}
        </span>
    );
}

import { useSecurity } from '@/context/SecurityContext'; // Import security context

export default function BeneficiariesPage() {
    const t = useTranslations();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { locked, loading: securityLoading } = useSecurity(); // Get security state
    const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);

    // For editing
    const [beneficiaryToEdit, setBeneficiaryToEdit] = useState<Beneficiary | null>(null);

    // For mobile view detail modal
    const [selectedBeneficiary, setSelectedBeneficiary] = useState<Beneficiary | null>(null);
    const [limitReached, setLimitReached] = useState(true);
    const [limitInfo, setLimitInfo] = useState<{ limit?: number; current?: number } | null>(null);

    const fetchBeneficiaries = useCallback(async () => {
        try {
            const res = await fetch('/api/beneficiaries');
            if (!res.ok) {
                setBeneficiaries([]);
                setLoading(false);
                return;
            }
            const data = await res.json();
            setBeneficiaries(data || []);
        } catch {
            setBeneficiaries([]);
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchLimitStatus = useCallback(async () => {
        try {
            const res = await fetch('/api/subscription/check-limit?type=beneficiary');
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
            console.error('Error checking beneficiary limit:', error);
        }
    }, []);

    useEffect(() => {
        // Only fetch if unlocked to avoid errors
        if (!locked && !securityLoading) {
            setLoading(true);
            fetchBeneficiaries();
            fetchLimitStatus();
        }
    }, [fetchBeneficiaries, fetchLimitStatus, locked, securityLoading]);

    // Auto-open modal when ?action=add is present in the URL
    useEffect(() => {
        if (searchParams.get('action') === 'add') {
            setShowAddModal(true);
            // Clean the query param from the URL
            router.replace(window.location.pathname, { scroll: false });
        }
    }, [searchParams, router]);

    const handleAddBeneficiary = () => {
        setBeneficiaryToEdit(null);
        setShowAddModal(true);
    };

    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [beneficiaryToDelete, setBeneficiaryToDelete] = useState<string | null>(null);

    function handleDeleteBeneficiary(id: string) {
        setBeneficiaryToDelete(id);
        setDeleteModalOpen(true);
    }

    async function confirmDeleteBeneficiary() {
        if (!beneficiaryToDelete) return;

        try {
            const res = await fetch(`/api/beneficiaries/${beneficiaryToDelete}`, { method: 'DELETE' });

            if (res.status === 409) {
                toast.error(t('errorBeneficiaryAssigned'));
                setDeleteModalOpen(false);
                setBeneficiaryToDelete(null);
                return;
            }

            if (!res.ok) throw new Error('Failed to delete');
            setBeneficiaries(beneficiaries.filter(b => b.id !== beneficiaryToDelete));
            toast.success(t('beneficiaryDeleted'));
            fetchLimitStatus();
            setDeleteModalOpen(false);
            setBeneficiaryToDelete(null);
        } catch {
            toast.error(t('errorDeletingBeneficiary'));
        }
    }


    function handleEditBeneficiary(b: Beneficiary) {
        setBeneficiaryToEdit(b);
        setShowAddModal(true);
    }

    const handleToggleNotification = async (id: string, newStatus: boolean) => {
        // Optimistic update
        setBeneficiaries(prev => prev.map(b => b.id === id ? { ...b, notified: newStatus } : b));

        try {
            const res = await fetch(`/api/beneficiaries/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notified: newStatus }),
            });

            if (!res.ok) throw new Error('Failed to update');
            toast.success(t('notificationUpdated'));
        } catch (error) {
            console.error('Error toggling notification:', error);
            toast.error(t('errorUpdatingNotification'));
            // Revert on error
            setBeneficiaries(prev => prev.map(b => b.id === id ? { ...b, notified: !newStatus } : b));
        }
    };


    function handleSuccess() {
        setLoading(true);
        fetchBeneficiaries();
        fetchLimitStatus();
    }

    return (
        <div className="p-4 sm:p-8">
            <DeleteConfirmationModal
                open={deleteModalOpen}
                onClose={() => {
                    setDeleteModalOpen(false);
                    setBeneficiaryToDelete(null);
                }}
                onConfirm={confirmDeleteBeneficiary}
                title={t('delete')}
                description={t('deleteConfirmBeneficiary')}
                loading={loading}
            />
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-4xl font-bold text-gray-900 dark:text-white">{t('beneficiariesTitle')}</h1>
                    {limitReached && limitInfo && (
                        <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                            {t('beneficiaryLimitReachedDescription', { limit: limitInfo.limit ?? 0 })} —{' '}
                            <button className="underline font-medium hover:text-amber-700" onClick={() => router.push('/billing/plans')}>
                                {t('viewPlans')}
                            </button>
                        </p>
                    )}
                </div>
                <Button className="hidden sm:inline-flex rounded-full px-6 py-2 text-base font-medium" onClick={handleAddBeneficiary} disabled={limitReached}>{t('addBeneficiary')}</Button>
            </div>
            <Button
                className="sm:hidden w-full mb-4 flex items-center justify-center gap-2"
                onClick={handleAddBeneficiary}
                disabled={limitReached}
                aria-label={t('addBeneficiary')}
            >
                <Plus className="w-5 h-5" />
            </Button>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-fade-in-up delay-100">
                {loading ? (
                    <div className="col-span-full flex items-center justify-center py-12 text-muted-foreground">
                        <div className="flex flex-col items-center gap-3">
                            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                            <p>{t('loading')}</p>
                        </div>
                    </div>
                ) : beneficiaries.length === 0 ? (
                    <div className="col-span-full flex flex-col items-center justify-center py-16 text-center glass-panel rounded-2xl border-dashed border-2 border-muted">
                        <div className="h-16 w-16 rounded-full bg-muted/30 flex items-center justify-center mb-4">
                            <Users className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h3 className="text-xl font-semibold mb-2">{t('noBeneficiaries')}</h3>
                        <p className="text-muted-foreground mb-6 max-w-sm">{t('startByAddingBeneficiary')}</p>
                        <Button className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/25" onClick={handleAddBeneficiary} disabled={limitReached}>
                            <Plus className="mr-2 h-4 w-4" /> {t('addBeneficiary')}
                        </Button>
                    </div>
                ) : (
                    beneficiaries.map((b, index) => {
                        // Stagger animation
                        const delayClass = index < 8 ? `delay-${(index + 1) * 100}` : '';

                        return (
                            <div
                                key={b.id}
                                className={`group glass-card p-5 rounded-2xl relative flex flex-col justify-between transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1 hover:shadow-xl hover:border-primary/20 animate-fade-in-up ${delayClass}`}
                            >
                                <div className="absolute top-4 right-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                    <Button variant="ghost" size="icon" className="h-8 w-8 bg-background/50 backdrop-blur-md hover:text-blue-500 rounded-full" onClick={() => handleEditBeneficiary(b)} title={t('edit')}>
                                        <Pencil className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 bg-background/50 backdrop-blur-md hover:text-red-500 rounded-full" onClick={() => handleDeleteBeneficiary(b.id)} title={t('delete')}>
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                </div>

                                <div className="mb-4 text-center">
                                    <div className="mx-auto h-20 w-20 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center text-3xl font-bold text-primary mb-3 shadow-inner ring-4 ring-background">
                                        {b.full_name.charAt(0)}
                                    </div>
                                    <h3 className="font-bold text-lg text-foreground line-clamp-1">{b.full_name}</h3>
                                    <p className="text-sm text-muted-foreground mb-2">{b.email}</p>
                                    <div className="flex justify-center flex-wrap gap-2">
                                        {b.relationship && b.relationship.key && (
                                            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                                                {t('relationships.' + b.relationship.key)}
                                            </span>
                                        )}
                                        {/* <StatusBadge status={b.status} /> */}
                                    </div>
                                </div>

                                <div className="space-y-2 text-sm border-t border-border/50 pt-4 mt-auto">
                                    {b.phone_number && (
                                        <div className="flex justify-between items-center text-muted-foreground bg-muted/20 p-2 rounded-lg">
                                            <span className="text-xs font-semibold">{t('phoneNumber')}</span>
                                            <span className="font-mono">{b.phone_number}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between items-center text-xs text-muted-foreground p-1">
                                        <span>{t('notifications')}</span>
                                        <Switch
                                            disabled
                                            checked={b.notified || false}
                                            onCheckedChange={(checked) => handleToggleNotification(b.id, checked)}
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            <AddBeneficiaryModal
                open={showAddModal}
                onOpenChange={setShowAddModal}
                onSuccess={handleSuccess}
                beneficiaryToEdit={beneficiaryToEdit}
            />

            {selectedBeneficiary && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-2 sm:hidden">
                    <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg p-6 w-full max-w-sm border border-gray-200 dark:border-gray-700">
                        <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">{selectedBeneficiary.full_name}</h3>
                        <div className="space-y-2">
                            <div><span className="font-semibold">{t('email')}:</span> {selectedBeneficiary.email}</div>
                            <div><span className="font-semibold">{t('phoneNumber')}:</span> {selectedBeneficiary.phone_number}</div>
                            <div><span className="font-semibold">{t('relationship')}:</span> {selectedBeneficiary.relationship?.key ? t('relationships.' + selectedBeneficiary.relationship.key) : ''}</div>
                            <div><span className="font-semibold">{t('notes')}:</span> {selectedBeneficiary.notes}</div>
                            <div><span className="font-semibold">{t('status')}:</span> <StatusBadge status={selectedBeneficiary.status} /></div>
                        </div>
                        <div className="flex justify-end gap-2 mt-6">
                            <Button variant="outline" onClick={() => { setSelectedBeneficiary(null); handleEditBeneficiary(selectedBeneficiary); }}>{t('edit')}</Button>
                            <Button variant="destructive" onClick={() => { handleDeleteBeneficiary(selectedBeneficiary.id); setSelectedBeneficiary(null); }}>{t('delete')}</Button>
                            <Button onClick={() => setSelectedBeneficiary(null)}>{t('cancel')}</Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
} 
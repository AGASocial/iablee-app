"use client";
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Pencil, Trash2, Plus, Users } from "lucide-react";
import { useRef } from "react";
import { toast } from 'sonner';

interface Beneficiary {
    id: string;
    full_name: string;
    email: string | null;
    phone_number: string | null;
    relationship: { key: string } | null;
    notes: string | null;
    notified: boolean | null;
    status: string | null;
    last_notified_at: string | null;
    email_verified: boolean | null;
    created_at: string | null;
    updated_at: string | null;
    user_id: string;
    relationship_id: number | null;
}

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

export default function BeneficiariesPage() {
    const t = useTranslations();
    const router = useRouter();
    const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [form, setForm] = useState({
        full_name: '',
        email: '',
        phone_number: '',
        relationship_id: null as number | null,
        notes: '',
        notified: false,
    });
    const [submitting, setSubmitting] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [selectedBeneficiary, setSelectedBeneficiary] = useState<Beneficiary | null>(null);
    const [relationships, setRelationships] = useState<{ id: number, key: string }[]>([]);
    const [relationshipQuery, setRelationshipQuery] = useState("");
    const relationshipInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        async function fetchBeneficiaries() {
            setLoading(true);
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                setBeneficiaries([]);
                setLoading(false);
                return;
            }
            const { data } = await supabase
                .from('beneficiaries')
                .select('*, relationship:relationships(key)')
                .eq('user_id', user.id)
                .order('full_name', { ascending: true });
            setBeneficiaries(data || []);
            setLoading(false);
        }
        fetchBeneficiaries();
    }, []);

    useEffect(() => {
        async function fetchRelationships() {
            const { data, error } = await supabase.from('relationships').select('id, key, generation_level').gte('generation_level', 3).order('generation_level, key');
            if (!error && data) setRelationships(data);
        }
        fetchRelationships();
    }, []);

    const handleAddBeneficiary = async () => {
        try {
            // Check if user can create a beneficiary
            const response = await fetch('/api/subscription/check-limit?type=beneficiary');
            const result = await response.json();

            if (!result.allowed) {
                // Show limit reached message with upgrade option
                toast.error(t('beneficiaryLimitReached'), {
                    description: t('beneficiaryLimitReachedDescription', { limit: result.limit }),
                    action: {
                        label: t('viewPlans'),
                        onClick: () => router.push('/billing/plans'),
                    },
                    duration: 5000,
                });
                return;
            }

            // Open the modal if allowed
            setShowAddModal(true);
        } catch (error) {
            console.error('Error checking beneficiary limit:', error);
            // On error, allow creation (fail open)
            setShowAddModal(true);
        }
    };

    // async function handleAddBeneficiary() {
    //     setSubmitting(true);
    //     try {
    //         const { data: { user } } = await supabase.auth.getUser();
    //         if (!user) throw new Error('No user');
    //         const { error } = await supabase.from('beneficiaries').insert({
    //             user_id: user.id,
    //             full_name: form.full_name,
    //             email: form.email,
    //             phone_number: form.phone_number,
    //             relationship: form.relationship,
    //             notes: form.notes,
    //             notified: form.notified,
    //             status: 'active',
    //         });
    //         if (error) throw error;
    //         setShowAddModal(false);
    //         setForm({ full_name: '', email: '', phone_number: '', relationship: '', notes: '', notified: false });
    //         setLoading(true);
    //         // Refetch data
    //         const { data: beneficiariesData } = await supabase
    //             .from('beneficiaries')
    //             .select('*')
    //             .eq('user_id', user.id);
    //         setBeneficiaries(beneficiariesData || []);
    //     } catch {
    //         alert('Error adding beneficiary');
    //     } finally {
    //         setSubmitting(false);
    //         setLoading(false);
    //     }
    // }

    async function handleDeleteBeneficiary(id: string) {
        if (!confirm(t('deleteConfirmBeneficiary'))) return;
        setSubmitting(true);
        try {
            await supabase.from('beneficiaries').delete().eq('id', id);
            setBeneficiaries(beneficiaries.filter(b => b.id !== id));
        } catch {
            alert('Error deleting beneficiary');
        } finally {
            setSubmitting(false);
        }
    }

    function handleEditBeneficiary(b: Beneficiary) {
        setForm({
            full_name: b.full_name || '',
            email: b.email || '',
            phone_number: b.phone_number || '',
            relationship_id: b.relationship_id ?? null,
            notes: b.notes || '',
            notified: !!b.notified,
        });
        setEditId(b.id);
        setShowAddModal(true);
    }

    async function handleSaveBeneficiary() {
        setSubmitting(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('No user');
            if (editId) {
                // Update
                const { error } = await supabase.from('beneficiaries').update({
                    full_name: form.full_name,
                    email: form.email,
                    phone_number: form.phone_number,
                    relationship_id: form.relationship_id,
                    notes: form.notes,
                    notified: form.notified,
                }).eq('id', editId);
                if (error) throw error;
            } else {
                // Insert
                const { error } = await supabase.from('beneficiaries').insert({
                    user_id: user.id,
                    full_name: form.full_name,
                    email: form.email,
                    phone_number: form.phone_number,
                    relationship_id: form.relationship_id,
                    notes: form.notes,
                    notified: form.notified,
                    status: 'active',
                });
                if (error) throw error;
            }
            setShowAddModal(false);
            setForm({ full_name: '', email: '', phone_number: '', relationship_id: null, notes: '', notified: false });
            setEditId(null);
            setLoading(true);
            // Refetch data
            const { data: beneficiariesData } = await supabase
                .from('beneficiaries')
                .select('*, relationship:relationships(key)')
                .eq('user_id', user.id)
                .order('full_name', { ascending: true });
            setBeneficiaries(beneficiariesData || []);
        } catch {
            alert('Error saving beneficiary');
        } finally {
            setSubmitting(false);
            setLoading(false);
        }
    }

    return (
        <div className="p-4 sm:p-8">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-4xl font-bold text-gray-900 dark:text-white">{t('beneficiariesTitle')}</h1>
                <Button className="hidden sm:inline-flex rounded-full px-6 py-2 text-base font-medium" onClick={handleAddBeneficiary}>{t('addBeneficiary')}</Button>
            </div>
            <Button
                className="sm:hidden w-full mb-4 flex items-center justify-center gap-2"
                onClick={handleAddBeneficiary}
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
                        <Button className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/25" onClick={handleAddBeneficiary}>
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
                                        <StatusBadge status={b.status} />
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
                                        <span className={b.notified ? "text-green-500 font-bold" : "text-gray-400"}>
                                            {b.notified ? "ON" : "OFF"}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
            {showAddModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-2">
                    <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg p-4 sm:p-8 w-full max-w-md border border-gray-200 dark:border-gray-700">
                        <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">{t('addBeneficiary')}</h3>
                        <div className="space-y-4">
                            <input className="w-full p-2 border rounded bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white border-gray-300 dark:border-gray-700 placeholder-gray-400 dark:placeholder-gray-400" placeholder={t('name')} value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
                            <input className="w-full p-2 border rounded bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white border-gray-300 dark:border-gray-700 placeholder-gray-400 dark:placeholder-gray-400" placeholder={t('email')} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                            <input className="w-full p-2 border rounded bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white border-gray-300 dark:border-gray-700 placeholder-gray-400 dark:placeholder-gray-400" placeholder={t('phoneNumber')} value={form.phone_number} onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))} />
                            {/* Relationship Autocomplete */}
                            <div className="relative">
                                <input
                                    ref={relationshipInputRef}
                                    className="w-full p-2 border rounded bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white border-gray-300 dark:border-gray-700 placeholder-gray-400 dark:placeholder-gray-400"
                                    placeholder={t('relationship')}
                                    value={relationshipQuery || (form.relationship_id ? t('relationships.' + (relationships.find(r => r.id === form.relationship_id)?.key || 'other')) : '')}
                                    onChange={e => {
                                        setRelationshipQuery(e.target.value);
                                        setForm(f => ({ ...f, relationship_id: null }));
                                    }}
                                    onFocus={() => setRelationshipQuery("")}
                                    autoComplete="off"
                                />
                                {relationshipQuery && (
                                    <div className="absolute z-10 left-0 right-0 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded shadow max-h-48 overflow-y-auto">
                                        {relationships.filter(r => t('relationships.' + r.key).toLowerCase().includes(relationshipQuery.toLowerCase())).map(r => (
                                            <div
                                                key={r.id}
                                                className="px-4 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-900 dark:text-white"
                                                onClick={() => {
                                                    setForm(f => ({ ...f, relationship_id: r.id }));
                                                    setRelationshipQuery(""); // Hide dropdown after selection
                                                    relationshipInputRef.current?.blur();
                                                }}
                                            >
                                                {t('relationships.' + r.key)}
                                            </div>
                                        ))}
                                        {relationships.filter(r => t('relationships.' + r.key).toLowerCase().includes(relationshipQuery.toLowerCase())).length === 0 && (
                                            <div className="px-4 py-2 text-gray-400">{t('other')}</div>
                                        )}
                                    </div>
                                )}
                            </div>
                            <textarea className="w-full p-2 border rounded bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white border-gray-300 dark:border-gray-700 placeholder-gray-400 dark:placeholder-gray-400" placeholder={t('notes')} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                            <label className="flex items-center gap-2 text-gray-700 dark:text-gray-200">
                                <input type="checkbox" checked={form.notified} onChange={e => setForm(f => ({ ...f, notified: e.target.checked }))} />
                                {t('notifyNow')}
                            </label>
                        </div>
                        <div className="flex justify-end gap-2 mt-6">
                            <Button variant="outline" onClick={() => setShowAddModal(false)}>{t('cancel')}</Button>
                            <Button onClick={handleSaveBeneficiary} disabled={submitting}>
                                {submitting ? t('saving') : t('save')}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
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
"use client";
import { useTranslations } from 'next-intl';
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

interface Beneficiary {
    id: string;
    full_name: string;
    email: string | null;
    phone_number: string | null;
    relationship: string | null;
    notes: string | null;
    notified: boolean | null;
    status: string | null;
    last_notified_at: string | null;
    email_verified: boolean | null;
    created_at: string | null;
    updated_at: string | null;
    user_id: string;
}

export default function BeneficiariesPage() {
    const t = useTranslations();
    const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [form, setForm] = useState({
        full_name: '',
        email: '',
        phone_number: '',
        relationship: '',
        notes: '',
        notified: false,
    });
    const [submitting, setSubmitting] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);

    useEffect(() => {
        async function fetchBeneficiaries() {
            setLoading(true);
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                setBeneficiaries([]);
                setLoading(false);
                return;
            }
            const { data, error } = await supabase
                .from('beneficiaries')
                .select('*')
                .eq('user_id', user.id);
            setBeneficiaries(data || []);
            setLoading(false);
        }
        fetchBeneficiaries();
    }, []);

    async function handleAddBeneficiary() {
        setSubmitting(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('No user');
            const { error } = await supabase.from('beneficiaries').insert({
                user_id: user.id,
                full_name: form.full_name,
                email: form.email,
                phone_number: form.phone_number,
                relationship: form.relationship,
                notes: form.notes,
                notified: form.notified,
                status: 'active',
            });
            if (error) throw error;
            setShowAddModal(false);
            setForm({ full_name: '', email: '', phone_number: '', relationship: '', notes: '', notified: false });
            setLoading(true);
            // Refetch data
            const { data: beneficiariesData } = await supabase
                .from('beneficiaries')
                .select('*')
                .eq('user_id', user.id);
            setBeneficiaries(beneficiariesData || []);
        } catch (e) {
            alert('Error adding beneficiary');
        } finally {
            setSubmitting(false);
            setLoading(false);
        }
    }

    async function handleDeleteBeneficiary(id: string) {
        if (!confirm(t('deleteConfirm'))) return;
        setSubmitting(true);
        try {
            await supabase.from('beneficiaries').delete().eq('id', id);
            setBeneficiaries(beneficiaries.filter(b => b.id !== id));
        } catch (e) {
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
            relationship: b.relationship || '',
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
                    relationship: form.relationship,
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
                    relationship: form.relationship,
                    notes: form.notes,
                    notified: form.notified,
                    status: 'active',
                });
                if (error) throw error;
            }
            setShowAddModal(false);
            setForm({ full_name: '', email: '', phone_number: '', relationship: '', notes: '', notified: false });
            setEditId(null);
            setLoading(true);
            // Refetch data
            const { data: beneficiariesData } = await supabase
                .from('beneficiaries')
                .select('*')
                .eq('user_id', user.id);
            setBeneficiaries(beneficiariesData || []);
        } catch (e) {
            alert('Error saving beneficiary');
        } finally {
            setSubmitting(false);
            setLoading(false);
        }
    }

    return (
        <div className="p-8">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-4xl font-bold text-gray-900 dark:text-white">{t('beneficiariesTitle')}</h1>
                <Button className="rounded-full px-6 py-2 text-base font-medium" onClick={() => setShowAddModal(true)}>{t('addBeneficiary')}</Button>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-gray-700">
                {loading ? (
                    <div className="flex items-center justify-center py-12 text-gray-400">{t('loading')}</div>
                ) : (
                    <table className="min-w-full divide-y divide-gray-700 bg-gray-900 dark:bg-gray-900">
                        <thead>
                            <tr>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">{t('name')}</th>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">{t('email')}</th>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">{t('phoneNumber')}</th>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">{t('relationship')}</th>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">{t('status')}</th>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">{t('actions')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                            {beneficiaries.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="py-12 text-center text-gray-400">
                                        {t('noBeneficiaries')}
                                        <Button className="mt-2 ml-2 bg-gray-800 text-gray-100" onClick={() => setShowAddModal(true)}>{t('addBeneficiary')}</Button>
                                    </td>
                                </tr>
                            ) : (
                                beneficiaries.map(b => (
                                    <tr key={b.id}>
                                        <td className="px-6 py-4 whitespace-nowrap text-gray-100">{b.full_name}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-gray-400">{b.email}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-gray-100">{b.phone_number}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-gray-100">{b.relationship}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-gray-100">{b.status}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-gray-400">
                                            <button className="mr-4 hover:underline text-blue-400" onClick={() => handleEditBeneficiary(b)}>{t('edit')}</button>
                                            <button className="hover:underline text-red-400" onClick={() => handleDeleteBeneficiary(b.id)}>{t('delete')}</button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                )}
            </div>
            {showAddModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
                    <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg p-8 w-full max-w-md">
                        <h3 className="text-lg font-bold mb-4">{t('addBeneficiary')}</h3>
                        <div className="space-y-4">
                            <input className="w-full p-2 border rounded" placeholder={t('name')} value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
                            <input className="w-full p-2 border rounded" placeholder={t('email')} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                            <input className="w-full p-2 border rounded" placeholder={t('phoneNumber')} value={form.phone_number} onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))} />
                            <input className="w-full p-2 border rounded" placeholder={t('relationship')} value={form.relationship} onChange={e => setForm(f => ({ ...f, relationship: e.target.value }))} />
                            <textarea className="w-full p-2 border rounded" placeholder={t('notes')} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                            <label className="flex items-center gap-2">
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
        </div>
    );
} 
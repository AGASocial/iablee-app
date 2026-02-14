"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

import { toast } from "sonner";
import { Beneficiary } from "@/models/beneficiary";

interface AddBeneficiaryModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
    beneficiaryToEdit?: Beneficiary | null;
}

export default function AddBeneficiaryModal({ open, onOpenChange, onSuccess, beneficiaryToEdit }: AddBeneficiaryModalProps) {
    const t = useTranslations();
    const [loading, setLoading] = useState(false);
    const [relationships, setRelationships] = useState<{ id: number; key: string }[]>([]);

    const [formData, setFormData] = useState({
        full_name: "",
        email: "",
        phone_number: "",
        relationship_id: null as number | null,
        notes: "",
        notified: false,
    });

    useEffect(() => {
        async function fetchRelationships() {
            try {
                const res = await fetch('/api/relationships');
                if (res.ok) {
                    const data = await res.json();
                    setRelationships(data);
                }
            } catch (error) {
                console.error('Error fetching relationships:', error);
            }
        }

        if (open) {
            fetchRelationships();
        }
    }, [open]);

    useEffect(() => {
        if (beneficiaryToEdit) {
            setFormData({
                full_name: beneficiaryToEdit.full_name || "",
                email: beneficiaryToEdit.email || "",
                phone_number: beneficiaryToEdit.phone_number || "",
                relationship_id: beneficiaryToEdit.relationship_id || null,
                notes: beneficiaryToEdit.notes || "",
                notified: !!beneficiaryToEdit.notified,
            });
        } else {
            setFormData({
                full_name: "",
                email: "",
                phone_number: "",
                relationship_id: null,
                notes: "",
                notified: false,
            });
        }
    }, [beneficiaryToEdit, open]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            if (beneficiaryToEdit) {
                // Update
                const res = await fetch(`/api/beneficiaries/${beneficiaryToEdit.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        full_name: formData.full_name,
                        email: formData.email,
                        phone_number: formData.phone_number,
                        relationship_id: formData.relationship_id,
                        notes: formData.notes,
                        notified: formData.notified,
                    }),
                });

                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.error || 'Failed to update beneficiary');
                }
                toast.success(t('beneficiaryUpdatedSuccess') || "Beneficiary updated successfully");
            } else {
                // Create
                const res = await fetch('/api/beneficiaries', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        full_name: formData.full_name,
                        email: formData.email,
                        phone_number: formData.phone_number,
                        relationship_id: formData.relationship_id,
                        notes: formData.notes,
                        notified: formData.notified,
                    }),
                });

                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.error || 'Failed to create beneficiary');
                }
                toast.success(t('beneficiaryCreatedSuccess') || "Beneficiary created successfully");
            }

            onSuccess();
            onOpenChange(false);
        } catch (error) {
            console.error("Error saving beneficiary:", error);
            toast.error(t('errorSavingBeneficiary') || "Error saving beneficiary");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px] glass-panel border-white/10 dark:border-white/5">
                <DialogHeader>
                    <DialogTitle className="text-xl font-heading font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-600">
                        {beneficiaryToEdit ? t('editBeneficiary') : t('addBeneficiary')}
                    </DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="full_name" className="text-foreground/80">{t('name')}</Label>
                        <Input
                            id="full_name"
                            value={formData.full_name}
                            onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                            placeholder="John Doe"
                            required
                            className="bg-background/50 border-white/10 focus:border-primary/50"
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="email" className="text-foreground/80">{t('email')}</Label>
                            <Input
                                id="email"
                                type="email"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                placeholder="john@example.com"
                                className="bg-background/50 border-white/10 focus:border-primary/50"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="phone" className="text-foreground/80">{t('phoneNumber')}</Label>
                            <Input
                                id="phone"
                                value={formData.phone_number}
                                onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                                placeholder="+1 234 567 890"
                                className="bg-background/50 border-white/10 focus:border-primary/50"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="relationship" className="text-foreground/80">{t('relationship')}</Label>
                        <Select
                            value={formData.relationship_id?.toString() || ""}
                            onValueChange={(value) => setFormData({ ...formData, relationship_id: parseInt(value) })}
                        >
                            <SelectTrigger className="bg-background/50 border-white/10 focus:border-primary/50 w-full">
                                <SelectValue placeholder={t('selectRelationship') || t('relationship')} />
                            </SelectTrigger>
                            <SelectContent className="max-h-[200px]">
                                {relationships.map((rel) => (
                                    <SelectItem key={rel.id} value={rel.id.toString()}>
                                        {t(`relationships.${rel.key}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="notes" className="text-foreground/80">{t('notes')}</Label>
                        <Textarea
                            id="notes"
                            value={formData.notes}
                            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                            placeholder={t('notesPlaceholder') || "Additional notes..."}
                            className="bg-background/50 border-white/10 focus:border-primary/50 min-h-[80px]"
                        />
                    </div>

                    <div className="flex items-center space-x-2 pt-2">
                        <input
                            type="checkbox"
                            id="notify"
                            checked={formData.notified}
                            onChange={(e) => setFormData({ ...formData, notified: e.target.checked })}
                            className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4"
                        />
                        <Label htmlFor="notify" className="text-sm font-medium leading-none cursor-pointer">
                            {t('notifyNow')}
                        </Label>
                    </div>

                    <DialogFooter className="pt-4">
                        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                            {t('cancel')}
                        </Button>
                        <Button type="submit" disabled={loading} className="bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20">
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {t('save')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

"use client";

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { useUserProfile } from '@/hooks/useDataQueries';

export function ChangePasswordCard() {
    const t = useTranslations();
    const [loading, setLoading] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPasswordChange, setShowPasswordChange] = useState(false);
    const { data: user, isLoading } = useUserProfile();

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            toast.error(t('settings.passwordsDoNotMatch'));
            return;
        }

        setLoading(true);
        try {
            const res = await fetch('/api/user/password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newPassword }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || "Failed to change password");
            }

            toast.success(t('settings.passwordChangedSuccess'));
            setNewPassword('');
            setConfirmPassword('');
            setShowPasswordChange(false);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
            toast.error(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    const providers = user?.identities?.map((id) => id.provider) ?? [];
    const isEmailProvider = providers.includes('email');

    if (isLoading || !user) return null;
    if (!isEmailProvider) return null;

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('settings.changePassword')}</CardTitle>
                <CardDescription>{t('settings.languageDescription') ? "" : ""}</CardDescription>
            </CardHeader>
            <CardContent>
                {!showPasswordChange ? (
                    <Button variant="outline" onClick={() => setShowPasswordChange(true)}>
                        {t('settings.changePassword')}
                    </Button>
                ) : (
                    <form onSubmit={handleChangePassword} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="newPassword">{t('settings.newPassword')}</Label>
                            <Input
                                id="newPassword"
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="confirmPassword">{t('settings.confirmNewPassword')}</Label>
                            <Input
                                id="confirmPassword"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                        </div>
                        <div className="flex gap-2">
                            <Button type="submit" disabled={loading || !newPassword}>
                                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {t('settings.changePassword')}
                            </Button>
                            <Button type="button" variant="ghost" onClick={() => setShowPasswordChange(false)}>
                                {t('cancel')}
                            </Button>
                        </div>
                    </form>
                )}
            </CardContent>
        </Card>
    );
}

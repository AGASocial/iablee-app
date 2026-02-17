"use client";

import { useTranslations } from 'next-intl';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Chrome, Apple } from 'lucide-react';


interface UserProfile {
    id: string;
    email?: string;
    full_name?: string;
    identities?: { provider: string }[];
}

export function ProfileForm() {
    const t = useTranslations();
    const [loading, setLoading] = useState(false);
    const [user, setUser] = useState<UserProfile | null>(null);
    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');

    useEffect(() => {
        const fetchUser = async () => {
            try {
                const res = await fetch('/api/user/profile');
                if (res.ok) {
                    const data = await res.json();
                    setUser(data);
                    setEmail(data.email || '');
                    setFullName(data.full_name || '');
                }
            } catch (error) {
                console.error("Failed to fetch user profile", error);
            }
        };
        fetchUser();
    }, []);

    const handleUpdateProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            const res = await fetch('/api/user/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fullName }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || t('settings.errorUpdatingProfile'));
            }

            toast.success(t('settings.profileUpdatedSuccess'));
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
            toast.error(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    // Helper to determine connected providers
    const getProviders = () => {
        if (!user?.identities) return [];
        return user.identities.map((id: { provider: string }) => id.provider);
    };

    const providers = getProviders();
    const isGoogleProvider = providers.includes('google');
    const isAppleProvider = providers.includes('apple');

    if (!user) {
        return <div className="p-8 text-center text-muted-foreground"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>;
    }

    return (
        <div className="space-y-8 max-w-lg">

            {/* Personal Information */}
            <div className="rounded-lg border bg-card p-6 space-y-4">
                <h3 className="text-lg font-medium">{t('settings.personalInformation')}</h3>
                <form onSubmit={handleUpdateProfile} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="email">{t('email')}</Label>
                        <Input
                            id="email"
                            value={email}
                            disabled
                            className="bg-muted"
                        />
                        <p className="text-xs text-muted-foreground">
                            Emails cannot be changed directly.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="fullName">{t('fullName')}</Label>
                        <Input
                            id="fullName"
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            placeholder="John Doe"
                        />
                    </div>

                    <Button type="submit" disabled={loading}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {t('save')}
                    </Button>
                </form>
            </div>

            {/* Connected Accounts */}
            <div className="rounded-lg border bg-card p-6 space-y-4">
                <h3 className="text-lg font-medium">{t('settings.connectedAccounts')}</h3>
                <div className="space-y-3">
                    {/* Google */}
                    <div className="flex items-center justify-between p-3 border rounded-md">
                        <div className="flex items-center gap-3">
                            <Chrome className="h-5 w-5" />
                            <span className="font-medium">Google</span>
                        </div>
                        {isGoogleProvider ? (
                            <span className="text-sm text-green-600 font-medium">Connected</span>
                        ) : (
                            <span className="text-sm text-muted-foreground">{t('settings.notConnected')}</span>
                        )}
                    </div>

                    {/* Apple */}
                    <div className="flex items-center justify-between p-3 border rounded-md">
                        <div className="flex items-center gap-3">
                            <Apple className="h-5 w-5" />
                            <span className="font-medium">Apple</span>
                        </div>
                        {isAppleProvider ? (
                            <span className="text-sm text-green-600 font-medium">Connected</span>
                        ) : (
                            <span className="text-sm text-muted-foreground">{t('settings.notConnected')}</span>
                        )}
                    </div>
                </div>
            </div>

        </div>
    );
}

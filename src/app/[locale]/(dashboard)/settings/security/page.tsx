"use client";

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useSecurity } from '@/context/SecurityContext';
import { PinInput } from '@/components/ui/pin-input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { ChangePasswordCard } from '@/components/settings/ChangePasswordCard';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"

export default function SecuritySettingsPage() {
    const t = useTranslations();
    const { hasPin, checkStatus } = useSecurity();

    // States for different PINs
    const [currentPin, setCurrentPin] = useState('');
    const [newPin, setNewPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');

    const [loading, setLoading] = useState(false);
    const [showPinChange, setShowPinChange] = useState(false);

    // If user doesn't have a PIN, we should probably show the setup flow instead, 
    // or just assume "New PIN" logic if we want to reuse this page for initial setup too.
    // For now, based on instructions "enter current pin, and new and confirm new pin", 
    // I will assume the user has a PIN or the logic handles it. 
    // If !hasPin, currentPin isn't needed, but let's stick to the request for now: "modify PIN".

    // State keys to force re-render/reset of PinInput components
    const [currentPinKey, setCurrentPinKey] = useState(0);
    const [newPinKey, setNewPinKey] = useState(0);
    const [confirmPinKey, setConfirmPinKey] = useState(0);

    const isFormValid = () => {
        if (hasPin && currentPin.length !== 6) return false;
        if (newPin.length !== 6) return false;
        if (confirmPin.length !== 6) return false;
        if (newPin !== confirmPin) return false;
        return true;
    };

    const handleSubmit = async () => {
        if (!isFormValid()) return;

        if (newPin !== confirmPin) {
            toast.error(t('pinsDoNotMatch'));
            return;
        }

        setLoading(true);

        try {
            // First verify current PIN if it exists (though the API endpoint I made does this verify inside)
            // Ideally we use a single endpoint to change PIN which accepts current + new.

            const endpoint = hasPin ? '/api/security/change-pin' : '/api/security/set-pin';
            const payload = hasPin
                ? { currentPin, newPin }
                : { pin: newPin };

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || t('errorChangingPin'));
            }

            toast.success(t('pinChangedSuccess'));

            // Reset fields
            setCurrentPin('');
            setNewPin('');
            setConfirmPin('');
            setShowPinChange(false);

            // Force reset of UI components
            setCurrentPinKey(prev => prev + 1);
            setNewPinKey(prev => prev + 1);
            setConfirmPinKey(prev => prev + 1);

            // Refresh security status
            await checkStatus();

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
            toast.error(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">

            {/* Change Password Section */}
            <div>
                <ChangePasswordCard />
            </div>

            <div className="border-t border-muted" />

            {/* Change PIN Section */}
            <Card>
                <CardHeader>
                    <CardTitle>{t('changeSecurityPin')}</CardTitle>
                    <CardDescription>{t('changePinDescription')}</CardDescription>
                </CardHeader>
                <CardContent>
                    {!showPinChange ? (
                        <Button variant="outline" onClick={() => setShowPinChange(true)}>
                            {t('changeSecurityPin')}
                        </Button>
                    ) : (
                        <div className="space-y-8 max-w-lg">
                            {/* Current PIN Field - Only if user has a PIN */}
                            {hasPin && (
                                <div className="space-y-3">
                                    <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                        {t('currentPin')}
                                    </label>
                                    <div className="flex justify-start">
                                        <PinInput
                                            key={currentPinKey}
                                            length={6}
                                            onComplete={(val) => setCurrentPin(val)}
                                            disabled={loading}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* New PIN Field */}
                            <div className="space-y-3">
                                <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                    {t('newPin')}
                                </label>
                                <div className="flex justify-start">
                                    <PinInput
                                        key={newPinKey}
                                        length={6}
                                        onComplete={(val) => setNewPin(val)}
                                        disabled={loading}
                                    />
                                </div>
                            </div>

                            {/* Confirm New PIN Field */}
                            <div className="space-y-3">
                                <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                    {t('confirmNewPin')}
                                </label>
                                <div className="flex justify-start">
                                    <PinInput
                                        key={confirmPinKey}
                                        length={6}
                                        onComplete={(val) => setConfirmPin(val)}
                                        disabled={loading}
                                    />
                                </div>
                                {newPin && confirmPin && newPin !== confirmPin && (
                                    <p className="text-sm text-destructive">{t('pinsDoNotMatch')}</p>
                                )}
                            </div>

                            <div className="flex gap-2 pt-4">
                                <Button
                                    onClick={handleSubmit}
                                    disabled={!isFormValid() || loading}
                                >
                                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    {t('changeSecurityPin')}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => setShowPinChange(false)}
                                    disabled={loading} // Also disable cancel while loading to prevent state mismatch
                                >
                                    {t('cancel')}
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

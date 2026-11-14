"use client";

import { useTranslations } from 'next-intl';
import { ProfileForm } from '@/components/settings/ProfileForm';

export default function SettingsPage() {
    const t = useTranslations();

    return (
        <div className="space-y-6">
            <div>
                <h2 className="page-title text-xl font-semibold">{t('settings.profile')}</h2>
                <p className="page-subtitle">
                    {t('manageAccountSettings')}
                </p>
            </div>
            <div className="border-t border-muted" />

            <ProfileForm />
        </div>
    );
}

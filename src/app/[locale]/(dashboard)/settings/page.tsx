import { useTranslations } from 'next-intl';
import { ProfileForm } from '@/components/settings/ProfileForm';

export default function SettingsPage() {
    const t = useTranslations();

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-lg font-medium">{t('settings.profile')}</h2>
                <p className="text-sm text-muted-foreground">
                    {t('manageAccountSettings')}
                </p>
            </div>
            <div className="border-t border-muted" />

            <ProfileForm />
        </div>
    );
}


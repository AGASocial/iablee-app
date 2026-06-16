import { useTranslations } from 'next-intl';
import { ProfileForm } from '@/components/settings/ProfileForm';

export default function SettingsPage() {
    const t = useTranslations();

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground dark:text-white">{t('settings.profile')}</h2>
                <p className="mt-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {t('manageAccountSettings')}
                </p>
            </div>
            <div className="border-t border-muted" />

            <ProfileForm />
        </div>
    );
}


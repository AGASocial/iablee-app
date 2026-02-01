import { useTranslations } from 'next-intl';

export default function SettingsPage() {
    const t = useTranslations();

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">{t('profileSettings')}</h1>
                <p className="text-muted-foreground">
                    {t('manageAccountSettings')}
                </p>
            </div>

            <div className="rounded-lg border bg-card p-6">
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        {t('accountSettingsComingSoon')}
                    </p>
                </div>
            </div>
        </div>
    );
}

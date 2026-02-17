import { useTranslations } from 'next-intl';
import { SettingsNav } from '@/components/settings/SettingsNav';

export default function SettingsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const t = useTranslations();

    return (
        <div className="space-y-6 pb-16">
            <div className="space-y-0.5">
                <h1 className="text-2xl font-bold tracking-tight">{t('settings.title')}</h1>
                <p className="text-muted-foreground">
                    {t('manageAccountSettings')}
                </p>
            </div>
            <div className="border-t my-6" />
            <div className="flex flex-col space-y-8 lg:flex-row lg:space-x-12 lg:space-y-0">
                <aside className="lg:w-1/5">
                    <SettingsNav className="mx-0" />
                </aside>
                <div className="flex-1 lg:max-w-2xl">{children}</div>
            </div>
        </div>
    );
}

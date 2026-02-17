"use client";

import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useLocale } from 'next-intl';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useTransition } from 'react';
import { Loader2 } from 'lucide-react';

export default function PreferencesSettingsPage() {
    const t = useTranslations();
    const router = useRouter();
    const pathname = usePathname();
    const locale = useLocale();
    const [isPending, startTransition] = useTransition();

    const handleLanguageChange = (newLocale: string) => {
        startTransition(() => {
            router.replace(pathname, { locale: newLocale });
        });
    };

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium">{t('settings.preferences')}</h3>
                <p className="text-sm text-muted-foreground">
                    {t('settings.languageDescription')}
                </p>
            </div>

            <div className="rounded-lg border bg-card p-6 space-y-8 max-w-lg">
                <div className="space-y-3">
                    <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                        {t('settings.selectLanguage')}
                    </label>
                    <div className="flex items-center gap-4">
                        <Select
                            value={locale}
                            onValueChange={handleLanguageChange}
                            disabled={isPending}
                        >
                            <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder={t('settings.selectLanguage')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="en">{t('settings.english')}</SelectItem>
                                <SelectItem value="es">{t('settings.spanish')}</SelectItem>
                            </SelectContent>
                        </Select>
                        {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>
                </div>
            </div>
        </div>
    );
}

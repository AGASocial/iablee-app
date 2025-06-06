"use client";

import { useRouter, usePathname } from '@/i18n/navigation';
import { useLocale } from 'next-intl';
import { Button } from './ui/button';

export default function LanguageSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();

  const switchLocale = (newLocale: string) => {
    router.replace(pathname, { locale: newLocale });
  };

  return (
    <div className="flex gap-2">
      <Button
        variant={locale === 'en' ? 'default' : 'outline'}
        onClick={() => switchLocale('en')}
        size="sm"
      >
        EN
      </Button>
      <Button
        variant={locale === 'es' ? 'default' : 'outline'}
        onClick={() => switchLocale('es')}
        size="sm"
      >
        ES
      </Button>
    </div>
  );
} 
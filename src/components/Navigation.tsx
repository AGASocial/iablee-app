'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export default function Navigation({ closeSidebar }: { closeSidebar?: () => void }) {
  const t = useTranslations();
  
  return (
    <nav className="flex-1 p-4">
      <ul className="space-y-2">
        <li>
          <Link href="/dashboard" className="flex items-center p-2 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg" onClick={closeSidebar}>
            {t('dashboard')}
          </Link>
        </li>
        <li>
          <Link href="/digital-assets" className="flex items-center p-2 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg" onClick={closeSidebar}>
            {t('digitalAssets')}
          </Link>
        </li>
        <li>
          <Link href="/beneficiaries" className="flex items-center p-2 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg" onClick={closeSidebar}>
            {t('beneficiaries')}
          </Link>
        </li>
        <li>
          <Link href="/billing" className="flex items-center p-2 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg" onClick={closeSidebar}>
            {t('billing')}
          </Link>
        </li>
        <li>
          <Link href="/wizard" className="flex items-center p-2 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg" onClick={closeSidebar}>
            {t('setupWizard')}
          </Link>
        </li>
      </ul>
    </nav>
  );
} 
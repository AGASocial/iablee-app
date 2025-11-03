'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export default function Navigation({ closeSidebar }: { closeSidebar?: () => void }) {
  const t = useTranslations();
  
  return (
    <nav className="flex-1 p-4">
      <ul className="space-y-1">
        <li>
          <Link 
            href="/dashboard" 
            className="flex items-center p-3 text-foreground hover:bg-accent hover:text-accent-foreground rounded-lg transition-colors font-medium hover-lift" 
            onClick={closeSidebar}
          >
            {t('dashboard')}
          </Link>
        </li>
        <li>
          <Link 
            href="/digital-assets" 
            className="flex items-center p-3 text-foreground hover:bg-accent hover:text-accent-foreground rounded-lg transition-colors font-medium hover-lift" 
            onClick={closeSidebar}
          >
            {t('digitalAssets')}
          </Link>
        </li>
        <li>
          <Link 
            href="/beneficiaries" 
            className="flex items-center p-3 text-foreground hover:bg-accent hover:text-accent-foreground rounded-lg transition-colors font-medium hover-lift" 
            onClick={closeSidebar}
          >
            {t('beneficiaries')}
          </Link>
        </li>
        <li>
          <Link 
            href="/billing" 
            className="flex items-center p-3 text-foreground hover:bg-accent hover:text-accent-foreground rounded-lg transition-colors font-medium hover-lift" 
            onClick={closeSidebar}
          >
            {t('billing')}
          </Link>
        </li>
        <li>
          <Link 
            href="/wizard" 
            className="flex items-center p-3 text-primary hover:bg-primary/10 rounded-lg transition-colors font-medium hover-lift" 
            onClick={closeSidebar}
          >
            {t('setupWizard')}
          </Link>
        </li>
      </ul>
    </nav>
  );
} 
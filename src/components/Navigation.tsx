'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { LayoutDashboard, Wallet, Users, CreditCard, Wand2, Heart } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Navigation({ closeSidebar, collapsed }: { closeSidebar?: () => void; collapsed?: boolean }) {
  const t = useTranslations();
  const pathname = usePathname();

  const navItems = [
    { href: '/dashboard', label: t('dashboard'), icon: LayoutDashboard },
    { href: '/digital-assets', label: t('digitalAssets'), icon: Wallet },
    { href: '/beneficiaries', label: t('beneficiaries'), icon: Users },
    { href: '/my-beneficiary-relationships', label: t('myBeneficiaryRelationships'), icon: Heart },
    { href: '/billing', label: t('billing'), icon: CreditCard },
  ];

  return (
    <nav className="space-y-6">
      <ul className="space-y-1">
        {navItems.map((item) => {
          const isActive = pathname?.includes(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={closeSidebar}
                className={cn(
                  "group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-300 relative overflow-hidden",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-sm"
                    : "text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-sidebar-accent/10",
                  collapsed && "justify-center px-2"
                )}
                title={collapsed ? item.label : undefined}
              >
                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-sidebar-primary rounded-r-full" />
                )}
                <item.icon className={cn(
                  "h-5 w-5 transition-transform duration-300 shrink-0",
                  isActive ? "text-sidebar-accent-foreground scale-110" : "text-sidebar-foreground/70 group-hover:text-sidebar-foreground group-hover:scale-110"
                )} />
                <span className={cn(
                  "text-sm transition-all duration-300 overflow-hidden whitespace-nowrap",
                  collapsed ? "w-0 opacity-0" : "w-auto opacity-100",
                  isActive ? "font-semibold" : "font-medium"
                )}>
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Secondary Section */}
      <div className={cn(
        "pt-4 mt-4 border-t border-sidebar-border transition-all duration-300",
        collapsed && "border-transparent"
      )}>
        <ul className="space-y-1">
          <li>
            <Link
              href="/wizard"
              onClick={closeSidebar}
              className={cn(
                "group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-sidebar-accent/10 transition-all",
                collapsed && "justify-center px-2"
              )}
              title={collapsed ? t('setupWizard') : undefined}
            >
              <Wand2 className="h-5 w-5 text-sidebar-icon group-hover:text-sidebar-icon/90 shrink-0" />
              <span className={cn(
                "font-medium text-sm transition-all duration-300 overflow-hidden whitespace-nowrap",
                collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
              )}>
                {t('setupWizard')}
              </span>
            </Link>
          </li>
        </ul>
      </div>
    </nav>
  );
} 
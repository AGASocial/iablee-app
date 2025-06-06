"use client";
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";

export default function DashboardPage() {
  const t = useTranslations();

  return (
    <div className="flex-1 space-y-8 p-8 pt-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <h2 className="text-3xl font-bold tracking-tight">{t('dashboard')}</h2>
      </div>
      <div className="grid gap-6 grid-cols-2 lg:grid-cols-2">
        <Card className="shadow-lg mb-6">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>{t('yourDigitalAssets')}</CardTitle>
              <CardDescription>{t('overviewDigitalAssets')}</CardDescription>
            </div>
            <Button variant="outline" size="sm" className="flex items-center gap-2">
              <PlusCircle className="h-4 w-4" /> {t('addAsset')}
            </Button>
          </CardHeader>
          <CardContent>
            <p className="text-center text-sm text-muted-foreground">
              {t('noAssets')}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
} 
"use client";

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ProtectedRoute } from '@/components/ProtectedRoute';

type WizardStep = 'welcome' | 'asset-type' | 'asset-details' | 'beneficiary' | 'final';

export default function WizardPage() {
  const t = useTranslations();
  const { user } = useAuth();
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<WizardStep>('welcome');
  const [loading, setLoading] = useState(false);
  const [relationships, setRelationships] = useState<Array<{id: number, key: string}>>([]);
  
  // Asset form data
  const [assetData, setAssetData] = useState({
    assetType: '',
    assetName: '',
    description: '',
    website: '',
    validUntil: '',
    email: '',
    password: ''
  });

  // Beneficiary form data
  const [beneficiaryData, setBeneficiaryData] = useState({
    fullName: '',
    email: '',
    relationshipId: null as number | null,
    phoneNumber: '',
    notes: ''
  });

  const assetTypes = [
    { value: 'bankAccount', label: t('bankAccount') },
    { value: 'lifeInsurance', label: t('lifeInsurance') },
    { value: 'insurance', label: t('insurance') },
    { value: 'retirementPlan', label: t('retirementPlan') },
    { value: 'realEstate', label: t('realEstate') },
    { value: 'companyStocks', label: t('companyStocks') },
    { value: 'rsus', label: t('rsus') },
    { value: 'stockOptions', label: t('stockOptions') },
    { value: 'companyShares', label: t('companyShares') },
    { value: 'cryptocurrency', label: t('cryptocurrency') },
    { value: 'safetyBox', label: t('safetyBox') },
    { value: 'other', label: t('other') }
  ];

  // Fetch relationships from database
  useEffect(() => {
    async function fetchRelationships() {
      const { data, error } = await supabase.from('relationships').select('id, key').order('generation_level, key');
      if (!error && data) setRelationships(data);
    }
    fetchRelationships();
  }, []);

  const handleNext = () => {
    switch (currentStep) {
      case 'welcome':
        setCurrentStep('asset-type');
        break;
      case 'asset-type':
        setCurrentStep('asset-details');
        break;
      case 'asset-details':
        setCurrentStep('beneficiary');
        break;
      case 'beneficiary':
        setCurrentStep('final');
        break;
      case 'final':
        handleFinish();
        break;
    }
  };

  const handleBack = () => {
    switch (currentStep) {
      case 'asset-type':
        setCurrentStep('welcome');
        break;
      case 'asset-details':
        setCurrentStep('asset-type');
        break;
      case 'beneficiary':
        setCurrentStep('asset-details');
        break;
      case 'final':
        setCurrentStep('beneficiary');
        break;
    }
  };

  const handleFinish = async () => {
    setLoading(true);
    try {
      // Create the asset
      const { data: asset, error: assetError } = await supabase
        .from('digital_assets')
        .insert({
          user_id: user?.id,
          asset_type: assetData.assetType,
          asset_name: assetData.assetName,
          description: assetData.description || null,
          website: assetData.website || null,
          valid_until: assetData.validUntil || null,
          email: assetData.email || null,
          password: assetData.password || null,
          status: 'unassigned'
        })
        .select()
        .single();

      if (assetError) {
        console.error('Asset creation error:', assetError);
        throw assetError;
      }

      // Create the beneficiary
      const { data: beneficiary, error: beneficiaryError } = await supabase
        .from('beneficiaries')
        .insert({
          user_id: user?.id,
          full_name: beneficiaryData.fullName,
          email: beneficiaryData.email || null,
          relationship_id: beneficiaryData.relationshipId,
          phone_number: beneficiaryData.phoneNumber || null,
          notes: beneficiaryData.notes || null,
          status: 'active'
        })
        .select()
        .single();

      if (beneficiaryError) {
        console.error('Beneficiary creation error:', beneficiaryError);
        throw beneficiaryError;
      }

      // Link beneficiary to asset
      const { error: linkError } = await supabase
        .from('digital_assets')
        .update({ beneficiary_id: beneficiary.id, status: 'assigned' })
        .eq('id', asset.id);

      if (linkError) {
        console.error('Link error:', linkError);
        throw linkError;
      }

      toast.success(t('wizard-final-congrats'));
      router.push('/dashboard');
    } catch (error) {
      console.error('Error creating asset and beneficiary:', error);
      toast.error('An error occurred while creating your asset and beneficiary.');
    } finally {
      setLoading(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 'welcome':
        return (
          <div className="text-center px-4 sm:px-0">
            <h1 className="text-xl sm:text-2xl font-bold mb-4">
              {t('wizard-welcome-title', { name: user?.user_metadata?.full_name || user?.email || 'User' })}
            </h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 mb-6">
              {t('wizard-welcome-description')}
            </p>
            <Button onClick={handleNext} className="w-full sm:w-auto px-8">
              {t('wizard-continue')}
            </Button>
          </div>
        );

      case 'asset-type':
        return (
          <div className="px-4 sm:px-0">
            <h1 className="text-xl sm:text-2xl font-bold mb-4">{t('wizard-create-asset-title')}</h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 mb-6">
              {t('wizard-create-asset-description')}
            </p>
            <div className="space-y-4">
              <Label className="text-sm sm:text-base">{t('wizard-select-asset-type')}</Label>
              <Select value={assetData.assetType} onValueChange={(value: string) => setAssetData({...assetData, assetType: value})}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('chooseAssetType')} />
                </SelectTrigger>
                <SelectContent>
                  {assetTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 mt-6">
              <Button variant="outline" onClick={handleBack} className="flex-1">
                {t('back')}
              </Button>
              <Button onClick={handleNext} disabled={!assetData.assetType} className="flex-1">
                {t('wizard-next')}
              </Button>
            </div>
          </div>
        );

      case 'asset-details':
        return (
          <div className="px-4 sm:px-0">
            <h1 className="text-xl sm:text-2xl font-bold mb-4">{t('wizard-complete-asset-title')}</h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 mb-6">
              {t('wizard-complete-asset-description')}
            </p>
            <div className="space-y-4">
              <div>
                <Label className="text-sm sm:text-base">{t('assetName')}</Label>
                <Input
                  value={assetData.assetName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAssetData({...assetData, assetName: e.target.value})}
                  placeholder="Enter asset name"
                  className="w-full"
                />
              </div>
              <div>
                <Label className="text-sm sm:text-base">{t('description')}</Label>
                <Textarea
                  value={assetData.description}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAssetData({...assetData, description: e.target.value})}
                  placeholder="Describe your asset"
                  className="w-full"
                />
              </div>
              <div>
                <Label className="text-sm sm:text-base">{t('website')}</Label>
                <Input
                  value={assetData.website}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAssetData({...assetData, website: e.target.value})}
                  placeholder="https://example.com"
                  className="w-full"
                />
              </div>
              <div>
                <Label className="text-sm sm:text-base">{t('validUntil')}</Label>
                <Input
                  type="date"
                  value={assetData.validUntil}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAssetData({...assetData, validUntil: e.target.value})}
                  className="w-full"
                />
              </div>
              <div>
                <Label className="text-sm sm:text-base">{t('email')}</Label>
                <Input
                  value={assetData.email}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAssetData({...assetData, email: e.target.value})}
                  placeholder="email@example.com"
                  className="w-full"
                />
              </div>
              <div>
                <Label className="text-sm sm:text-base">{t('password')}</Label>
                <Input
                  type="password"
                  value={assetData.password}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAssetData({...assetData, password: e.target.value})}
                  placeholder="••••••••"
                  className="w-full"
                />
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 mt-6">
              <Button variant="outline" onClick={handleBack} className="flex-1">
                {t('back')}
              </Button>
              <Button onClick={handleNext} disabled={!assetData.assetName} className="flex-1">
                {t('wizard-next')}
              </Button>
            </div>
          </div>
        );

      case 'beneficiary':
        return (
          <div className="px-4 sm:px-0">
            <h1 className="text-xl sm:text-2xl font-bold mb-4">{t('wizard-beneficiary-title')}</h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 mb-6">
              {t('wizard-beneficiary-description')}
            </p>
            <div className="space-y-4">
              <div>
                <Label className="text-sm sm:text-base">{t('name')} *</Label>
                <Input
                  value={beneficiaryData.fullName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBeneficiaryData({...beneficiaryData, fullName: e.target.value})}
                  placeholder="Enter beneficiary name"
                  className="w-full"
                />
              </div>
              <div>
                <Label className="text-sm sm:text-base">{t('email')}</Label>
                <Input
                  value={beneficiaryData.email}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBeneficiaryData({...beneficiaryData, email: e.target.value})}
                  placeholder="email@example.com"
                  className="w-full"
                />
              </div>
              <div>
                <Label className="text-sm sm:text-base">{t('relationship')} *</Label>
                <Select value={beneficiaryData.relationshipId?.toString() || ''} onValueChange={(value: string) => setBeneficiaryData({...beneficiaryData, relationshipId: value ? parseInt(value) : null})}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select relationship" />
                  </SelectTrigger>
                  <SelectContent>
                    {relationships.map((rel) => (
                      <SelectItem key={rel.id} value={rel.id.toString()}>
                        {t(`relationships.${rel.key}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm sm:text-base">{t('phoneNumber')}</Label>
                <Input
                  value={beneficiaryData.phoneNumber}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBeneficiaryData({...beneficiaryData, phoneNumber: e.target.value})}
                  placeholder="+1 (555) 123-4567"
                  className="w-full"
                />
              </div>
              <div>
                <Label className="text-sm sm:text-base">{t('notes')}</Label>
                <Textarea
                  value={beneficiaryData.notes}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBeneficiaryData({...beneficiaryData, notes: e.target.value})}
                  placeholder="Additional notes about this beneficiary"
                  className="w-full"
                />
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 mt-6">
              <Button variant="outline" onClick={handleBack} className="flex-1">
                {t('back')}
              </Button>
              <Button onClick={handleNext} disabled={!beneficiaryData.fullName || !beneficiaryData.relationshipId} className="flex-1">
                {t('wizard-next')}
              </Button>
            </div>
          </div>
        );

      case 'final':
        return (
          <div className="text-center px-4 sm:px-0">
            <h1 className="text-xl sm:text-2xl font-bold mb-4">{t('wizard-final-title')}</h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 mb-6">
              {t('wizard-final-congrats')}
            </p>
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 mb-6 text-left">
              <h3 className="font-semibold mb-2 text-sm sm:text-base">Asset Summary:</h3>
              <div className="space-y-1 text-sm">
                <p><strong>{t('assetType')}:</strong> {assetTypes.find(t => t.value === assetData.assetType)?.label}</p>
                <p><strong>{t('assetName')}:</strong> {assetData.assetName}</p>
                <p><strong>{t('description')}:</strong> {assetData.description}</p>
                <p><strong>{t('website')}:</strong> {assetData.website}</p>
                <p><strong>{t('assignedBeneficiary')}:</strong> {beneficiaryData.fullName}</p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={handleBack} className="flex-1">
                {t('back')}
              </Button>
              <Button onClick={handleFinish} disabled={loading} className="flex-1">
                {loading ? t('saving') : t('wizard-finish')}
              </Button>
            </div>
          </div>
        );
    }
  };

  return (
    <ProtectedRoute>
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-8">
        <div className="mb-6 sm:mb-8">
          {/* Mobile: Current step indicator only */}
          <div className="block sm:hidden mb-6">
            <div className="flex items-center justify-center">
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center text-lg font-medium mx-auto mb-2">
                  {['welcome', 'asset-type', 'asset-details', 'beneficiary', 'final'].indexOf(currentStep) + 1}
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Step {['welcome', 'asset-type', 'asset-details', 'beneficiary', 'final'].indexOf(currentStep) + 1} of 5
                </p>
              </div>
            </div>
          </div>
          
          {/* Desktop: Horizontal step indicator */}
          <div className="hidden sm:flex items-center justify-center mb-4">
            <div className="flex items-center space-x-6">
              {['welcome', 'asset-type', 'asset-details', 'beneficiary', 'final'].map((step, index) => (
                <div key={step} className="flex items-center">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center text-base font-medium ${
                    currentStep === step 
                      ? 'bg-blue-600 text-white' 
                      : index < ['welcome', 'asset-type', 'asset-details', 'beneficiary', 'final'].indexOf(currentStep)
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-200 text-gray-600'
                  }`}>
                    {index + 1}
                  </div>
                  {index < 4 && (
                    <div className={`w-24 h-1 mx-3 ${
                      index < ['welcome', 'asset-type', 'asset-details', 'beneficiary', 'final'].indexOf(currentStep)
                        ? 'bg-green-600'
                        : 'bg-gray-200'
                    }`} />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        {renderStep()}
      </div>
    </ProtectedRoute>
  );
}

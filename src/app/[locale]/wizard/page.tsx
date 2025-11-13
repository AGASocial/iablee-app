"use client";

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { getAvailableAssetTypes, getAssetType, type AssetType as DatabaseAssetType } from '@/lib/assetTypes';

type WizardStep = 'welcome' | 'asset-type' | 'asset-details' | 'beneficiary' | 'final';

export default function WizardPage() {
  const t = useTranslations();
  const { user } = useAuth();
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<WizardStep>('welcome');
  const [loading, setLoading] = useState(false);
  const [assetTypesLoading, setAssetTypesLoading] = useState(true);
  const [relationships, setRelationships] = useState<Array<{id: number, key: string}>>([]);
  const [assetTypes, setAssetTypes] = useState<DatabaseAssetType[]>([]);
  const [currentAssetType, setCurrentAssetType] = useState<DatabaseAssetType | null>(null);

  // Asset form data
  const [assetData, setAssetData] = useState({
    assetType: '',
    assetName: '',
    description: '',
    website: '',
    validUntil: '',
    email: '',
    password: '',
    files: [] as File[],
    customFields: {} as Record<string, string | number | boolean | string[]>,
  });

  // Beneficiary form data
  const [beneficiaryData, setBeneficiaryData] = useState({
    fullName: '',
    email: '',
    relationshipId: null as number | null,
    phoneNumber: '',
    notes: ''
  });

  // Fetch relationships and asset types from database
  useEffect(() => {
    async function fetchRelationships() {
      const { data, error } = await supabase.from('relationships').select('id, key').order('generation_level, key');
      if (!error && data) setRelationships(data);
    }

    async function fetchAssetTypes() {
      try {
        setAssetTypesLoading(true);
        const availableAssetTypes = await getAvailableAssetTypes();
        setAssetTypes(availableAssetTypes);
      } catch (error) {
        console.error('Error fetching asset types:', error);
        toast.error('Failed to load asset types');
      } finally {
        setAssetTypesLoading(false);
      }
    }

    fetchRelationships();
    fetchAssetTypes();
  }, []);

  // Fetch current asset type when asset type changes
  useEffect(() => {
    async function fetchCurrentAssetType() {
      if (assetData.assetType) {
        try {
          const assetTypeData = await getAssetType(assetData.assetType);
          setCurrentAssetType(assetTypeData || null);
        } catch (error) {
          console.error('Error fetching asset type:', error);
          setCurrentAssetType(null);
        }
      } else {
        setCurrentAssetType(null);
      }
    }

    fetchCurrentAssetType();
  }, [assetData.assetType]);

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

  // Helper function to check if a field should be shown
  const shouldShowField = (fieldName: string): boolean => {
    if (!currentAssetType) return true;

    const isRequired = currentAssetType.requiredFields?.includes(fieldName);
    const isOptional = currentAssetType.optionalFields?.includes(fieldName);

    return isRequired || isOptional || false;
  };

  // Helper function to check if a field is required
  const isFieldRequired = (fieldName: string): boolean => {
    if (!currentAssetType) return false;
    return currentAssetType.requiredFields?.includes(fieldName) || false;
  };

  const handleCustomFieldChange = (fieldKey: string, value: string | number | boolean | string[]) => {
    setAssetData(prev => ({
      ...prev,
      customFields: {
        ...prev.customFields,
        [fieldKey]: value
      }
    }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files).slice(0, 5);
      setAssetData(prev => ({ ...prev, files }));
    }
  };

  const handleFinish = async () => {
    setLoading(true);
    try {
      // Upload files if any
      const fileUrls: string[] = [];
      if (assetData.files.length > 0) {
        for (const file of assetData.files) {
          // Sanitize file name
          const safeFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
          const filePath = `${user?.id}/${Date.now()}-${safeFileName}`;
          const { data, error } = await supabase.storage.from('assets').upload(filePath, file);
          if (error) {
            console.error('Upload error:', error);
            throw error;
          }
          fileUrls.push(data.path);
        }
      }

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
          files: fileUrls.length > 0 ? fileUrls : null,
          custom_fields: Object.keys(assetData.customFields).length > 0 ? assetData.customFields : null,
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
            <h1 className="text-xl sm:text-2xl font-bold mb-4 dark:text-white">
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
            <h1 className="text-xl sm:text-2xl font-bold mb-4 dark:text-white">{t('wizard-create-asset-title')}</h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 mb-6">
              {t('wizard-create-asset-description')}
            </p>
            <div className="space-y-4">
              <Label className="text-sm sm:text-base dark:text-white">{t('wizard-select-asset-type')}</Label>
              <Select value={assetData.assetType} onValueChange={(value: string) => setAssetData({...assetData, assetType: value})}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('wizard-select-asset-type')} />
                </SelectTrigger>
                <SelectContent>
                  {assetTypesLoading ? (
                    <SelectItem value="" disabled>
                      Loading asset types...
                    </SelectItem>
                  ) : (
                    assetTypes.map((type) => (
                      <SelectItem key={type.key} value={type.key}>
                        {t(type.label)}
                      </SelectItem>
                    ))
                  )}
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
            <h1 className="text-xl sm:text-2xl font-bold mb-4 dark:text-white">{t('wizard-complete-asset-title')}</h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 mb-6">
              {t('wizard-complete-asset-description')}
            </p>
            <div className="space-y-4">
              {/* Asset Name - always required */}
              <div>
                <Label className="text-sm sm:text-base dark:text-white">{t('assetName')} *</Label>
                <Input
                  value={assetData.assetName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAssetData({...assetData, assetName: e.target.value})}
                  placeholder={t('wizard-enter-asset-name')}
                  className="w-full"
                  required
                />
              </div>

              {/* Conditional fields based on asset type */}
              {shouldShowField('email') && (
                <div>
                  <Label className="text-sm sm:text-base dark:text-white">
                    {t('email')}{isFieldRequired('email') ? ' *' : ''}
                  </Label>
                  <Input
                    value={assetData.email}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAssetData({...assetData, email: e.target.value})}
                    placeholder={t('wizard-enter-email')}
                    type="email"
                    className="w-full"
                    required={isFieldRequired('email')}
                  />
                </div>
              )}

              {shouldShowField('password') && (
                <div>
                  <Label className="text-sm sm:text-base dark:text-white">
                    {t('password')}{isFieldRequired('password') ? ' *' : ''}
                  </Label>
                  <Input
                    value={assetData.password}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAssetData({...assetData, password: e.target.value})}
                    placeholder="••••••••"
                    type="password"
                    className="w-full"
                    required={isFieldRequired('password')}
                  />
                </div>
              )}

              {shouldShowField('website') && (
                <div>
                  <Label className="text-sm sm:text-base dark:text-white">
                    {t('website')}{isFieldRequired('website') ? ' *' : ''}
                  </Label>
                  <Input
                    value={assetData.website}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAssetData({...assetData, website: e.target.value})}
                    placeholder={t('wizard-enter-website')}
                    className="w-full"
                    required={isFieldRequired('website')}
                  />
                </div>
              )}

              {shouldShowField('valid_until') && (
                <div>
                  <Label className="text-sm sm:text-base dark:text-white">
                    {t('validUntil')}{isFieldRequired('valid_until') ? ' *' : ''}
                  </Label>
                  <Input
                    type="date"
                    value={assetData.validUntil}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAssetData({...assetData, validUntil: e.target.value})}
                    className="w-full"
                    required={isFieldRequired('valid_until')}
                  />
                </div>
              )}

              {shouldShowField('description') && (
                <div>
                  <Label className="text-sm sm:text-base dark:text-white">
                    {t('description')}{isFieldRequired('description') ? ' *' : ''}
                  </Label>
                  <Textarea
                    value={assetData.description}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAssetData({...assetData, description: e.target.value})}
                    placeholder={t('wizard-describe-asset')}
                    className="w-full"
                    required={isFieldRequired('description')}
                  />
                </div>
              )}

              {/* Custom fields for new asset types */}
              {currentAssetType?.customFields?.map((field) => (
                <div key={field.key}>
                  <Label className="text-sm sm:text-base dark:text-white">
                    {t(field.label)}{field.required ? ' *' : ''}
                  </Label>
                  {field.type === 'text' && (
                    <Input
                      type="text"
                      value={String(assetData.customFields[field.key] || '')}
                      onChange={(e) => handleCustomFieldChange(field.key, e.target.value)}
                      required={field.required}
                      className="w-full"
                    />
                  )}
                  {field.type === 'textarea' && (
                    <Textarea
                      value={String(assetData.customFields[field.key] || '')}
                      onChange={(e) => handleCustomFieldChange(field.key, e.target.value)}
                      required={field.required}
                      className="w-full"
                      rows={3}
                    />
                  )}
                  {field.type === 'select' && (
                    <Select
                      value={String(assetData.customFields[field.key] || '')}
                      onValueChange={(value) => handleCustomFieldChange(field.key, value)}
                      required={field.required}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Seleccionar..." />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options?.map((option) => (
                          <SelectItem key={option} value={option}>{option}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              ))}

              {/* File upload for assets that support it */}
              {currentAssetType?.fileAccept && (
                <div>
                  <Label className="text-sm sm:text-base dark:text-white">
                    {assetData.assetType === 'letter' ? t('attachAnImage') :
                     assetData.assetType === 'photo' ? t('cameraPhotos') :
                     assetData.assetType === 'video' ? t('cameraVideos') :
                     assetData.assetType === 'audio' ? t('recordHereOrUpload') :
                     assetData.assetType === 'document' ? t('uploadFiles') :
                        t('uploadFiles')}
                  </Label>
                  <input
                    type="file"
                    multiple
                    accept={currentAssetType?.fileAccept || '*'}
                    onChange={handleFileChange}
                    className="w-full rounded border px-3 py-2"
                  />
                </div>
              )}
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
            <h1 className="text-xl sm:text-2xl font-bold mb-4 dark:text-white">{t('wizard-beneficiary-title')}</h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-white mb-6">
              {t('wizard-beneficiary-description')}
            </p>
            <div className="space-y-4">
              <div>
                <Label className="text-sm sm:text-base dark:text-white">{t('name')} *</Label>
                <Input
                  value={beneficiaryData.fullName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBeneficiaryData({...beneficiaryData, fullName: e.target.value})}
                  placeholder={t('wizard-enter-beneficiary-name')}
                  className="w-full"
                />
              </div>
              <div>
                <Label className="text-sm sm:text-base dark:text-white">{t('email')}</Label>
                <Input
                  value={beneficiaryData.email}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBeneficiaryData({...beneficiaryData, email: e.target.value})}
                  placeholder="email@example.com"
                  className="w-full"
                />
              </div>
              <div>
                <Label className="text-sm sm:text-base dark:text-white">{t('relationship')} *</Label>
                <Select value={beneficiaryData.relationshipId?.toString() || ''} onValueChange={(value: string) => setBeneficiaryData({...beneficiaryData, relationshipId: value ? parseInt(value) : null})}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('wizard-select-relationship')} />
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
                <Label className="text-sm sm:text-base dark:text-white">{t('phoneNumber')}</Label>
                <Input
                  value={beneficiaryData.phoneNumber}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBeneficiaryData({...beneficiaryData, phoneNumber: e.target.value})}
                  placeholder="+1 (555) 123-4567"
                  className="w-full"
                />
              </div>
              <div>
                <Label className="text-sm sm:text-base dark:text-white">{t('notes')}</Label>
                <Textarea
                  value={beneficiaryData.notes}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBeneficiaryData({...beneficiaryData, notes: e.target.value})}
                  placeholder={t('wizard-enter-beneficiary-notes')}
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
          <div className="text-center px-4 sm:px-0 dark:text-white">
            <h1 className="text-xl sm:text-2xl font-bold mb-4">{t('wizard-final-title')}</h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-white mb-6">
              {t('wizard-final-congrats')}
            </p>
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 mb-6 text-left">
              <h3 className="font-semibold mb-2 text-sm sm:text-base">{t('wizard-asset-summary')}:</h3>
              <div className="space-y-1 text-sm">
                <p><strong>{t('assetType')}:</strong> {assetTypes.find(t => t.key === assetData.assetType)?.label ? t(assetTypes.find(t => t.key === assetData.assetType)!.label) : assetData.assetType}</p>
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

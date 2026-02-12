"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import type { Asset } from "@/models/asset";
import { getAssetType, type AssetType } from "@/lib/assetTypes";
import { Loader2 } from "lucide-react";

export default function AddAssetForm({ assetType, onSuccess, onCancel, asset }: { assetType: string, onSuccess: () => void, onCancel: () => void, asset?: Asset }) {
  const t = useTranslations();
  const [form, setForm] = useState({
    asset_name: "",
    email: "",
    password: "",
    website: "",
    valid_until: "",
    description: "",
    files: [] as File[],
    customFields: {} as Record<string, string | number | boolean | string[]>,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentAssetType, setCurrentAssetType] = useState<AssetType | null>(null);
  const [assetTypeLoading, setAssetTypeLoading] = useState(true);

  useEffect(() => {
    if (asset) {
      setForm({
        asset_name: asset.asset_name || "",
        email: asset.email || "",
        password: asset.password || "",
        website: asset.website || "",
        valid_until: asset.valid_until ? asset.valid_until.split('T')[0] : "",
        description: asset.description || "",
        files: [], // Existing files not handled for now
        customFields: asset.custom_fields || {},
      });
    }
  }, [asset]);

  // Fetch asset type information
  useEffect(() => {
    async function fetchAssetType() {
      try {
        setAssetTypeLoading(true);
        const assetTypeData = await getAssetType(assetType);
        setCurrentAssetType(assetTypeData || null);
      } catch (error) {
        console.error('Error fetching asset type:', error);
        setError('Failed to load asset type information');
      } finally {
        setAssetTypeLoading(false);
      }
    }

    fetchAssetType();
  }, [assetType]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleCustomFieldChange = (fieldKey: string, value: string | number | boolean | string[]) => {
    setForm(prev => ({
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
      console.log('Files selected:', files.length, files.map(f => f.name));
      setForm(prev => ({ ...prev, files }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    console.log('Submitting asset:', {
      form: form,
      asset: asset,
    });
    try {

      const { data: { user } } = await supabase.auth.getUser();

      if (!user) throw new Error("Not authenticated");

      // Upload files if any
      const fileUrls: string[] = [];
      console.log('Files to upload:', form.files.length, form.files);
      if (form.files.length > 0) {
        for (const file of form.files) {
          // Sanitize file name
          const safeFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
          const filePath = `${user.id}/${Date.now()}-${safeFileName}`;
          console.log('Uploading file:', file.name, 'to path:', filePath);
          const { data, error } = await supabase.storage.from('assets').upload(filePath, file);
          if (error) {
            console.error('Upload error:', error);
            throw error;
          }
          console.log('Upload successful:', data.path);
          fileUrls.push(data.path);
        }
      }
      console.log('All uploaded file URLs:', fileUrls);


      if (asset) {
        // Update existing asset - merge existing files with new files
        const existingFiles = asset.files || [];
        const allFiles = [...existingFiles, ...fileUrls];
        console.log('Existing files:', existingFiles);
        console.log('New files:', fileUrls);
        console.log('Combined files:', allFiles);

        const updateData = {
          asset_type: asset.asset_type,
          asset_name: form.asset_name,
          email: form.email,
          password: form.password,
          website: form.website,
          valid_until: form.valid_until ? form.valid_until : null,
          description: form.description,
          files: allFiles.length > 0 ? allFiles : null,
          custom_fields: Object.keys(form.customFields).length > 0 ? form.customFields : null,
        };
        console.log('Updating asset with data:', updateData);
        const { error: updateError } = await supabase.from('digital_assets').update(updateData).eq('id', asset.id);
        console.log('updateError', updateError);
        if (updateError) throw updateError;
      } else {
        // Insert new asset
        const insertData = {
          user_id: user.id,
          asset_type: assetType,
          asset_name: form.asset_name,
          email: form.email,
          password: form.password,
          website: form.website,
          valid_until: form.valid_until ? form.valid_until : null,
          description: form.description,
          files: fileUrls.length > 0 ? fileUrls : null,
          custom_fields: Object.keys(form.customFields).length > 0 ? form.customFields : null,
        };
        console.log('Inserting asset with data:', insertData);
        const { error: insertError } = await supabase.from('digital_assets').insert(insertData);
        if (insertError) throw insertError;
      }
      onSuccess();
    } catch (err: unknown) {
      const error = err as Error;
      setError(error.message || "Error adding asset");
    } finally {
      setLoading(false);
    }
  };

  // Helper function to check if a field should be shown
  const shouldShowField = (fieldName: string): boolean => {
    if (assetTypeLoading || !currentAssetType) return true;

    const isRequired = currentAssetType.requiredFields?.includes(fieldName);
    const isOptional = currentAssetType.optionalFields?.includes(fieldName);

    return isRequired || isOptional || false;
  };

  // Helper function to check if a field is required
  const isFieldRequired = (fieldName: string): boolean => {
    if (assetTypeLoading || !currentAssetType) return false;
    return currentAssetType.requiredFields?.includes(fieldName) || false;
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-full py-2">
      <div className="space-y-2">
        <Label htmlFor="asset_name">{t('assetName')}</Label>
        <Input
          id="asset_name"
          name="asset_name"
          value={form.asset_name}
          onChange={handleChange}
          required
          className="bg-background/50 border-white/10 focus:border-primary/50"
        />
      </div>

      {/* Conditional fields based on asset type */}
      {shouldShowField('email') && (
        <div className="space-y-2">
          <Label htmlFor="email">{t('email')}</Label>
          <Input
            id="email"
            name="email"
            value={form.email}
            onChange={handleChange}
            type="email"
            required={isFieldRequired('email')}
            className="bg-background/50 border-white/10 focus:border-primary/50"
          />
        </div>
      )}

      {shouldShowField('password') && (
        <div className="space-y-2">
          <Label htmlFor="password">{t('password')}</Label>
          <Input
            id="password"
            name="password"
            value={form.password}
            onChange={handleChange}
            type="password"
            required={isFieldRequired('password')}
            className="bg-background/50 border-white/10 focus:border-primary/50"
          />
        </div>
      )}

      {shouldShowField('website') && (
        <div className="space-y-2">
          <Label htmlFor="website">{t('website')}</Label>
          <Input
            id="website"
            name="website"
            value={form.website}
            onChange={handleChange}
            required={isFieldRequired('website')}
            className="bg-background/50 border-white/10 focus:border-primary/50"
          />
        </div>
      )}

      {shouldShowField('valid_until') && (
        <div className="space-y-2">
          <Label htmlFor="valid_until">{t('validUntil')}</Label>
          <Input
            id="valid_until"
            name="valid_until"
            value={form.valid_until}
            onChange={handleChange}
            type="date"
            required={isFieldRequired('valid_until')}
            className="bg-background/50 border-white/10 focus:border-primary/50"
          />
        </div>
      )}

      {shouldShowField('description') && (
        <div className="space-y-2">
          <Label htmlFor="description">{t('description')}</Label>
          <Textarea
            id="description"
            name="description"
            value={form.description}
            onChange={handleChange}
            required={isFieldRequired('description')}
            className="bg-background/50 border-white/10 focus:border-primary/50 min-h-[80px]"
          />
        </div>
      )}

      {/* Custom fields for new asset types */}
      {currentAssetType?.customFields?.map((field) => (
        <div key={field.key} className="space-y-2">
          <Label htmlFor={field.key}>{t(field.label)}</Label>
          {field.type === 'text' && (
            <Input
              id={field.key}
              type="text"
              value={String(form.customFields[field.key] || '')}
              onChange={(e) => handleCustomFieldChange(field.key, e.target.value)}
              required={field.required}
              className="bg-background/50 border-white/10 focus:border-primary/50"
            />
          )}
          {field.type === 'textarea' && (
            <Textarea
              id={field.key}
              value={String(form.customFields[field.key] || '')}
              onChange={(e) => handleCustomFieldChange(field.key, e.target.value)}
              required={field.required}
              className="bg-background/50 border-white/10 focus:border-primary/50 min-h-[80px]"
            />
          )}
          {field.type === 'select' && (
            <Select
              value={String(form.customFields[field.key] || '')}
              onValueChange={(value) => handleCustomFieldChange(field.key, value)}
            >
              <SelectTrigger className="bg-background/50 border-white/10 focus:border-primary/50 w-full">
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

      {/* General file upload for assets that support it */}
      {currentAssetType?.fileAccept && (
        <div className="space-y-2">
          <Label>
            {assetType === 'cartas' ? t('attachAnImage') :
              assetType === 'fotos' ? t('cameraPhotos') :
                assetType === 'videos' ? t('cameraVideos') :
                  assetType === 'audios' ? t('recordHereOrUpload') :
                    assetType === 'documentos' ? t('uploadFiles') :
                      t('uploadFiles')}
          </Label>
          <Input
            name="files"
            type="file"
            multiple
            accept={currentAssetType?.fileAccept || '*'}
            onChange={handleFileChange}
            className="cursor-pointer file:text-primary file:font-semibold file:bg-primary/10 file:rounded-full file:border-0 file:px-4 file:mr-4 hover:file:bg-primary/20"
          />
        </div>
      )}

      {error && <div className="text-destructive text-sm font-medium">{error}</div>}
      <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border/50">
        <Button type="button" variant="ghost" onClick={onCancel}>{t('cancel')}</Button>
        <Button type="submit" disabled={loading} className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20">
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {loading ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  );
} 
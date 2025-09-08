"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import type { Asset } from "@/models/asset";
import { getAssetType } from "@/constants/assetTypes";

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

  const currentAssetType = getAssetType(assetType);

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

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-full">
      <div>
        <label className="block text-sm font-medium mb-1">{t('assetName')}</label>
        <input
          name="asset_name"
          value={form.asset_name}
          onChange={handleChange}
          required
          className="w-full rounded border px-3 py-2"
        />
      </div>

      {/* Conditional fields based on asset type */}
      {shouldShowField('email') && (
        <div>
          <label className="block text-sm font-medium mb-1">{t('email')}</label>
          <input
            name="email"
            value={form.email}
            onChange={handleChange}
            type="email"
            required={isFieldRequired('email')}
            className="w-full rounded border px-3 py-2"
          />
        </div>
      )}

      {shouldShowField('password') && (
        <div>
          <label className="block text-sm font-medium mb-1">{t('password')}</label>
          <input
            name="password"
            value={form.password}
            onChange={handleChange}
            type="password"
            required={isFieldRequired('password')}
            className="w-full rounded border px-3 py-2"
          />
        </div>
      )}

      {shouldShowField('website') && (
        <div>
          <label className="block text-sm font-medium mb-1">{t('website')}</label>
          <input
            name="website"
            value={form.website}
            onChange={handleChange}
            required={isFieldRequired('website')}
            className="w-full rounded border px-3 py-2"
          />
        </div>
      )}

      {shouldShowField('valid_until') && (
        <div>
          <label className="block text-sm font-medium mb-1">{t('validUntil')}</label>
          <input
            name="valid_until"
            value={form.valid_until}
            onChange={handleChange}
            type="date"
            required={isFieldRequired('valid_until')}
            className="w-full rounded border px-3 py-2"
          />
        </div>
      )}

      {shouldShowField('description') && (
        <div>
          <label className="block text-sm font-medium mb-1">{t('description')}</label>
          <textarea
            name="description"
            value={form.description}
            onChange={handleChange}
            required={isFieldRequired('description')}
            className="w-full rounded border px-3 py-2"
            rows={3}
          />
        </div>
      )}

      {/* Custom fields for new asset types */}
      {currentAssetType?.customFields?.map((field) => (
        <div key={field.key}>
          <label className="block text-sm font-medium mb-1">{t(field.label)}</label>
          {field.type === 'text' && (
            <input
              type="text"
              value={String(form.customFields[field.key] || '')}
              onChange={(e) => handleCustomFieldChange(field.key, e.target.value)}
              required={field.required}
              className="w-full rounded border px-3 py-2"
            />
          )}
          {field.type === 'textarea' && (
            <textarea
              value={String(form.customFields[field.key] || '')}
              onChange={(e) => handleCustomFieldChange(field.key, e.target.value)}
              required={field.required}
              className="w-full rounded border px-3 py-2"
              rows={3}
            />
          )}
          {field.type === 'select' && (
            <select
              value={String(form.customFields[field.key] || '')}
              onChange={(e) => handleCustomFieldChange(field.key, e.target.value)}
              required={field.required}
              className="w-full rounded border px-3 py-2"
            >
              <option value="">Seleccionar...</option>
              {field.options?.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          )}
        </div>
      ))}

      {/* General file upload for assets that support it */}
      {currentAssetType?.fileAccept && (
        <div>
          <label className="block text-sm font-medium mb-1">
            {assetType === 'cartas' ? t('attachAnImage') :
             assetType === 'fotos' ? t('cameraPhotos') :
             assetType === 'videos' ? t('cameraVideos') :
             assetType === 'audios' ? t('recordHereOrUpload') :
             assetType === 'documentos' ? t('uploadFiles') :
                t('uploadFiles')}
          </label>
          <input
            name="files"
            type="file"
            multiple
            accept={currentAssetType?.fileAccept || '*'}
            onChange={handleFileChange}
            className="w-full"
          />
        </div>
      )}

      {error && <div className="text-red-500 text-sm">{error}</div>}
      <div className="flex gap-2">
        <Button type="submit" disabled={loading}>{loading ? t('saving') : t('save')}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>{t('cancel')}</Button>
      </div>
    </form>
  );
} 
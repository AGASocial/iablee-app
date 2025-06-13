"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

export default function AddAssetForm({ assetType, onSuccess, onCancel, asset }: { assetType: string, onSuccess: () => void, onCancel: () => void, asset?: any }) {
  const t = useTranslations();
  const [form, setForm] = useState({
    asset_name: "",
    email: "",
    password: "",
    website: "",
    valid_until: "",
    description: "",
    files: [] as File[],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      });
    }
  }, [asset]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'valid_until') {
      console.log('valid_until input changed:', value);
    }
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files).slice(0, 5);
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
      
      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (!user) throw new Error("Not authenticated");

      // Upload files if any
      let fileUrls: string[] = [];
      if (form.files.length > 0) {
        for (const file of form.files) {
          // Sanitize file name
          const safeFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
          const filePath = `${user.id}/${Date.now()}-${safeFileName}`;
          const { data, error } = await supabase.storage.from('assets').upload(filePath, file);
          if (error) throw error;
          fileUrls.push(data.path);
        }
      }

      if (asset) {
        // Update existing asset
        const { error: updateError } = await supabase.from('digital_assets').update({
          asset_type: asset.asset_type,
          asset_name: form.asset_name,
          email: form.email,
          password: form.password,
          website: form.website,
          valid_until: form.valid_until ? form.valid_until : null,
          description: form.description,
          files: fileUrls.length > 0 ? fileUrls : asset.files || null,
        }).eq('id', asset.id);
        console.log('updateError', updateError);
        if (updateError) throw updateError;
      } else {
        // Insert new asset
        const { error: insertError } = await supabase.from('digital_assets').insert({
          user_id: user.id,
          asset_type: assetType,
          asset_name: form.asset_name,
          email: form.email,
          password: form.password,
          website: form.website,
          valid_until: form.valid_until ? form.valid_until : null,
          description: form.description,
          files: fileUrls.length > 0 ? fileUrls : null,
        });
        if (insertError) throw insertError;
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Error adding asset");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-full">
      <div>
        <label className="block text-sm font-medium mb-1">{t('assetName')}</label>
        <input name="asset_name" value={form.asset_name} onChange={handleChange} required className="w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">{t('email')}</label>
        <input name="email" value={form.email} onChange={handleChange} type="email" className="w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">{t('password')}</label>
        <input name="password" value={form.password} onChange={handleChange} type="password" className="w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">{t('website')}</label>
        <input name="website" value={form.website} onChange={handleChange} className="w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">{t('validUntil')}</label>
        <input name="valid_until" value={form.valid_until} onChange={handleChange} type="date" className="w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">{t('description')}</label>
        <textarea name="description" value={form.description} onChange={handleChange} className="w-full rounded border px-3 py-2" rows={3} />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">{t('files')} (max 5)</label>
        <input name="files" type="file" multiple accept="*" onChange={handleFileChange} className="w-full" />
      </div>
      {error && <div className="text-red-500 text-sm">{error}</div>}
      <div className="flex gap-2">
        <Button type="submit" disabled={loading}>{loading ? t('saving') : t('save')}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>{t('cancel')}</Button>
      </div>
    </form>
  );
} 
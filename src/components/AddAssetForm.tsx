"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

export default function AddAssetForm({ assetType, onSuccess, onCancel }: { assetType: string, onSuccess: () => void, onCancel: () => void }) {
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
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
    try {
      console.log('Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
      console.log('Supabase Key:', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      console.log('User:', user, 'User Error:', userError);
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

      // Insert asset
      const { error: insertError } = await supabase.from('digital_assets').insert({
        user_id: user.id,
        asset_type: assetType,
        asset_name: form.asset_name,
        email: form.email,
        password: form.password, // Consider encrypting in production
        website: form.website,
        valid_until: form.valid_until || null,
        description: form.description,
        files: fileUrls.length > 0 ? fileUrls : null,
      });
      if (insertError) throw insertError;
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
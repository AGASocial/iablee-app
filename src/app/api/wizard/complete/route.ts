import { NextResponse } from 'next/server';
import { getAuthenticatedContext } from '@/lib/auth-context';
type AuthedSupabase = Extract<Awaited<ReturnType<typeof getAuthenticatedContext>>, { ok: true }>['ctx']['supabase'];
import { supabaseAdmin } from '@/lib/supabase-admin';
import { canCreateAsset, canCreateBeneficiary } from '@/lib/subscription/limits';
import { maybeSendBeneficiaryVerificationEmail } from '@/lib/beneficiary-verification-flow';

type WizardAssetInput = {
  assetType: string;
  assetName: string;
  description?: string;
  website?: string;
  validUntil?: string;
  email?: string;
  password?: string;
  customFields?: Record<string, unknown>;
};

type WizardBeneficiaryInput = {
  fullName: string;
  email?: string;
  relationshipId?: number | null;
  phoneNumber?: string;
  notes?: string;
};

type FileMetadataInput = {
  path: string;
  fileName: string;
  fileType: string;
  fileSize: number;
};

type WizardCompleteBody = {
  asset?: WizardAssetInput;
  beneficiary?: WizardBeneficiaryInput;
  fileUrls?: string[];
  fileMetadata?: FileMetadataInput[];
  locale?: string;
  idempotencyKey?: string;
};

type TransactionRpcResult = {
  idempotent: boolean;
  result: {
    asset: Record<string, unknown>;
    beneficiary: Record<string, unknown>;
    verificationSent?: boolean;
  };
};

function normalizeBeneficiaryEmail(email: string | undefined): string | null {
  return email?.trim().toLowerCase() || null;
}

function supportsTransactionalRpc(error: { code?: string; message?: string } | null): boolean {
  if (!error) return true;
  if (error.code === 'PGRST202' || error.code === '42883') return false;
  if (error.message?.includes('complete_wizard_transaction')) return false;
  return true;
}

async function persistVerificationResult(
  userId: string,
  idempotencyKey: string,
  payload: Record<string, unknown>,
) {
  await supabaseAdmin
    .from('wizard_completion_idempotency')
    .update({ response: payload })
    .match({ user_id: userId, idempotency_key: idempotencyKey });
}

async function completeWizardWithFallback({
  userId,
  asset,
  beneficiary,
  fileUrls,
  fileMetadata,
  supabase,
}: {
  userId: string;
  asset: WizardAssetInput;
  beneficiary: WizardBeneficiaryInput;
  fileUrls: string[];
  fileMetadata: FileMetadataInput[];
  supabase: AuthedSupabase;
}) {
  const { data: assetData, error: assetError } = await supabaseAdmin
    .from('digital_assets')
    .insert({
      user_id: userId,
      asset_type: asset.assetType,
      asset_name: asset.assetName,
      description: asset.description || null,
      website: asset.website || null,
      valid_until: asset.validUntil || null,
      email: asset.email || null,
      password: asset.password || null,
      files: fileUrls.length > 0 ? fileUrls : null,
      custom_fields: asset.customFields && Object.keys(asset.customFields).length > 0 ? JSON.stringify(asset.customFields) : null,
      status: 'unassigned',
    })
    .select()
    .single();

  if (assetError) {
    return { error: assetError.message };
  }

  if (fileMetadata.length > 0) {
    const attachmentRows = fileMetadata.map((fm) => ({
      asset_id: String(assetData.id),
      file_path: fm.path,
      file_name: fm.fileName,
      file_type: fm.fileType,
      file_size: fm.fileSize,
    }));

    const { error: attachError } = await supabase.from('asset_attachments').insert(attachmentRows) as { error: { message: string } | null };
    if (attachError) {
      console.error('Error creating asset attachments:', attachError);
    }
  }

  const normalizedEmail = normalizeBeneficiaryEmail(beneficiary.email);

  const beneficiaryInsertResult = await (supabase
    .from('beneficiaries')
    .insert({
      user_id: userId,
      full_name: beneficiary.fullName,
      email: normalizedEmail,
      relationship_id: beneficiary.relationshipId || null,
      phone_number: beneficiary.phoneNumber || null,
      notes: beneficiary.notes || null,
      notified: false,
      email_verified: false,
      email_verified_at: null,
      status: 'active',
    })
    .select()
    .single() as unknown as Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>);
  const { data: beneficiaryData, error: beneficiaryError } = beneficiaryInsertResult;

  if (beneficiaryError || !beneficiaryData) {
    await supabaseAdmin.from('digital_assets').delete().eq('id', String(assetData.id));
    return { error: beneficiaryError?.message || 'Failed to create beneficiary' };
  }

  const { error: linkError } = await supabaseAdmin
    .from('digital_assets')
    .update({ beneficiary_id: String(beneficiaryData.id), status: 'assigned' })
    .eq('id', String(assetData.id));

  if (linkError) {
    return { error: linkError.message };
  }

  return {
    asset: assetData as Record<string, unknown>,
    beneficiary: beneficiaryData,
    normalizedEmail,
  };
}

export async function POST(request: Request) {
  const auth = await getAuthenticatedContext();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.ctx.hasPin || !auth.ctx.hasSecuritySession) {
    return NextResponse.json({ error: 'Security PIN required' }, { status: 403 });
  }
  const { supabase, user } = auth.ctx;

  try {
    const body = (await request.json()) as WizardCompleteBody;
    const asset = body.asset;
    const beneficiary = body.beneficiary;
    const fileUrls = Array.isArray(body.fileUrls) ? body.fileUrls : [];
    const fileMetadata = Array.isArray(body.fileMetadata) ? body.fileMetadata : [];
    const locale = body.locale;
    const headerKey = request.headers.get('Idempotency-Key');
    const idempotencyKey = (headerKey || body.idempotencyKey || '').trim();

    if (!asset || !beneficiary) {
      return NextResponse.json({ error: 'Both asset and beneficiary data are required' }, { status: 400 });
    }
    if (!idempotencyKey) {
      return NextResponse.json({ error: 'Idempotency key is required' }, { status: 400 });
    }

    const [assetLimit, beneficiaryLimit] = await Promise.all([
      canCreateAsset(supabase, user.id),
      canCreateBeneficiary(supabase, user.id),
    ]);

    if (!assetLimit.allowed) {
      return NextResponse.json(
        { error: 'LIMIT_REACHED', message: assetLimit.reason, type: 'asset', limit: assetLimit.limit, current: assetLimit.current },
        { status: 403 },
      );
    }
    if (!beneficiaryLimit.allowed) {
      return NextResponse.json(
        { error: 'LIMIT_REACHED', message: beneficiaryLimit.reason, type: 'beneficiary', limit: beneficiaryLimit.limit, current: beneficiaryLimit.current },
        { status: 403 },
      );
    }

    const txAttempt = await supabaseAdmin.rpc('complete_wizard_transaction', {
      p_user_id: user.id,
      p_idempotency_key: idempotencyKey,
      p_asset: asset,
      p_beneficiary: beneficiary,
      p_file_urls: fileUrls,
      p_file_metadata: fileMetadata,
    });

    if (txAttempt.error && supportsTransactionalRpc(txAttempt.error)) {
      console.error('Transactional wizard RPC failed:', txAttempt.error);
      return NextResponse.json({ error: txAttempt.error.message }, { status: 500 });
    }

    if (!txAttempt.error) {
      const rpcData = txAttempt.data as TransactionRpcResult;
      const normalizedEmail = normalizeBeneficiaryEmail(beneficiary.email);
      let verificationSent = Boolean(rpcData.result.verificationSent);

      if (!rpcData.idempotent && rpcData.result.beneficiary?.id) {
        const verification = await maybeSendBeneficiaryVerificationEmail({
          supabase,
          userId: user.id,
          beneficiaryId: String(rpcData.result.beneficiary.id),
          beneficiaryName: String(rpcData.result.beneficiary.full_name ?? beneficiary.fullName),
          email: normalizedEmail,
          emailChanged: true,
          isNew: true,
          locale,
        });
        verificationSent = verification.verificationSent;
        await persistVerificationResult(user.id, idempotencyKey, {
          ...rpcData.result,
          verificationSent,
        });
      }

      return NextResponse.json(
        {
          asset: rpcData.result.asset,
          beneficiary: rpcData.result.beneficiary,
          verificationSent,
          idempotent: rpcData.idempotent,
        },
        { status: rpcData.idempotent ? 200 : 201 },
      );
    }

    const fallback = await completeWizardWithFallback({
      userId: user.id,
      asset,
      beneficiary,
      fileUrls,
      fileMetadata,
      supabase: supabase as never,
    });

    if ('error' in fallback) {
      return NextResponse.json({ error: fallback.error }, { status: 500 });
    }

    const verification = await maybeSendBeneficiaryVerificationEmail({
      supabase,
      userId: user.id,
      beneficiaryId: String(fallback.beneficiary.id),
      beneficiaryName: String(fallback.beneficiary.full_name ?? beneficiary.fullName),
      email: fallback.normalizedEmail,
      emailChanged: true,
      isNew: true,
      locale,
    });

    return NextResponse.json(
      {
        asset: fallback.asset,
        beneficiary: fallback.beneficiary,
        verificationSent: verification.verificationSent,
        idempotent: false,
      },
      { status: 201 },
    );
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

import { NextResponse } from 'next/server';
import { getAuthenticatedContext } from '@/lib/auth-context';
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

type RpcError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

function normalizeBeneficiaryEmail(email: string | undefined): string | null {
  return email?.trim().toLowerCase() || null;
}

function isMissingTransactionalRpc(error: RpcError | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  if (error.message?.includes('complete_wizard_transaction')) return true;
  return false;
}

function isIdempotencyInProgress(error: RpcError | null): boolean {
  if (!error) return false;
  if (error.code === '55P03') return true;

  const fullMessage = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase();
  if (error.code === '23505' && (fullMessage.includes('wizard_completion_idempotency') || fullMessage.includes('idempotency'))) {
    return true;
  }

  if (fullMessage.includes('idempotency key is currently being processed') || (fullMessage.includes('idempotency key') && fullMessage.includes('in progress'))) {
    return true;
  }

  return false;
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

    if (txAttempt.error) {
      if (isMissingTransactionalRpc(txAttempt.error)) {
        console.error('Wizard completion RPC unavailable during deploy:', txAttempt.error);
        return NextResponse.json({ error: 'SERVICE_UPDATING' }, { status: 503 });
      }
      if (isIdempotencyInProgress(txAttempt.error)) {
        return NextResponse.json({ error: 'IDEMPOTENCY_IN_PROGRESS', retryable: true }, { status: 409 });
      }

      console.error('Transactional wizard RPC failed:', txAttempt.error);
      return NextResponse.json({ error: txAttempt.error.message }, { status: 500 });
    }

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
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

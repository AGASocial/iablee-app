import { supabaseAdmin } from '@/lib/supabase-admin';

/** Marks every unused PIN-reset grant for this user so a copied cookie cannot call set-pin. */
export async function consumeOpenPinResetGrants(userId: string): Promise<boolean> {
  const { error } = await supabaseAdmin.rpc('consume_open_pin_reset_grants', {
    p_user_id: userId,
  });

  if (error) {
    console.error('Error consuming PIN reset grants:', error);
    return false;
  }

  return true;
}

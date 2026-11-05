import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteClient } from '@/lib/supabase-server';
import { clearSecuritySession } from '@/lib/security-cookie';
import { consumeOpenPinResetGrants } from '@/lib/pin-reset-grants';

export async function POST() {
  try {
    const supabase = await createRouteClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError) {
      console.error('Logout user lookup failed:', userError);
    }

    if (userData?.user?.id) {
      const consumed = await consumeOpenPinResetGrants(userData.user.id);
      if (!consumed) {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
      }
    }

    const { error } = await supabase.auth.signOut();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const cookieStore = await cookies();
    clearSecuritySession(cookieStore);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

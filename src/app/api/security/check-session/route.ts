import { NextResponse } from 'next/server';
import { getSecurityContext } from '@/lib/auth-context';
import { withTiming } from '@/lib/observability';

export const GET = withTiming('GET /api/security/check-session', async () => {
    try {
        const result = await getSecurityContext();

        if (!result.ok) {
            return NextResponse.json({ authenticated: false, locked: true, hasPin: false }, { status: 200 });
        }

        const { hasPin, hasSecuritySession } = result.ctx;

        return NextResponse.json({
            authenticated: true,
            hasPin,
            locked: hasPin ? !hasSecuritySession : true,
        });
    } catch (err: unknown) {
        const error = err as Error;
        console.error('Error checking session:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
});

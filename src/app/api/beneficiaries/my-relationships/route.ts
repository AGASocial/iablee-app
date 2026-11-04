import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface BeneficiaryRelationship {
  holder_id: string
  holder_full_name: string
  holder_email: string
  relationship_id: number | null
  beneficiary_id: string
  email_verified: boolean
  email_verified_at: string | null
  created_at: string
  updated_at: string
}

export async function GET() {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // Handle cookie setting errors
            }
          },
        },
      }
    )

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Call the security definer function
    const { data, error } = await supabase
      .rpc('get_my_beneficiary_relationships')

    if (error) {
      console.error('Error fetching beneficiary relationships:', error)
      return NextResponse.json(
        { error: 'Failed to fetch beneficiary relationships' },
        { status: 500 }
      )
    }

    return NextResponse.json({ 
      relationships: (data || []) as BeneficiaryRelationship[]
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

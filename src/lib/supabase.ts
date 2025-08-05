import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Check if the URL is valid before creating the client
const isValidSupabaseUrl = (url: string) => {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.endsWith('.supabase.co') && urlObj.protocol === 'https:';
  } catch {
    return false;
  }
};

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables:', {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl ? 'set' : 'missing',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey ? 'set' : 'missing'
  })
  throw new Error('Missing Supabase environment variables. Please check your .env.local file.')
}

if (!isValidSupabaseUrl(supabaseUrl)) {
  console.error('Invalid Supabase URL:', supabaseUrl);
  throw new Error('Invalid Supabase URL. Please check your NEXT_PUBLIC_SUPABASE_URL in .env.local')
}

export const supabase = createClientComponentClient({
  supabaseUrl,
  supabaseKey: supabaseAnonKey,
})

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          full_name: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          email: string
          full_name: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string
          created_at?: string
          updated_at?: string
        }
      }
      digital_assets: {
        Row: {
          id: string
          user_id: string
          asset_type: string
          asset_name: string
          asset_value: string
          access_instructions: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          asset_type: string
          asset_name: string
          asset_value: string
          access_instructions: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          asset_type?: string
          asset_name?: string
          asset_value?: string
          access_instructions?: string
          created_at?: string
          updated_at?: string
        }
      }
      beneficiaries: {
        Row: {
          id: string
          user_id: string
          full_name: string
          email: string | null
          relationship: string | null
          phone_number: string | null
          notes: string | null
          notified: boolean | null
          status: string | null
          last_notified_at: string | null
          email_verified: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          full_name: string
          email?: string | null
          relationship?: string | null
          phone_number?: string | null
          notes?: string | null
          notified?: boolean | null
          status?: string | null
          last_notified_at?: string | null
          email_verified?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          full_name?: string
          email?: string | null
          relationship?: string | null
          phone_number?: string | null
          notes?: string | null
          notified?: boolean | null
          status?: string | null
          last_notified_at?: string | null
          email_verified?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
    }
  }
} 
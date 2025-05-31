import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

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
          beneficiary_email: string
          beneficiary_name: string
          relationship: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          beneficiary_email: string
          beneficiary_name: string
          relationship: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          beneficiary_email?: string
          beneficiary_name?: string
          relationship?: string
          created_at?: string
          updated_at?: string
        }
      }
    }
  }
} 
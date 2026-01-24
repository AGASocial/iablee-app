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
          beneficiary_id: string | null
          status: string | null
          email: string | null
          password: string | null
          website: string | null
          valid_until: string | null
          description: string | null
          files: Record<string, unknown> | null
          number_of_files: number | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          asset_type: string
          asset_name: string
          beneficiary_id?: string | null
          status?: string | null
          email?: string | null
          password?: string | null
          website?: string | null
          valid_until?: string | null
          description?: string | null
          files?: Record<string, unknown> | null
          number_of_files?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          asset_type?: string
          asset_name?: string
          beneficiary_id?: string | null
          status?: string | null
          email?: string | null
          password?: string | null
          website?: string | null
          valid_until?: string | null
          description?: string | null
          files?: Record<string, unknown> | null
          number_of_files?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      beneficiaries: {
        Row: {
          id: string
          user_id: string
          full_name: string
          email: string | null
          phone_number: string | null
          notes: string | null
          relationship_id: number | null
          status: string | null
          last_notified_at: string | null
          notified: boolean | null
          email_verified: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          full_name: string
          email?: string | null
          phone_number?: string | null
          notes?: string | null
          relationship_id?: number | null
          status?: string | null
          last_notified_at?: string | null
          notified?: boolean | null
          email_verified?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          full_name?: string
          email?: string | null
          phone_number?: string | null
          notes?: string | null
          relationship_id?: number | null
          status?: string | null
          last_notified_at?: string | null
          notified?: boolean | null
          email_verified?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      billing_plans: {
        Row: {
          id: string
          name: string
          currency: string
          amount_cents: number
          interval: string
          features: Record<string, unknown>
          provider_price_map: Record<string, unknown> | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          name: string
          currency: string
          amount_cents: number
          interval: string
          features?: Record<string, unknown>
          provider_price_map?: Record<string, unknown> | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          currency?: string
          amount_cents?: number
          interval?: string
          features?: Record<string, unknown>
          provider_price_map?: Record<string, unknown> | null
          created_at?: string
          updated_at?: string
        }
      }
      billing_subscriptions: {
        Row: {
          id: string
          user_id: string
          plan_id: string
          status: string
          provider: string
          provider_subscription_id: string
          provider_customer_id: string | null
          current_period_start: string | null
          current_period_end: string | null
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          plan_id: string
          status: string
          provider: string
          provider_subscription_id: string
          provider_customer_id?: string | null
          current_period_start?: string | null
          current_period_end?: string | null
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          plan_id?: string
          status?: string
          provider?: string
          provider_subscription_id?: string
          provider_customer_id?: string | null
          current_period_start?: string | null
          current_period_end?: string | null
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      billing_payment_methods: {
        Row: {
          id: string
          user_id: string
          provider: string
          provider_customer_id: string
          token: string
          brand: string | null
          last4: string | null
          exp_month: number | null
          exp_year: number | null
          is_default: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          provider: string
          provider_customer_id: string
          token: string
          brand?: string | null
          last4?: string | null
          exp_month?: number | null
          exp_year?: number | null
          is_default?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          provider?: string
          provider_customer_id?: string
          token?: string
          brand?: string | null
          last4?: string | null
          exp_month?: number | null
          exp_year?: number | null
          is_default?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      billing_invoices: {
        Row: {
          id: string
          user_id: string
          subscription_id: string | null
          provider: string
          provider_invoice_id: string
          amount_cents: number
          currency: string
          status: string
          issued_at: string
          paid_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          subscription_id?: string | null
          provider: string
          provider_invoice_id: string
          amount_cents: number
          currency: string
          status: string
          issued_at: string
          paid_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          subscription_id?: string | null
          provider?: string
          provider_invoice_id?: string
          amount_cents?: number
          currency?: string
          status?: string
          issued_at?: string
          paid_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      billing_webhook_events: {
        Row: {
          id: string
          provider: string
          type: string
          provider_event_id: string | null
          raw: Record<string, unknown>
          received_at: string
          handled: boolean
          handled_at: string | null
          error: string | null
        }
        Insert: {
          id?: string
          provider: string
          type: string
          provider_event_id?: string | null
          raw: Record<string, unknown>
          received_at?: string
          handled?: boolean
          handled_at?: string | null
          error?: string | null
        }
        Update: {
          id?: string
          provider?: string
          type?: string
          provider_event_id?: string | null
          raw?: Record<string, unknown>
          received_at?: string
          handled?: boolean
          handled_at?: string | null
          error?: string | null
        }
      }
      asset_types: {
        Row: {
          id: string
          key: string
          name: string
          description: string | null
          icon: string
          is_active: boolean
          required_fields: Record<string, unknown>
          optional_fields: Record<string, unknown>
          file_accept: string | null
          custom_fields: Record<string, unknown>
          display_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          key: string
          name: string
          description?: string | null
          icon: string
          is_active?: boolean
          required_fields?: Record<string, unknown>
          optional_fields?: Record<string, unknown>
          file_accept?: string | null
          custom_fields?: Record<string, unknown>
          display_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          key?: string
          name?: string
          description?: string | null
          icon?: string
          is_active?: boolean
          required_fields?: Record<string, unknown>
          optional_fields?: Record<string, unknown>
          file_accept?: string | null
          custom_fields?: Record<string, unknown>
          display_order?: number
          created_at?: string
          updated_at?: string
        }
      }
      asset_type_billing_plans: {
        Row: {
          id: string
          asset_type_id: string
          billing_plan_id: string
          created_at: string
        }
        Insert: {
          id?: string
          asset_type_id: string
          billing_plan_id: string
          created_at?: string
        }
        Update: {
          id?: string
          asset_type_id?: string
          billing_plan_id?: string
          created_at?: string
        }
      }
    }
  }
} 
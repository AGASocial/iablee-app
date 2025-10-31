-- Create billing_plans table
CREATE TABLE IF NOT EXISTS public.billing_plans (
  id text not null,
  name text not null,
  currency text not null,
  amount_cents integer not null,
  interval text not null CHECK (interval IN ('month', 'year')),
  features jsonb not null default '{}'::jsonb,
  provider_price_map jsonb null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint billing_plans_pkey primary key (id)
) TABLESPACE pg_default;

-- Create billing_subscriptions table
CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  plan_id text not null,
  status text not null CHECK (status IN ('active', 'past_due', 'canceled', 'incomplete', 'trialing', 'unpaid')),
  provider text not null,
  provider_subscription_id text not null,
  provider_customer_id text null,
  current_period_start timestamp with time zone null,
  current_period_end timestamp with time zone null,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint billing_subscriptions_pkey primary key (id),
  constraint billing_subscriptions_user_id_fkey foreign key (user_id) references users (id) on delete cascade,
  constraint billing_subscriptions_plan_id_fkey foreign key (plan_id) references billing_plans (id)
) TABLESPACE pg_default;

-- Create billing_payment_methods table
CREATE TABLE IF NOT EXISTS public.billing_payment_methods (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  provider text not null,
  provider_customer_id text not null,
  token text not null,
  brand text null,
  last4 text null,
  exp_month integer null,
  exp_year integer null,
  is_default boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint billing_payment_methods_pkey primary key (id),
  constraint billing_payment_methods_user_id_fkey foreign key (user_id) references users (id) on delete cascade
) TABLESPACE pg_default;

-- Create billing_invoices table
CREATE TABLE IF NOT EXISTS public.billing_invoices (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  subscription_id uuid null,
  provider text not null,
  provider_invoice_id text not null,
  amount_cents integer not null,
  currency text not null,
  status text not null CHECK (status IN ('paid', 'open', 'uncollectible', 'void', 'draft')),
  issued_at timestamp with time zone not null,
  paid_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint billing_invoices_pkey primary key (id),
  constraint billing_invoices_user_id_fkey foreign key (user_id) references users (id) on delete cascade,
  constraint billing_invoices_subscription_id_fkey foreign key (subscription_id) references billing_subscriptions (id) on delete set null
) TABLESPACE pg_default;

-- Create billing_webhook_events table
CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
  id uuid not null default gen_random_uuid(),
  provider text not null,
  type text not null,
  provider_event_id text null,
  raw jsonb not null,
  received_at timestamp with time zone not null default now(),
  handled boolean not null default false,
  handled_at timestamp with time zone null,
  error text null,
  constraint billing_webhook_events_pkey primary key (id)
) TABLESPACE pg_default;

-- Create unique index on provider_event_id for idempotency
CREATE UNIQUE INDEX IF NOT EXISTS billing_webhook_events_provider_event_id_idx
  ON public.billing_webhook_events (provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

-- Create index on user_id for subscriptions lookup
CREATE INDEX IF NOT EXISTS billing_subscriptions_user_id_idx ON public.billing_subscriptions (user_id);

-- Create index on user_id for payment methods lookup
CREATE INDEX IF NOT EXISTS billing_payment_methods_user_id_idx ON public.billing_payment_methods (user_id);

-- Create index on user_id for invoices lookup
CREATE INDEX IF NOT EXISTS billing_invoices_user_id_idx ON public.billing_invoices (user_id);

-- Create index on subscription_id for invoices lookup
CREATE INDEX IF NOT EXISTS billing_invoices_subscription_id_idx ON public.billing_invoices (subscription_id);

-- Enable RLS
ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies for billing_plans (read-only for all authenticated users)
CREATE POLICY "Authenticated users can view billing plans" ON public.billing_plans
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- RLS Policies for billing_subscriptions
CREATE POLICY "Users can view their own subscriptions" ON public.billing_subscriptions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own subscriptions" ON public.billing_subscriptions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own subscriptions" ON public.billing_subscriptions
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own subscriptions" ON public.billing_subscriptions
  FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for billing_payment_methods
CREATE POLICY "Users can view their own payment methods" ON public.billing_payment_methods
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own payment methods" ON public.billing_payment_methods
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own payment methods" ON public.billing_payment_methods
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own payment methods" ON public.billing_payment_methods
  FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for billing_invoices
CREATE POLICY "Users can view their own invoices" ON public.billing_invoices
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own invoices" ON public.billing_invoices
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for billing_webhook_events (service role only - no client access)
-- No policies needed - service role bypasses RLS

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER set_billing_plans_updated_at
  BEFORE UPDATE ON public.billing_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_billing_subscriptions_updated_at
  BEFORE UPDATE ON public.billing_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_billing_payment_methods_updated_at
  BEFORE UPDATE ON public.billing_payment_methods
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_billing_invoices_updated_at
  BEFORE UPDATE ON public.billing_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

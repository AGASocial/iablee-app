/**
 * Billing Service
 * Domain orchestration layer for subscription and payment management
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaymentGateway } from './gateway.interface';
import type {
  PlanDefinition,
  Subscription,
  PaymentMethod,
  Invoice,
  CustomerRef,
  PaymentMethodToken,
  CreateSubscriptionRequest,
  CreateSubscriptionResponse,
  UpdateSubscriptionRequest,
  CancelSubscriptionRequest,
  AttachPaymentMethodRequest,
  AttachPaymentMethodResponse,
  NormalizedEvent,
  SubscriptionEventData,
  InvoiceEventData,
  PaymentMethodEventData,
  PaymentProvider,
} from './types';
import {
  BillingError,
  SubscriptionNotFoundError,
  PlanNotFoundError,
} from './types';

export class BillingService {
  constructor(
    private supabase: SupabaseClient,
    private gateway: PaymentGateway
  ) {}

  /**
   * Get all available billing plans
   */
  async getPlans(): Promise<PlanDefinition[]> {
    const { data, error } = await this.supabase
      .from('billing_plans')
      .select('*')
      .order('amount_cents', { ascending: true });

    if (error) {
      throw new BillingError('Failed to fetch plans', 'FETCH_PLANS_FAILED');
    }

    return (data || []).map(this.mapPlanFromDb);
  }

  /**
   * Get a specific plan by ID
   */
  async getPlan(planId: string): Promise<PlanDefinition> {
    const { data, error } = await this.supabase
      .from('billing_plans')
      .select('*')
      .eq('id', planId)
      .single();

    if (error || !data) {
      throw new PlanNotFoundError(planId);
    }

    return this.mapPlanFromDb(data);
  }

  /**
   * Get user's active subscription
   */
  async getUserSubscription(userId: string): Promise<Subscription | null> {
    const { data, error } = await this.supabase
      .from('billing_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['active', 'trialing', 'past_due'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new BillingError('Failed to fetch subscription', 'FETCH_SUBSCRIPTION_FAILED');
    }

    return data ? this.mapSubscriptionFromDb(data) : null;
  }

  /**
   * Get user's payment methods
   */
  async getPaymentMethods(userId: string): Promise<PaymentMethod[]> {
    const { data, error } = await this.supabase
      .from('billing_payment_methods')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new BillingError('Failed to fetch payment methods', 'FETCH_PAYMENT_METHODS_FAILED');
    }

    return (data || []).map(this.mapPaymentMethodFromDb);
  }

  /**
   * Get user's invoices
   */
  async getInvoices(userId: string, limit = 10): Promise<Invoice[]> {
    const { data, error } = await this.supabase
      .from('billing_invoices')
      .select('*')
      .eq('user_id', userId)
      .order('issued_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new BillingError('Failed to fetch invoices', 'FETCH_INVOICES_FAILED');
    }

    return (data || []).map(this.mapInvoiceFromDb);
  }

  /**
   * Create or get customer reference for a user
   */
  async getOrCreateCustomer(userId: string, email: string, name?: string): Promise<CustomerRef> {
    // Check if user already has a payment method (which contains customer ID)
    const { data: existingMethod } = await this.supabase
      .from('billing_payment_methods')
      .select('provider, provider_customer_id')
      .eq('user_id', userId)
      .eq('provider', this.gateway.getName())
      .limit(1)
      .maybeSingle();

    if (existingMethod) {
      return {
        provider: existingMethod.provider as PaymentProvider,
        providerCustomerId: existingMethod.provider_customer_id,
      };
    }

    // Create new customer with the gateway
    return await this.gateway.getOrCreateCustomer({
      userId,
      email,
      name,
      metadata: { user_id: userId },
    });
  }

  /**
   * Attach a payment method to a user
   */
  async attachPaymentMethod(
    request: AttachPaymentMethodRequest
  ): Promise<AttachPaymentMethodResponse> {
    const { userId, paymentMethodToken, setAsDefault = true } = request;

    // Get user details
    const { data: user, error: userError } = await this.supabase
      .from('users')
      .select('email, full_name')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      throw new BillingError('User not found', 'USER_NOT_FOUND');
    }

    // Get or create customer
    const customer = await this.getOrCreateCustomer(userId, user.email, user.full_name || undefined);

    // Attach payment method via gateway
    const paymentMethod: PaymentMethodToken = {
      provider: this.gateway.getName(),
      token: paymentMethodToken,
    };

    const attachedMethod = await this.gateway.attachPaymentMethod(customer, paymentMethod);

    // If setting as default, update existing default methods
    if (setAsDefault) {
      await this.supabase
        .from('billing_payment_methods')
        .update({ is_default: false })
        .eq('user_id', userId)
        .eq('provider', this.gateway.getName());

      // Set as default in gateway
      await this.gateway.setDefaultPaymentMethod(customer, attachedMethod.token);
    }

    // Store payment method in database
    const { data: savedMethod, error: saveError } = await this.supabase
      .from('billing_payment_methods')
      .insert({
        user_id: userId,
        provider: this.gateway.getName(),
        provider_customer_id: customer.providerCustomerId,
        token: attachedMethod.token,
        brand: attachedMethod.brand,
        last4: attachedMethod.last4,
        exp_month: attachedMethod.expMonth,
        exp_year: attachedMethod.expYear,
        is_default: setAsDefault,
      })
      .select()
      .single();

    if (saveError || !savedMethod) {
      throw new BillingError('Failed to save payment method', 'SAVE_PAYMENT_METHOD_FAILED');
    }

    return {
      paymentMethodId: savedMethod.id,
      brand: savedMethod.brand || undefined,
      last4: savedMethod.last4 || undefined,
    };
  }

  /**
   * Set a payment method as the default for a user
   */
  async setDefaultPaymentMethod(userId: string, paymentMethodId: string): Promise<void> {
    // Get the payment method
    const { data: paymentMethod, error: pmError } = await this.supabase
      .from('billing_payment_methods')
      .select('*')
      .eq('id', paymentMethodId)
      .eq('user_id', userId)
      .single();

    if (pmError || !paymentMethod) {
      throw new BillingError('Payment method not found', 'PAYMENT_METHOD_NOT_FOUND');
    }

    // Update all existing payment methods to not be default
    await this.supabase
      .from('billing_payment_methods')
      .update({ is_default: false })
      .eq('user_id', userId)
      .eq('provider', paymentMethod.provider);

    // Set the specified payment method as default
    const { error: updateError } = await this.supabase
      .from('billing_payment_methods')
      .update({ is_default: true })
      .eq('id', paymentMethodId);

    if (updateError) {
      throw new BillingError('Failed to set default payment method', 'SET_DEFAULT_FAILED');
    }

    // Set as default in payment gateway
    const customer = {
      provider: paymentMethod.provider,
      providerCustomerId: paymentMethod.provider_customer_id,
    };
    await this.gateway.setDefaultPaymentMethod(customer, paymentMethod.token);
  }

  /**
   * Remove a payment method
   */
  async detachPaymentMethod(userId: string, paymentMethodId: string): Promise<void> {
    // Get the payment method
    const { data: paymentMethod, error: pmError } = await this.supabase
      .from('billing_payment_methods')
      .select('*')
      .eq('id', paymentMethodId)
      .eq('user_id', userId)
      .single();

    if (pmError || !paymentMethod) {
      throw new BillingError('Payment method not found', 'PAYMENT_METHOD_NOT_FOUND');
    }

    // Check if this is the default payment method and there's an active subscription
    if (paymentMethod.is_default) {
      const { data: activeSubscription } = await this.supabase
        .from('billing_subscriptions')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'active')
        .single();

      if (activeSubscription) {
        throw new BillingError(
          'Cannot remove default payment method with active subscription',
          'CANNOT_REMOVE_DEFAULT'
        );
      }
    }

    // Detach from payment gateway
    await this.gateway.detachPaymentMethod(paymentMethod.token);

    // Delete from database
    const { error: deleteError } = await this.supabase
      .from('billing_payment_methods')
      .delete()
      .eq('id', paymentMethodId);

    if (deleteError) {
      throw new BillingError('Failed to delete payment method', 'DELETE_PAYMENT_METHOD_FAILED');
    }
  }

  /**
   * Create a subscription for a user
   */
  async createSubscription(
    request: CreateSubscriptionRequest
  ): Promise<CreateSubscriptionResponse> {
    const { userId, planId, paymentMethodToken } = request;

    // Get plan
    const plan = await this.getPlan(planId);

    // Get user details
    const { data: user, error: userError } = await this.supabase
      .from('users')
      .select('email, full_name')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      throw new BillingError('User not found', 'USER_NOT_FOUND');
    }

    // Get or create customer
    const customer = await this.getOrCreateCustomer(userId, user.email, user.full_name || undefined);

    // Attach payment method if provided
    let paymentMethod: PaymentMethodToken | undefined;
    if (paymentMethodToken) {
      paymentMethod = {
        provider: this.gateway.getName(),
        token: paymentMethodToken,
      };
      await this.gateway.attachPaymentMethod(customer, paymentMethod);
      await this.gateway.setDefaultPaymentMethod(customer, paymentMethodToken);
    }

    // Create subscription via gateway
    const result = await this.gateway.createSubscription({
      customer,
      plan,
      paymentMethod,
      metadata: { user_id: userId, plan_id: planId },
    });

    // Save subscription to database
    const { data: subscription, error: subscriptionError } = await this.supabase
      .from('billing_subscriptions')
      .insert({
        user_id: userId,
        plan_id: planId,
        status: result.status as Subscription['status'],
        provider: this.gateway.getName(),
        provider_subscription_id: result.providerSubscriptionId,
        provider_customer_id: customer.providerCustomerId,
        current_period_end: result.currentPeriodEnd?.toISOString(),
      })
      .select()
      .single();

    if (subscriptionError || !subscription) {
      throw new BillingError('Failed to save subscription', 'SAVE_SUBSCRIPTION_FAILED');
    }

    return {
      subscriptionId: subscription.id,
      providerSubscriptionId: result.providerSubscriptionId,
      status: result.status as Subscription['status'],
      clientSecret: result.clientSecret,
    };
  }

  /**
   * Update a subscription
   */
  async updateSubscription(request: UpdateSubscriptionRequest): Promise<void> {
    const { subscriptionId, planId, cancelAtPeriodEnd } = request;

    // Get existing subscription
    const { data: subscription, error: fetchError } = await this.supabase
      .from('billing_subscriptions')
      .select('*')
      .eq('id', subscriptionId)
      .single();

    if (fetchError || !subscription) {
      throw new SubscriptionNotFoundError(subscriptionId);
    }

    // Update via gateway
    await this.gateway.updateSubscription(subscription.provider_subscription_id, {
      planId,
      cancelAtPeriodEnd,
    });

    // Update database
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (planId) updates.plan_id = planId;
    if (cancelAtPeriodEnd !== undefined) updates.cancel_at_period_end = cancelAtPeriodEnd;

    const { error: updateError } = await this.supabase
      .from('billing_subscriptions')
      .update(updates)
      .eq('id', subscriptionId);

    if (updateError) {
      throw new BillingError('Failed to update subscription', 'UPDATE_SUBSCRIPTION_FAILED');
    }
  }

  /**
   * Cancel a subscription
   */
  async cancelSubscription(request: CancelSubscriptionRequest): Promise<void> {
    const { subscriptionId, atPeriodEnd = true } = request;

    // Get existing subscription
    const { data: subscription, error: fetchError } = await this.supabase
      .from('billing_subscriptions')
      .select('*')
      .eq('id', subscriptionId)
      .single();

    if (fetchError || !subscription) {
      throw new SubscriptionNotFoundError(subscriptionId);
    }

    // Cancel via gateway
    await this.gateway.cancelSubscription(subscription.provider_subscription_id, atPeriodEnd);

    // Update database
    const updates: Record<string, unknown> = {
      cancel_at_period_end: atPeriodEnd,
      updated_at: new Date().toISOString(),
    };

    if (!atPeriodEnd) {
      updates.status = 'canceled';
      updates.canceled_at = new Date().toISOString();
    }

    const { error: updateError } = await this.supabase
      .from('billing_subscriptions')
      .update(updates)
      .eq('id', subscriptionId);

    if (updateError) {
      throw new BillingError('Failed to cancel subscription', 'CANCEL_SUBSCRIPTION_FAILED');
    }
  }

  /**
   * Handle a normalized webhook event
   */
  async handleWebhookEvent(event: NormalizedEvent): Promise<void> {
    // Store the webhook event
    await this.storeWebhookEvent(event);

    // Process based on event type
    switch (event.type) {
      case 'subscription.created':
      case 'subscription.updated':
        await this.handleSubscriptionEvent(event.data as SubscriptionEventData);
        break;
      case 'subscription.canceled':
        await this.handleSubscriptionCanceled(event.data as SubscriptionEventData);
        break;
      case 'invoice.paid':
        await this.handleInvoicePaid(event.data as InvoiceEventData);
        break;
      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed(event.data as InvoiceEventData);
        break;
      case 'payment_method.attached':
        await this.handlePaymentMethodAttached(event.data as PaymentMethodEventData);
        break;
      default:
        console.log(`Unhandled webhook event type: ${event.type}`);
    }
  }

  /**
   * Store webhook event for idempotency and audit
   */
  private async storeWebhookEvent(event: NormalizedEvent): Promise<void> {
    await this.supabase.from('billing_webhook_events').insert({
      provider: event.provider,
      type: event.type,
      provider_event_id: event.id,
      raw: event.raw as Record<string, unknown>,
      handled: true,
      handled_at: new Date().toISOString(),
    });
  }

  /**
   * Handle subscription created/updated events
   */
  private async handleSubscriptionEvent(data: SubscriptionEventData): Promise<void> {
    // Find user by customer ID
    const { data: paymentMethod } = await this.supabase
      .from('billing_payment_methods')
      .select('user_id')
      .eq('provider_customer_id', data.customerId)
      .limit(1)
      .maybeSingle();

    if (!paymentMethod) {
      console.error('No user found for customer:', data.customerId);
      return;
    }

    const userId = paymentMethod.user_id;

    // Upsert subscription
    await this.supabase
      .from('billing_subscriptions')
      .upsert(
        {
          user_id: userId,
          provider_subscription_id: data.subscriptionId,
          status: data.status,
          current_period_start: data.currentPeriodStart,
          current_period_end: data.currentPeriodEnd,
          cancel_at_period_end: data.cancelAtPeriodEnd || false,
          provider: this.gateway.getName(),
          provider_customer_id: data.customerId,
        },
        { onConflict: 'provider_subscription_id' }
      );
  }

  /**
   * Handle subscription canceled event
   */
  private async handleSubscriptionCanceled(data: SubscriptionEventData): Promise<void> {
    await this.supabase
      .from('billing_subscriptions')
      .update({
        status: 'canceled',
        canceled_at: data.canceledAt || new Date().toISOString(),
      })
      .eq('provider_subscription_id', data.subscriptionId);
  }

  /**
   * Handle invoice paid event
   */
  private async handleInvoicePaid(data: InvoiceEventData): Promise<void> {
    // Find user by customer ID
    const { data: paymentMethod } = await this.supabase
      .from('billing_payment_methods')
      .select('user_id')
      .eq('provider_customer_id', data.customerId)
      .limit(1)
      .maybeSingle();

    if (!paymentMethod) {
      console.error('No user found for customer:', data.customerId);
      return;
    }

    const userId = paymentMethod.user_id;

    // Find subscription if provided
    let subscriptionId: string | undefined;
    if (data.subscriptionId) {
      const { data: subscription } = await this.supabase
        .from('billing_subscriptions')
        .select('id')
        .eq('provider_subscription_id', data.subscriptionId)
        .maybeSingle();

      subscriptionId = subscription?.id;
    }

    // Store invoice
    await this.supabase.from('billing_invoices').upsert(
      {
        user_id: userId,
        subscription_id: subscriptionId,
        provider: this.gateway.getName(),
        provider_invoice_id: data.invoiceId,
        amount_cents: data.amountCents,
        currency: data.currency,
        status: 'paid',
        issued_at: data.issuedAt,
        paid_at: data.paidAt || new Date().toISOString(),
      },
      { onConflict: 'provider_invoice_id' }
    );
  }

  /**
   * Handle invoice payment failed event
   */
  private async handleInvoicePaymentFailed(data: InvoiceEventData): Promise<void> {
    // Update subscription status to past_due
    if (data.subscriptionId) {
      await this.supabase
        .from('billing_subscriptions')
        .update({ status: 'past_due' })
        .eq('provider_subscription_id', data.subscriptionId);
    }

    // TODO: Send notification email to user
    console.log('Payment failed for invoice:', data.invoiceId);
  }

  /**
   * Handle payment method attached event
   */
  private async handlePaymentMethodAttached(data: PaymentMethodEventData): Promise<void> {
    // This is typically handled during the attach flow
    // But we can update/sync if needed
    console.log('Payment method attached:', data.paymentMethodId);
  }

  /**
   * Map database plan to domain model
   */
  private mapPlanFromDb(data: Record<string, unknown>): PlanDefinition {
    return {
      id: data.id as string,
      name: data.name as string,
      currency: data.currency as PlanDefinition['currency'],
      amountCents: data.amount_cents as number,
      interval: data.interval as PlanDefinition['interval'],
      features: data.features as PlanDefinition['features'],
      providerPriceMap: data.provider_price_map as PlanDefinition['providerPriceMap'],
    };
  }

  /**
   * Map database subscription to domain model
   */
  private mapSubscriptionFromDb(data: Record<string, unknown>): Subscription {
    return {
      id: data.id as string,
      userId: data.user_id as string,
      planId: data.plan_id as string,
      status: data.status as Subscription['status'],
      provider: data.provider as Subscription['provider'],
      providerSubscriptionId: data.provider_subscription_id as string,
      providerCustomerId: data.provider_customer_id as string | undefined,
      currentPeriodStart: data.current_period_start ? new Date(data.current_period_start as string) : undefined,
      currentPeriodEnd: data.current_period_end ? new Date(data.current_period_end as string) : undefined,
      cancelAtPeriodEnd: data.cancel_at_period_end as boolean,
      canceledAt: data.canceled_at ? new Date(data.canceled_at as string) : undefined,
      createdAt: new Date(data.created_at as string),
      updatedAt: new Date(data.updated_at as string),
    };
  }

  /**
   * Map database payment method to domain model
   */
  private mapPaymentMethodFromDb(data: Record<string, unknown>): PaymentMethod {
    const brand = data.brand as string | undefined;
    const last4 = data.last4 as string | undefined;
    const expMonth = data.exp_month as number | undefined;
    const expYear = data.exp_year as number | undefined;

    return {
      id: data.id as string,
      userId: data.user_id as string,
      provider: data.provider as PaymentMethod['provider'],
      providerCustomerId: data.provider_customer_id as string,
      token: data.token as string,
      type: 'card', // Payment type
      // Include nested card object for UI compatibility
      card: brand && last4 && expMonth && expYear ? {
        brand,
        last4,
        expMonth,
        expYear,
      } : undefined,
      // Also keep flat properties for backward compatibility
      brand,
      last4,
      expMonth,
      expYear,
      isDefault: data.is_default as boolean,
      createdAt: new Date(data.created_at as string),
      updatedAt: new Date(data.updated_at as string),
    };
  }

  /**
   * Map database invoice to domain model
   */
  private mapInvoiceFromDb(data: Record<string, unknown>): Invoice {
    return {
      id: data.id as string,
      userId: data.user_id as string,
      subscriptionId: data.subscription_id as string | undefined,
      provider: data.provider as Invoice['provider'],
      providerInvoiceId: data.provider_invoice_id as string,
      amountCents: data.amount_cents as number,
      currency: data.currency as Invoice['currency'],
      status: data.status as Invoice['status'],
      issuedAt: new Date(data.issued_at as string),
      paidAt: data.paid_at ? new Date(data.paid_at as string) : undefined,
      createdAt: new Date(data.created_at as string),
      updatedAt: new Date(data.updated_at as string),
    };
  }
}

/**
 * Webhook Normalizer Interface
 * Converts provider-specific webhook events into normalized domain events
 */

import type { NormalizedEvent, PaymentProvider } from './types';

/**
 * Webhook verification result
 */
export interface WebhookVerificationResult {
  verified: boolean;
  event?: unknown;
  error?: string;
}

/**
 * Webhook Normalizer Interface
 * All payment providers must implement this interface to normalize their webhooks
 */
export interface WebhookNormalizer {
  /**
   * Get the provider name
   */
  provider(): PaymentProvider;

  /**
   * Verify the webhook signature and authenticity
   * @param payload - Raw webhook payload (string or object)
   * @param headers - HTTP headers from the webhook request
   * @param secret - Webhook signing secret
   * @returns Verification result with the parsed event
   */
  verify(
    payload: string | object,
    headers: Record<string, string | string[] | undefined>,
    secret: string
  ): Promise<WebhookVerificationResult>;

  /**
   * Normalize a verified webhook event into a common format
   * @param raw - The verified raw event from the provider
   * @returns Normalized event or null if the event type is not supported
   */
  normalize(raw: unknown): NormalizedEvent | null;

  /**
   * Check if an event type should be processed
   * @param eventType - The provider-specific event type
   * @returns true if the event should be processed
   */
  shouldProcess(eventType: string): boolean;

  /**
   * Extract the idempotency key from the event
   * Used to prevent duplicate processing
   * @param raw - The raw event
   * @returns The unique event ID from the provider
   */
  getEventId(raw: unknown): string | null;
}

# iablee Development TODO

## Core Modules
- [ ] Capsula de tiempo - una persona puede agregar un asset para grabar/escribir contenido a sus descendientes
- [ ] Configuración
- [ ] Modulo de pagos

## Subscription & Payment Module (SaaS)

### Database & Schema
- [ ] Design and implement subscription database schema - create tables for plans, subscriptions, payment_methods, and invoices with proper RLS policies
- [ ] Create subscription plans configuration system - define monthly/yearly tiers with pricing, features, and limits

### Payment Integration
- [ ] Integrate payment provider (Stripe/PayPal) - set up webhooks, tokenization, and subscription management APIs
- [ ] Create API endpoints for subscription management - create/update/cancel subscriptions, handle webhooks, manage payment methods

### User Interface
- [ ] Build subscription UI components - plan selection, billing dashboard, payment method management, and upgrade/downgrade flows
- [ ] Build billing dashboard page - show current plan, usage, billing history, and subscription management options

### Business Logic
- [ ] Update middleware to check subscription status and enforce plan limits - redirect to billing if subscription expired
- [ ] Implement feature gating based on subscription plans - limit asset count, file storage, beneficiary count per plan tier
- [ ] Set up subscription email notifications - payment success/failure, subscription renewal, plan changes, and billing reminders

### Internationalization & Testing
- [ ] Add subscription-related translations for both English and Spanish - billing terms, plan descriptions, error messages
- [ ] Create comprehensive testing suite for subscription flows - unit tests for business logic, integration tests for payment provider
- [ ] Update technical documentation with subscription architecture, payment flows, and webhook handling procedures

## Additional SaaS Features to Consider
- [ ] Usage analytics and reporting dashboard
- [ ] Team/organization management for enterprise plans
- [ ] API rate limiting based on subscription tier
- [ ] Priority support tiers
- [ ] Data export/import features
- [ ] Advanced security features (2FA, SSO) for higher tiers
- [ ] Custom branding options for enterprise plans

# Google Sign In Implementation Guide

This document provides step-by-step instructions for implementing Google Sign In authentication in the iablee-app project using Supabase Auth.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Google Cloud Console Setup](#google-cloud-console-setup)
3. [Supabase Dashboard Configuration](#supabase-dashboard-configuration)
4. [Code Implementation](#code-implementation)
5. [Testing](#testing)
6. [Troubleshooting](#troubleshooting)
7. [Additional Considerations](#additional-considerations)

---

## Prerequisites

Before starting, ensure you have:

- ✅ A Supabase project set up and running
- ✅ Access to your Supabase dashboard
- ✅ A Google Cloud Platform (GCP) account
- ✅ The application running locally or deployed
- ✅ Environment variables configured (`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`)

---

## Google Cloud Console Setup

### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click on the project dropdown at the top
3. Click **"New Project"**
4. Enter a project name (e.g., "iablee-app")
5. Click **"Create"**

### Step 2: Enable Google+ API

1. In the Google Cloud Console, navigate to **APIs & Services** → **Library**
2. Search for **"Google+ API"** or **"Google Identity Services API"**
3. Click on it and press **"Enable"**

### Step 3: Configure OAuth Consent Screen

1. Navigate to **APIs & Services** → **OAuth consent screen**
2. Choose **"External"** (unless you have a Google Workspace account)
3. Click **"Create"**
4. Fill in the required information:
   - **App name**: iablee-app (or your app name)
   - **User support email**: Your email address
   - **Developer contact information**: Your email address
5. Click **"Save and Continue"**
6. On the **Scopes** page, click **"Add or Remove Scopes"**
   - Add the following scopes:
     - `email`
     - `profile`
     - `openid`
7. Click **"Update"** then **"Save and Continue"**
8. On the **Test users** page (if in testing mode), add test users if needed
9. Click **"Save and Continue"** → **"Back to Dashboard"**

### Step 4: Create OAuth 2.0 Credentials

1. Navigate to **APIs & Services** → **Credentials**
2. Click **"+ CREATE CREDENTIALS"** → **"OAuth client ID"**
3. Select **"Web application"** as the application type
4. Give it a name (e.g., "iablee-app-web")
5. Add **Authorized JavaScript origins**:
   - For development: `http://localhost:3000`
   - For production: `https://your-production-domain.com`
6. Add **Authorized redirect URIs**:
   - For development: `http://localhost:3000/auth/callback`
   - For Supabase: `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`
   - For production: `https://your-production-domain.com/auth/callback`
7. Click **"Create"**
8. **IMPORTANT**: Copy the **Client ID** and **Client Secret** - you'll need these for Supabase

---

## Supabase Dashboard Configuration

### Step 1: Enable Google Provider

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Navigate to **Authentication** → **Providers**
4. Find **"Google"** in the list and click on it
5. Toggle **"Enable Google provider"** to ON

### Step 2: Configure Google Credentials

1. In the Google provider settings, enter:
   - **Client ID (for OAuth)**: Paste the Client ID from Google Cloud Console
   - **Client Secret (for OAuth)**: Paste the Client Secret from Google Cloud Console
2. Click **"Save"**

### Step 3: Configure Redirect URLs

1. Still in **Authentication** → **URL Configuration**
2. Ensure your **Site URL** is set correctly:
   - Development: `http://localhost:3000`
   - Production: `https://your-production-domain.com`
3. Add **Redirect URLs**:
   - `http://localhost:3000/**` (for development)
   - `https://your-production-domain.com/**` (for production)
   - `http://localhost:3000/[locale]/auth/callback` (for locale-specific callbacks)
   - `https://your-production-domain.com/[locale]/auth/callback` (for production)

---

## Code Implementation

### Current Implementation Status

The codebase already has a basic Google Sign In implementation in `src/components/auth/auth-form.tsx`. However, you may need to verify and enhance it.

### File: `src/components/auth/auth-form.tsx`

The `handleGoogleSignIn` function should look like this:

```typescript
async function handleGoogleSignIn() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const locale = useLocale(); // Make sure this is available in the component
  const redirectTo = `${origin}/${locale}/auth/callback`;

  console.log('Google OAuth redirect:', redirectTo);

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    }
  });

  if (error) {
    console.error('Google sign in error:', error);
    toast.error(error.message || 'Failed to sign in with Google');
  }
}
```

### Verify Callback Handler

The callback handler at `src/app/[locale]/auth/callback/page.tsx` should already handle OAuth callbacks. Verify it includes:

```typescript
useEffect(() => {
  async function handleAuth() {
    try {
      // Supabase automatically handles the OAuth callback
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (!error && session) {
        // Your existing redirect logic...
      } else {
        router.replace(`/${locale}/auth/login`);
      }
    } catch (error) {
      console.error('Auth callback error:', error);
      router.replace(`/${locale}/auth/login`);
    }
  }
  handleAuth();
}, [router, searchParams, locale]);
```

### Optional: Enhanced Error Handling

Consider adding better error handling in the auth form:

```typescript
async function handleGoogleSignIn() {
  setIsLoading(true);
  
  try {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const redirectTo = `${origin}/${locale}/auth/callback`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
      }
    });

    if (error) {
      throw error;
    }
    // Note: User will be redirected, so no need to show success toast here
  } catch (error) {
    console.error('Google sign in error:', error);
    toast.error(
      error instanceof Error 
        ? error.message 
        : 'Failed to sign in with Google. Please try again.'
    );
  } finally {
    setIsLoading(false);
  }
}
```

---

## Testing

### Local Testing

1. **Start your development server**:
   ```bash
   npm run dev
   ```

2. **Navigate to the login page**: `http://localhost:3000/en/auth/login` (or your locale)

3. **Click "Sign in with Google"**

4. **Expected flow**:
   - You should be redirected to Google's sign-in page
   - After signing in, you'll be redirected back to `/auth/callback`
   - The callback handler should process the session
   - You should be redirected to `/wizard` (if no assets) or `/dashboard` (if assets exist)

### Testing Checklist

- [ ] Google Sign In button is visible and clickable
- [ ] Clicking the button redirects to Google OAuth page
- [ ] After Google authentication, user is redirected back to the app
- [ ] User session is created in Supabase
- [ ] User is redirected to the correct page (wizard or dashboard)
- [ ] User data (email, name) is available in the session
- [ ] User can sign out successfully

### Production Testing

Before deploying to production:

1. Update Google Cloud Console with production URLs
2. Update Supabase redirect URLs with production domain
3. Test the full flow in production environment
4. Verify that the OAuth consent screen is published (if needed)

---

## Troubleshooting

### Common Issues

#### 1. "redirect_uri_mismatch" Error

**Problem**: The redirect URI doesn't match what's configured in Google Cloud Console.

**Solution**:
- Verify the redirect URI in Google Cloud Console matches exactly
- Check that Supabase redirect URL includes: `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`
- Ensure your app's redirect URL matches: `http://localhost:3000/[locale]/auth/callback`

#### 2. "invalid_client" Error

**Problem**: Client ID or Client Secret is incorrect.

**Solution**:
- Double-check the Client ID and Client Secret in Supabase dashboard
- Ensure there are no extra spaces when copying/pasting
- Verify the credentials are for the correct Google Cloud project

#### 3. User Not Redirected After Sign In

**Problem**: Callback handler not processing the session correctly.

**Solution**:
- Check browser console for errors
- Verify the callback route is accessible
- Check that `supabase.auth.getSession()` is being called correctly
- Ensure the redirect URL in `signInWithOAuth` matches the callback route

#### 4. Session Not Persisting

**Problem**: User session is lost after redirect.

**Solution**:
- Verify Supabase cookies are being set correctly
- Check that middleware is reading cookies properly
- Ensure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set correctly

#### 5. OAuth Consent Screen Issues

**Problem**: "This app isn't verified" warning or consent screen errors.

**Solution**:
- For development: Add test users in Google Cloud Console
- For production: Complete OAuth consent screen verification
- Ensure all required scopes are added
- Submit for verification if handling sensitive scopes

### Debug Steps

1. **Check Browser Console**: Look for JavaScript errors or network failures
2. **Check Supabase Logs**: Go to Supabase Dashboard → Logs → Auth Logs
3. **Verify Environment Variables**: Ensure all required env vars are set
4. **Test in Incognito Mode**: Rule out browser extension or cache issues
5. **Check Network Tab**: Verify OAuth redirects are happening correctly

---

## Additional Considerations

### User Profile Data

When a user signs in with Google, Supabase automatically extracts:
- `email` - User's Google email
- `user_metadata.full_name` - User's name from Google
- `user_metadata.avatar_url` - User's profile picture (if available)

You may want to sync this data to your `users` table. Consider adding a database trigger or updating the callback handler:

```typescript
// In callback handler or after successful sign in
if (session?.user) {
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('id', session.user.id)
    .single();

  if (!existingUser) {
    // Create user record
    await supabase.from('users').insert({
      id: session.user.id,
      email: session.user.email,
      full_name: session.user.user_metadata?.full_name || '',
    });
  } else {
    // Update user record if needed
    await supabase
      .from('users')
      .update({
        email: session.user.email,
        full_name: session.user.user_metadata?.full_name || existingUser.full_name,
      })
      .eq('id', session.user.id);
  }
}
```

### Account Linking

If a user signs up with email/password and later wants to link Google, you'll need to implement account linking. Supabase supports this via `linkIdentity()`:

```typescript
const { data, error } = await supabase.auth.linkIdentity({
  provider: 'google',
});
```

### Internationalization

The current implementation supports locales. Ensure:
- Redirect URLs include the locale: `${origin}/${locale}/auth/callback`
- Error messages are translated (if using next-intl)
- UI text for Google Sign In button is translated

### Security Best Practices

1. **Always use HTTPS in production**
2. **Keep Client Secret secure** - never expose it in client-side code
3. **Validate redirect URLs** - ensure they match your domain
4. **Use Row Level Security (RLS)** - already implemented in your app
5. **Monitor auth logs** - regularly check Supabase auth logs for suspicious activity

### Production Deployment

Before going live:

1. ✅ Update all redirect URLs to production domain
2. ✅ Complete OAuth consent screen verification (if required)
3. ✅ Test the full authentication flow
4. ✅ Set up monitoring and error tracking
5. ✅ Document any custom configurations
6. ✅ Update environment variables in your hosting platform

---

## Summary

To implement Google Sign In:

1. **Google Cloud Console**: Create OAuth credentials and configure consent screen
2. **Supabase Dashboard**: Enable Google provider and add credentials
3. **Code**: Verify existing implementation in `auth-form.tsx`
4. **Test**: Test locally and in production
5. **Monitor**: Check logs and handle edge cases

The codebase already has most of the implementation in place. The main work is configuring Google Cloud Console and Supabase Dashboard correctly.

---

## Resources

- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)
- [Supabase OAuth Providers](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Next.js Authentication](https://nextjs.org/docs/authentication)

---

## Notes for AI Coders

When implementing this:

1. **Follow the order**: Google Cloud Console → Supabase Dashboard → Code verification
2. **Test incrementally**: After each step, test to catch issues early
3. **Check existing code**: The `handleGoogleSignIn` function already exists - verify it works
4. **Handle errors gracefully**: Add proper error handling and user feedback
5. **Consider edge cases**: What if user cancels? What if email already exists?
6. **Update translations**: If using i18n, ensure Google Sign In button text is translated
7. **Document changes**: Update this document if you make significant changes

Good luck! 🚀


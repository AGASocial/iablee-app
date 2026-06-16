# Fix Supabase Redirect URLs for Localhost

## ✅ Current Configuration
I can see your Supabase configuration already has:
- **Site URL**: `https://app.iablee.com`
- **Redirect URLs**: 
  - `https://app.iablee.com`
  - `http://localhost:3000`

## 🔧 Required redirect URLs

Password reset, email verification, and OAuth all rely on `/api/auth/callback`. If this URL is missing from the allowlist, Supabase falls back to **Site URL only** (`http://localhost:3000`) and the recovery link will land on the home page with a `code` query param instead of the reset-password page.

### Add these URLs in Supabase → Authentication → URL Configuration → Redirect URLs:

```
http://localhost:3000/api/auth/callback
http://localhost:3000/api/auth/callback?next=/en/auth/reset-password
http://localhost:3000/api/auth/callback?next=/es/auth/reset-password
https://app.iablee.com/api/auth/callback
https://app.iablee.com/api/auth/callback?next=/en/auth/reset-password
https://app.iablee.com/api/auth/callback?next=/es/auth/reset-password
```

Optional (legacy client callback page):

```
http://localhost:3000/en/auth/callback
http://localhost:3000/es/auth/callback
```

### Step-by-Step:

1. **In your Supabase Dashboard** → Authentication → URL Configuration
2. **Click "Add URL"** and add each of the above URLs
3. **Save the changes**

## 🧪 Test the Fix

1. **Restart your development server**:
   ```bash
   npm run dev
   ```

2. **Try logging in** - check the browser console for the redirect URLs being used

3. **Test OAuth login** (Google/Apple) - this should now work with localhost

## 🔍 Debugging

If you're still having issues:

1. **Check browser console** when logging in - you should see logs like:
   ```
   Google OAuth redirect: http://localhost:3000/en/auth/callback
   ```

2. **Verify the callback page** works: `http://localhost:3000/en/auth/callback`

3. **Clear browser cache** if redirects are still cached

## 📝 Why This Matters

- **Email/password login** uses the general redirect URLs
- **OAuth login** (Google/Apple) needs the specific callback URLs
- **Locale support** requires separate URLs for `/en/` and `/es/` paths 
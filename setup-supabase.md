# Supabase Setup Guide

## 🚨 Current Issue
Your current Supabase project URL `https://lrnhrzpwgyhkruwxeppw.supabase.co` is not accessible, causing repeated failed authentication requests.

## ✅ Solution: Create a New Supabase Project

### Step 1: Create a New Project
1. Go to [https://supabase.com](https://supabase.com)
2. Sign in or create an account
3. Click "New Project"
4. Choose your organization
5. Enter project details:
   - **Name**: `iablee-app` (or your preferred name)
   - **Database Password**: Choose a strong password
   - **Region**: Choose the closest region to your users

### Step 2: Get Your Credentials
1. Once the project is created, go to **Settings** → **API**
2. Copy the following values:
   - **Project URL** (starts with `https://`)
   - **anon public** key (starts with `eyJ...`)

### Step 3: Update Environment Variables
Replace the contents of your `.env` file with:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-new-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-new-anon-key
```

### Step 4: Set Up Database Schema
Run the existing migrations in your `supabase/migrations/` folder:

```bash
# If you have Supabase CLI installed
supabase db push

# Or manually run the SQL in your Supabase dashboard
```

### Step 5: Test the Connection
1. Restart your development server: `npm run dev`
2. Check the browser console - you should no longer see the repeated failed requests
3. Try logging in - the authentication should work properly

## 🔧 Alternative: Use Supabase CLI

If you prefer using the CLI:

```bash
# Install Supabase CLI
npm install -g supabase

# Login to Supabase
supabase login

# Create a new project
supabase projects create iablee-app

# Get the project credentials
supabase projects list
```

## 📝 Important Notes

- **Never commit your `.env` file** to version control
- **Keep your anon key public** - it's designed to be exposed to the client
- **Keep your service role key secret** - only use it on the server side
- **The project URL should end with `.supabase.co`**

## 🆘 Need Help?

If you're still having issues:
1. Check the Supabase status page: [https://status.supabase.com](https://status.supabase.com)
2. Verify your network connection
3. Try accessing the Supabase dashboard directly
4. Check the browser console for more specific error messages 
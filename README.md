# Iablee App

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

### Prerequisites

1. Node.js (version 18 or higher)
2. A Supabase project

### Environment Setup

1. Create a `.env.local` file in the root directory with your Supabase credentials:

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

You can find these values in your Supabase project dashboard under Settings > API.

### Installation

1. Install dependencies:

```bash
npm install
# or
yarn install
# or
pnpm install
```

2. Run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

3. Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Features

- **Internationalization**: Support for English and Spanish
- **Authentication**: Supabase Auth with email/password and OAuth (Google, Apple)
- **Protected Routes**: Automatic redirect to login for unauthenticated users
- **Digital Assets Management**: Secure storage and management of digital assets
- **Beneficiary Management**: Add and manage beneficiaries for your assets

## Authentication Flow

The app includes automatic authentication redirects:

- Unauthenticated users are redirected to `/auth/login`
- Authenticated users trying to access auth pages are redirected to `/dashboard`
- OAuth callbacks are handled automatically

## Project Structure

- `src/app/[locale]/` - Internationalized pages
- `src/components/` - Reusable UI components
- `src/lib/supabase.ts` - Supabase client configuration
- `src/middleware.ts` - Authentication and internationalization middleware
- `messages/` - Translation files for internationalization

## Learn More

To learn more about the technologies used:

- [Next.js Documentation](https://nextjs.org/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [Next-intl Documentation](https://next-intl-docs.vercel.app/)

## Development

### Git Hooks

This project includes a pre-commit hook that automatically runs quality checks before each commit:

- **Linting**: Runs `npm run lint` to check for code style and potential issues
- **Building**: Runs `npm run build` to ensure the code compiles successfully

The hook will prevent commits if either check fails, ensuring code quality.

To manually test the pre-commit hook:
```bash
.git/hooks/pre-commit
```

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint checks

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

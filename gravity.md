# Gravity Rules

## Architectural Constraints

### 1. No Direct Supabase Calls from Frontend
- **Constraint**: The Frontend (client components, pages, hooks) MUST NEVER call Supabase directly using `createBrowserClient` or similar methods for data fetching or mutations.
- **Requirement**: All interactions with the database or authentication services must proceed through Next.js API routes (Route Handlers).
- **Implementation Pattern**:
  - **Frontend**: Use `fetch`, `axios`, or React Query to call internal API endpoints (e.g., `/api/user/profile`).
  - **Backend (API Routes)**: Use server-side Supabase clients (e.g., `createAuthenticatedRouteClient`) to securely interact with Supabase.
  - **Exception**: Real-time subscriptions might require a client connection, but standard CRUD operations should be proxied.

## Rationale
- **Security**: Keeps database logic, schemas, and sensitive operations hidden from the client.
- **Abstraction**: Decouples the frontend from the specific backend implementation (Supabase), making future migrations or changes easier.
- **Control**: Allows for centralized validation, rate limiting, and business logic execution on the server before database access.

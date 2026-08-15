# M-Pesa Business Manager patch

## Changes
- Demo mode is now explicit via `DEMO_MODE=true`; missing Supabase credentials no longer silently enable demo mode.
- Prisma now fails fast with a useful error when `DATABASE_URL` is missing.
- Sign-in UI was redesigned with clearer demo onboarding and stronger visual hierarchy.
- Global design tokens and auth styling were refreshed for a cleaner, more polished dark UI.
- `.env.example` documents the new explicit demo-mode switch.

## Apply
Copy the files in this archive over the matching paths in your checkout.

Then:
1. `cp .env.example .env`
2. Ensure PostgreSQL is running.
3. `npm run db:setup`
4. `npm run typecheck`
5. `npm run lint`
6. `npm run build`

For a real deployment, set `DEMO_MODE=false` and configure Supabase.

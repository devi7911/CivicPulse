# CivicPulse

A civic engagement app for Hyderabad: report problems, get SOS help, find events, host community
contributions, and follow up on what's being fixed. React + TypeScript + Tailwind on the frontend,
Supabase (Postgres, Auth, Storage, row-level security) on the backend. AI features (report
auto-fill, admin department routing) use Google's Gemini free tier; email alerts use Resend's free
tier.

## Getting started

```bash
cd web
npm install
cp .env.example .env   # fill in your own Supabase project URL and publishable key
npm run dev
```

Other commands (run from `web/`): `npm run build`, `npm test`, `npm run typecheck`.

Database schema and logic live in `supabase/migrations/`, applied in order to a Supabase project.
See the comments at the top of `0039_ai_department_routing.sql`, `0046_ai_report_autofill.sql` and
`0047_email_alerts.sql` for the one-line `vault.create_secret(...)` commands needed to turn on the
AI and email features — none of that runs without a key you add yourself.

## Test accounts

For trying out the app locally without a real sign-up. Created by
[`supabase/seed/test_accounts.sql`](supabase/seed/test_accounts.sql), run once against the
project's SQL editor. **Development only — do not reuse this password for anything real,** and
rotate or remove these accounts before this project (or its database) is ever made public or
shared with anyone you don't trust with admin access.

| Email | Password | What it's for |
|---|---|---|
| `admin@civicpulse.test` | `Test@12345` | Admin console, dashboard, ticket queue, moderation |
| `admin2@civicpulse.test` | `Test@12345` | A second admin, for testing that one admin can't edit a ticket another has claimed |
| `ngo@civicpulse.test` | `Test@12345` | Verified NGO — org badge, hosting events, Community Contributions |
| `gov@civicpulse.test` | `Test@12345` | Verified government body — same as NGO, plus the "Official" label on comments |
| `citizen@civicpulse.test` | `Test@12345` | Unverified individual, for comparison against the verified accounts above |

Not yet covered: verified `community`, `business` and `education` accounts. Ask for the same kind
of setup script to add them if you need to test those specifically.

These are separate from the fictional `@example.invalid` sample data (reports, comments, events)
seeded earlier for demos — those accounts have no password and can't be signed into.

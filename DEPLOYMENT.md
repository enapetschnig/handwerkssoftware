# Deployment — ePower GmbH (Handwerkssoftware)

Backend: **Supabase project `epowergmbh`** (`xyhgckqxowqnzjtoblfs`), isolated Postgres schema **`hws`**.
The app runs side-by-side with the two existing apps in that project (`public`, `cockpit`) and never touches them.

## Vercel

- Framework: **Vite** · Build: `npm run build` · Output: `dist` (see `vercel.json`, includes the SPA rewrite).
- Environment variables (Project → Settings → Environment Variables):

| Name | Value |
|------|-------|
| `VITE_SUPABASE_URL` | `https://xyhgckqxowqnzjtoblfs.supabase.co` |
| `VITE_SUPABASE_KEY` | `sb_publishable_akH66S1-i4WaHAbVrCd50A_qd7OrwfD` |

That's all the frontend needs. (These are public publishable values.)

## Login

- Admin: **cnapetschnig@gmail.com** / (your password) — already active with full admin rights.

## Edge-function secrets (Supabase → epowergmbh → Edge Functions → Secrets)

Already set and reused: `OPENAI_API_KEY`, `RESEND_API_KEY`, `WAPI_TOKEN`, `GOOGLE_SERVICE_ACCOUNT_KEY`, `CRON_SECRET`, and the auto `SUPABASE_*`.

Still needed for the corresponding features (set the value in Supabase; leave blank to disable that feature):

| Secret | Needed for |
|--------|-----------|
| `RESEND_FROM_EMAIL` | Sending invoices/offers/reports by email (verified Resend sender, e.g. `ePower GmbH <office@epower.at>`) |
| `EMAIL_DEFAULT_REPLY_TO` | Optional reply-to for outgoing mail |
| `APP_URL` | Invitation links — set to your Vercel URL after first deploy |
| `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | Inbound WhatsApp webhook (only if using WhatsApp) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | SMS invitations (optional; WhatsApp used otherwise) |

## Notes

- All app tables live in schema `hws`; the client sets `db.schema = 'hws'`.
- Edge functions are deployed under `hws-*` slugs so they don't collide with the other apps' functions.
- Storage buckets are `hws-*` prefixed.
- Branding assets (logo/name in `index.html` + `/public`) still say MONTI/BKS — swap for ePower when ready.

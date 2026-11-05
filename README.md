# Uncommon Intake: Backend

The backend for [Uncommon Intake](https://github.com/goldenboymoyo-gif/uncommon-intake), built on
Supabase. It holds the database, access rules, file storage, scheduled jobs and all server code,
including every AI call. The app never talks to the AI directly and never holds a secret.

Project scope: [PROJECT_SCOPE.md](PROJECT_SCOPE.md)

## Structure

```
migrations/   Database tables, Row Level Security, storage buckets, triggers and pg_cron jobs
functions/    Edge Functions (Deno, TypeScript)
  _shared/    AI helper (OpenAI, Hugging Face fallback), document reading, auth, emails, push
setup/        SQL templates for setting up a real intake
templates/    Email templates for sign in codes
config.toml   Supabase settings
```

## Edge Functions

| Function | What it does |
| --- | --- |
| `check-cv` | Saves an uploaded CV or motivation letter; AI checks it is the right kind of document |
| `generate-questions` | AI writes 10 interview questions from the CV and letter |
| `process-answer` | Speech to text for voice and video answers, then an AI summary for staff |
| `decide` | Saves a staff decision and tells the applicant (app, push and email) |
| `confirm-place` | An accepted applicant confirms their place and becomes a student |
| `coach-chat`, `coach-feedback` | Career coach for CVs, cover letters and interviews |
| `english-tutor` | English placement, lessons, marking and Listen |
| `survey-themes` | AI finds themes in survey answers, linked to the original answers |
| `notify-students` | Staff messages, new surveys and job opportunities |
| `staff-access` | Staff sign up, hub approvals and transfers |
| `set-graduate` | Marks a student as a graduate |
| `student-reminders` | LinkedIn reminders and weekly updates (pg_cron) |
| `purge-media` | Deletes interview recordings after about 90 days (pg_cron) |
| `delete-account` | Deletes an account and all its files |

## Setup

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
npx supabase functions deploy --use-api
```

Set these secrets in the Supabase dashboard (Edge Functions, Secrets): `AI_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_TRANSCRIBE_MODEL`,
`GMAIL_USER`, `GMAIL_APP_PASSWORD`, `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.
Never commit real values.

## Security

- Row Level Security on every table: staff only see their own hub, applicants only their own data.
- Private storage buckets with expiring links.
- Every function checks who is calling before doing anything.
- AI keys and email passwords live only in Supabase secrets.
- AI helps but never decides anything about a person.

# Project Scope: Uncommon Intake

## Repositories

| Part | Repository | What is in it |
| --- | --- | --- |
| Frontend | https://github.com/goldenboymoyo-gif/uncommon-intake | Android app and website (React Native, Expo, TypeScript) |
| Backend | https://github.com/goldenboymoyo-gif/uncommon-intake-backend | Database, access rules, storage, scheduled jobs and server functions with all AI (Supabase) |

Live website: https://uncommon-intake.netlify.app (the Android app downloads from it)

## Problem

Uncommon.org runs a free, 12 month technology bootcamp for unemployed young adults across 13
Innovation Hubs in Zimbabwe. Applying, reviewing applicants and supporting students happened in
different places. Most applicants only have a phone and expensive, slow data.

## Goal

One mobile first system where people apply, staff review and decide, and students get support
during and after the bootcamp, with AI helping people but never deciding.

## Users

| User | What they can do |
| --- | --- |
| Applicant | Create an account, apply, upload a CV and motivation letter, answer interview questions, follow status |
| Student | Career coach, English Tutor, jobs, surveys, attendance, LinkedIn reminders, progress |
| Graduate | Career coach, English Tutor and job opportunities after the bootcamp |
| Staff | Review and decide on applicants from their own hub, surveys, messages, jobs, outcomes |
| Hub lead | Everything staff can do, plus approving staff for their hub |
| Admin | Everything, across all hubs, plus managing staff accounts |

## In scope

**Frontend (app and website)**
- Email code sign up and sign in, no passwords
- Application form with autosave, CV (or "about you") and motivation letter upload
- Interview by text, voice or video, saved offline and uploaded when the network allows
- Status timeline, decision notifications and email, confirm place
- Career coach chat, English Tutor with Listen, job opportunities, surveys, progress page, bio
- Staff review board, applicant pages (answers, recordings, transcripts, summaries, CV, letter, notes),
  accept, waitlist or decline, overview, surveys with themes, jobs, outcomes, graduate stories,
  staff sign up and approvals, account deletion
- Works on Android, laptops and iPhone (website added to the home screen); low data mode

**Backend (Supabase)**
- PostgreSQL database with Row Level Security on every table and hub based access
- Private file storage with expiring links
- Edge Functions: interview questions, answer transcripts and summaries, document check, coach,
  English Tutor, survey themes, decisions, emails and notifications, staff access, account deletion
- Scheduled jobs: LinkedIn reminders, weekly student updates, deleting old recordings

**AI (OpenAI, server side only)**
- Checks uploaded files are a CV or letter, writes 10 personal interview questions, speech to text,
  answer summaries, survey themes, career coaching and English teaching, text to speech
- AI never accepts, rejects, ranks or scores anyone. Staff decide.

## Out of scope

- AI making or suggesting decisions about applicants
- Face, voice tone or emotion analysis
- iPhone App Store release (needs an Apple Developer account; iPhone users use the website)
- Payments (the bootcamp is free)

## Technology

React Native with Expo (SDK 57), TypeScript, Expo Router, Supabase (PostgreSQL, Auth, Storage,
Edge Functions, pg_cron), OpenAI (`gpt-6-luna`, `gpt-transcribe`, `gpt-4o-mini-tts`), Netlify,
Expo EAS Build and Update.

## Deliverables

- Working, deployed application (website and Android app)
- Frontend and backend repositories with commit history
- README with setup, AI integration, limitations, screenshots and the ethical AI statement

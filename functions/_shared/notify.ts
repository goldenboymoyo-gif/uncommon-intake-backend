import nodemailer from 'npm:nodemailer@6.9.16';
import { adminClient } from './clients.ts';
import { sendWebPush } from './webpush.ts';

// Saves an in-app notification, sends a push (Expo and website) and, if asked, an email (Gmail, or Resend).
// Decisions are never sent by WhatsApp or phone call.
export async function notify(opts: {
  userId: string;
  kind: 'decision' | 'reminder' | 'survey' | 'general';
  title: string;
  body: string;
  pushToken?: string | null;
  email?: string | null;
}) {
  const db = adminClient();
  await db.from('notifications').insert({ user_id: opts.userId, kind: opts.kind, title: opts.title, body: opts.body });

  if (opts.pushToken) {
    try {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: opts.pushToken, title: opts.title, body: opts.body, sound: 'default', data: { kind: opts.kind } }),
      });
    } catch (e) {
      console.error('push failed', e);
    }
  }

  await sendWebPush(db, [opts.userId], { title: opts.title, body: opts.body, url: opts.kind === 'decision' ? '/status' : opts.kind === 'survey' ? '/surveys' : '/notifications' });

  const gmailUser = Deno.env.get('GMAIL_USER');
  const gmailPassword = Deno.env.get('GMAIL_APP_PASSWORD');
  if (opts.email && gmailUser && gmailPassword) {
    try {
      // Port 465: Edge Functions cannot use port 587.
      const mail = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: gmailUser, pass: gmailPassword } });
      await mail.sendMail({
        from: `Uncommon Intake <${gmailUser}>`,
        to: opts.email,
        subject: opts.title,
        text: `${opts.body}\n\nOpen Uncommon Intake to see more.`,
      });
    } catch (e) {
      console.error('email failed', e);
    }
    return;
  }

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('EMAIL_FROM');
  if (opts.email && resendKey && from) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: opts.email,
          subject: opts.title,
          text: `${opts.body}\n\nOpen the Uncommon Intake app to see more.`,
        }),
      });
    } catch (e) {
      console.error('email failed', e);
    }
  }
}

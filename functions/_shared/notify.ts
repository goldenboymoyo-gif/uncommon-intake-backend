import { adminClient } from './clients.ts';

// Saves an in-app notification, sends a push (Expo) and, if asked, an email (Resend).
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

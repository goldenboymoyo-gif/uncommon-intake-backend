// Runs from pg_cron. Sends the LinkedIn reminder on weekdays until a student sends their link,
// and on Friday a short update built only from that student's real numbers.
import { fail, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/clients.ts';
import { sendWebPush } from '../_shared/webpush.ts';

type Message = { id: string; push_token: string | null; title: string; body: string };

async function send(db: ReturnType<typeof adminClient>, messages: Message[]) {
  if (!messages.length) return;
  await db.from('notifications').insert(messages.map((m) => ({ user_id: m.id, kind: 'reminder', title: m.title, body: m.body })));

  // Expo accepts up to 100 messages per request.
  const withToken = messages.filter((m) => m.push_token);
  for (let i = 0; i < withToken.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withToken.slice(i, i + 100).map((m) => ({ to: m.push_token, title: m.title, body: m.body, sound: 'default', data: { kind: 'reminder' } }))),
    }).catch((e) => console.error('push failed', e));
  }
  for (const m of messages) {
    await sendWebPush(db, [m.id], { title: m.title, body: m.body, url: '/progress' }).catch((e) => console.error('web push failed', e));
  }
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return fail('Not allowed.', 401);
  try {
    const { run } = await req.json();
    const db = adminClient();

    if (run === 'linkedin') {
      const { data, error } = await db.rpc('linkedin_reminder_list');
      if (error) throw error;
      const people = (data ?? []) as { id: string; push_token: string | null }[];
      await send(db, people.map((p) => ({
        ...p,
        title: 'Post on LinkedIn this week',
        body: 'Share what you are building on LinkedIn, then send us your post link in the app.',
      })));
      return json({ sent: people.length });
    }

    if (run === 'update') {
      const { data, error } = await db.rpc('weekly_numbers');
      if (error) throw error;
      const people = (data ?? []) as { id: string; push_token: string | null; attended: number; days_open: number; confirmed: number; posted: boolean }[];
      await send(db, people.map((p) => ({
        id: p.id,
        push_token: p.push_token,
        title: 'Your week',
        body: [
          p.days_open ? `You attended ${p.attended} of ${p.days_open} days this week.` : 'Attendance was not taken at your hub this week.',
          `You have ${p.confirmed} confirmed ${p.confirmed === 1 ? 'project' : 'projects'} so far.`,
          p.posted ? 'You sent your LinkedIn post.' : 'You did not send a LinkedIn post this week.',
        ].join(' '),
      })));
      return json({ sent: people.length });
    }

    return fail('Unknown run.');
  } catch (e) {
    console.error(e);
    return fail('The reminders did not send.', 500);
  }
});

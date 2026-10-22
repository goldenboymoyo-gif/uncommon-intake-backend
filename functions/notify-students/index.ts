// Staff send a message to every student: a new survey, or a short announcement.
// Each student gets an in-app notification and a phone pop-up (push), even when the app is closed.
import { corsHeaders, fail, json } from '../_shared/cors.ts';
import { adminClient, getCaller, isStaffRole } from '../_shared/clients.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const caller = await getCaller(req);
    if (!caller || !isStaffRole(caller.role)) return fail('Only staff can do this.', 403);

    const { kind, title, body } = await req.json();
    if (!['survey', 'general'].includes(kind)) return fail('Unknown message type.');
    const cleanTitle = String(title ?? '').trim().slice(0, 80);
    const cleanBody = String(body ?? '').trim().slice(0, 300);
    if (!cleanTitle || !cleanBody) return fail('Please add a title and a message.');

    const db = adminClient();
    const { data: students } = await db.from('profiles').select('id, push_token').eq('role', 'student');
    const list = students ?? [];
    if (!list.length) return json({ sent: 0 });

    await db.from('notifications').insert(list.map((s) => ({ user_id: s.id, kind, title: cleanTitle, body: cleanBody })));

    // Expo accepts up to 100 messages per request.
    const tokens = list.map((s) => s.push_token).filter(Boolean) as string[];
    for (let i = 0; i < tokens.length; i += 100) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          tokens.slice(i, i + 100).map((to) => ({ to, title: cleanTitle, body: cleanBody, sound: 'default', data: { kind } })),
        ),
      }).catch((e) => console.error('push failed', e));
    }
    return json({ sent: list.length });
  } catch (e) {
    console.error(e);
    return fail('We could not send the message. Please try again.', 500);
  }
});

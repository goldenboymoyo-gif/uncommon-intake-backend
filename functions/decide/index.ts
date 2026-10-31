// A staff member records a decision. A person decides; this function only saves and sends it.
import { corsHeaders, fail, json } from '../_shared/cors.ts';
import { adminClient, canSeeHub, getCaller, isStaffRole } from '../_shared/clients.ts';
import { notify } from '../_shared/notify.ts';

const messages = {
  accepted: {
    title: 'You have a place in the Uncommon bootcamp',
    body: 'Well done. Our team has offered you a place. Open the app and tap "Confirm my place".',
  },
  waitlisted: {
    title: 'You are on the waiting list',
    body: 'Our team has put your application on the waiting list. We will tell you if a place opens up.',
  },
  not_accepted: {
    title: 'An update on your application',
    body: 'Thank you for applying. Our team was not able to offer you a place this time.',
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const caller = await getCaller(req);
    if (!caller || !isStaffRole(caller.role)) return fail('Only staff can do this.', 403);

    const { application_id, decision } = await req.json();
    if (!(decision in messages)) return fail('Please choose a decision.');

    const db = adminClient();
    const { data: target } = await db.from('applications').select('hub_id').eq('id', application_id).maybeSingle();
    if (!target || !canSeeHub(caller, target.hub_id)) return fail('This applicant applied to another hub.', 403);

    const { data: app, error } = await db
      .from('applications')
      .update({ decision, review_status: decision, decided_by: caller.id, decided_at: new Date().toISOString() })
      .eq('id', application_id)
      .select('id, applicant_id, profiles!applications_applicant_id_fkey(email, push_token)')
      .single();
    if (error || !app) return fail('We could not save the decision.');

    await db.from('decision_log').insert({ application_id, decision, decided_by: caller.id });

    const msg = messages[decision as keyof typeof messages];
    await notify({
      userId: app.applicant_id,
      kind: 'decision',
      title: msg.title,
      body: msg.body,
      pushToken: app.profiles?.push_token,
      email: app.profiles?.email,
    });
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return fail('Something went wrong. Please try again.', 500);
  }
});

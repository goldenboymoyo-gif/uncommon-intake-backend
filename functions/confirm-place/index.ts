// An accepted applicant confirms their place and becomes a student.
import { corsHeaders, fail, json } from '../_shared/cors.ts';
import { adminClient, getCaller } from '../_shared/clients.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const caller = await getCaller(req);
    if (!caller) return fail('Please sign in again.', 401);
    const { application_id } = await req.json();

    const db = adminClient();
    const { data: app } = await db
      .from('applications')
      .select('id, applicant_id, decision')
      .eq('id', application_id)
      .single();
    if (!app || app.applicant_id !== caller.id) return fail('Application not found.', 404);
    if (app.decision !== 'accepted') return fail('Only accepted applicants can confirm a place.');

    await db.from('applications').update({ place_confirmed_at: new Date().toISOString() }).eq('id', application_id);
    if (caller.role === 'applicant') await db.from('profiles').update({ role: 'student' }).eq('id', caller.id);
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return fail('Something went wrong. Please try again.', 500);
  }
});

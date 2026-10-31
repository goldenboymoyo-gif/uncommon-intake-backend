// Staff mark a person as a graduate, using the email on their account.
// Graduates keep the career coach and job opportunities after the bootcamp.
import { corsHeaders, fail, json } from '../_shared/cors.ts';
import { adminClient, getCaller, isStaffRole } from '../_shared/clients.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const caller = await getCaller(req);
    if (!caller || !isStaffRole(caller.role)) return fail('Only staff can do this.', 403);

    const email = String((await req.json()).email ?? '').trim().toLowerCase();
    if (!email.includes('@')) return fail('Please type a valid email.');

    const db = adminClient();
    const { data: person } = await db.from('profiles').select('id, role, first_names, surname, hub_id').ilike('email', email).maybeSingle();
    if (!person) return fail('We found no account with that email. They need to create an account first.', 404);
    if (isStaffRole(person.role)) return fail('This is a staff account.');

    // A graduate with no hub yet joins the hub of the staff member adding them.
    if (caller.role !== 'admin' && (!caller.hub_id || (person.hub_id && person.hub_id !== caller.hub_id))) {
      return fail('This person belongs to another hub.', 403);
    }
    const { error } = await db.from('profiles').update({ role: 'graduate', hub_id: person.hub_id ?? caller.hub_id }).eq('id', person.id);
    if (error) throw error;
    return json({ name: `${person.first_names} ${person.surname}`.trim() });
  } catch (e) {
    console.error(e);
    return fail('We could not update this account. Please try again.', 500);
  }
});

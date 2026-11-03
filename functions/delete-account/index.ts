// A person deletes their own account and everything we hold about them:
// their files (CV, recordings, photo, coach files) and all their rows (removed with the account).
// Staff can also delete an applicant's or student's account from their own hub; admins from any hub.
// Staff accounts are removed by an admin instead, so decisions keep a record of who made them.
import { corsHeaders, fail, json } from '../_shared/cors.ts';
import { adminClient, canSeeHub, getCaller, isStaffRole } from '../_shared/clients.ts';

const BUCKETS = ['application-cvs', 'interview-media', 'avatars', 'coach-files', 'letters'];

async function removeFolder(db: ReturnType<typeof adminClient>, bucket: string, prefix: string) {
  const { data } = await db.storage.from(bucket).list(prefix, { limit: 1000 });
  for (const item of data ?? []) {
    const path = `${prefix}/${item.name}`;
    if (item.id) await db.storage.from(bucket).remove([path]);
    else await removeFolder(db, bucket, path); // a folder
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const caller = await getCaller(req);
    if (!caller) return fail('Please sign in again.', 401);
    const body = await req.json().catch(() => ({}));
    const db = adminClient();
    let userId = caller.id;

    if (body.user_id && body.user_id !== caller.id) {
      if (!isStaffRole(caller.role)) return fail('Only staff can do this.', 403);
      const { data: person } = await db.from('profiles').select('id, role, hub_id').eq('id', body.user_id).maybeSingle();
      if (!person) return fail('This account was not found.', 404);
      if (isStaffRole(person.role)) return fail('Staff accounts are removed on Staff accounts.', 403);
      const { data: apps } = await db.from('applications').select('hub_id').eq('applicant_id', person.id);
      const hubs = [person.hub_id, ...(apps ?? []).map((a) => a.hub_id)].filter(Boolean);
      if (!hubs.some((h) => canSeeHub(caller, h))) return fail('This person belongs to another hub.', 403);
      userId = person.id;
    } else if (isStaffRole(caller.role)) {
      return fail('Staff accounts are removed by an admin.', 403);
    }

    for (const bucket of BUCKETS) await removeFolder(db, bucket, userId);
    // Deleting the login removes the profile, application, answers and notifications with it.
    const { error } = await db.auth.admin.deleteUser(userId);
    if (error) throw error;
    return json({ deleted: true });
  } catch (e) {
    console.error(e);
    return fail('We could not delete the account. Please try again or contact Uncommon.', 500);
  }
});

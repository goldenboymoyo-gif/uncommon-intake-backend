// A person deletes their own account and everything we hold about them:
// their files (CV, recordings, photo, coach files) and all their rows (removed with the account).
// Staff accounts are removed by an admin instead, so decisions keep a record of who made them.
import { corsHeaders, fail, json } from '../_shared/cors.ts';
import { adminClient, getCaller, isStaffRole } from '../_shared/clients.ts';

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
    if (isStaffRole(caller.role)) return fail('Staff accounts are removed by an admin.', 403);

    const db = adminClient();
    for (const bucket of BUCKETS) await removeFolder(db, bucket, caller.id);
    // Deleting the login removes the profile, application, answers and notifications with it.
    const { error } = await db.auth.admin.deleteUser(caller.id);
    if (error) throw error;
    return json({ deleted: true });
  } catch (e) {
    console.error(e);
    return fail('We could not delete your account. Please try again or contact Uncommon.', 500);
  }
});

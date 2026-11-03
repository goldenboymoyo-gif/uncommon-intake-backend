// Adds an applicant's uploaded CV or motivation letter to their application. Any PDF or Word file is accepted:
// what is in it is for staff to read, and it never stops anyone from applying.
import { corsHeaders, fail, json } from '../_shared/cors.ts';
import { adminClient, getCaller } from '../_shared/clients.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const caller = await getCaller(req);
    if (!caller) return fail('Please sign in again.', 401);
    const { application_id, path, file_name, kind } = await req.json();
    const letter = kind === 'letter';
    const db = adminClient();

    const { data: app } = await db
      .from('applications')
      .select('id, applicant_id, submitted_at, cv_path, letter_path')
      .eq('id', application_id)
      .single();
    if (!app || app.applicant_id !== caller.id) return fail('Application not found.', 404);
    if (app.submitted_at) return fail('Your application is already sent.');
    if (!String(path).startsWith(`${caller.id}/${app.id}/`)) return fail('File not found.', 404);

    const { data: updated, error: rowErr } = await db
      .from('applications')
      .update(letter ? { letter_path: path, letter_name: file_name ?? 'Letter' } : { cv_path: path, cv_name: file_name ?? 'CV' })
      .eq('id', app.id)
      .select()
      .single();
    if (rowErr) throw rowErr;
    const old = letter ? app.letter_path : app.cv_path;
    if (old && old !== path) await db.storage.from('application-cvs').remove([old]);
    return json(updated);
  } catch (e) {
    console.error(e);
    return fail('We could not save your file right now. Please try again in a moment.', 500);
  }
});

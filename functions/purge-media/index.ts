// Runs once a day from pg_cron. Deletes interview recordings older than their keep date (about 90 days).
// Transcripts and summaries stay so staff can still read the application.
import { fail, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/clients.ts';

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return fail('Not allowed.', 401);

  const db = adminClient();
  const { data: expired } = await db
    .from('interview_answers')
    .select('id, media_path')
    .not('media_path', 'is', null)
    .lt('media_delete_after', new Date().toISOString())
    .limit(500);

  const rows = expired ?? [];
  if (rows.length) {
    await db.storage.from('interview-media').remove(rows.map((r) => r.media_path as string));
    await db
      .from('interview_answers')
      .update({ media_path: null, media_deleted_at: new Date().toISOString() })
      .in('id', rows.map((r) => r.id));
  }
  return json({ deleted: rows.length });
});

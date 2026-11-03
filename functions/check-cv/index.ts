// Adds an applicant's uploaded CV or motivation letter to their application.
// AI only checks that the file is the right kind of document (a CV in the CV place, a letter in the
// letter place). It never judges how good it is. If a file cannot be read (a photo, an old Word file),
// it is accepted, so nobody is stopped by a technical problem.
import { corsHeaders, fail, json } from '../_shared/cors.ts';
import { adminClient, getCaller } from '../_shared/clients.ts';
import { generateJson } from '../_shared/ai.ts';
import { documentToText } from '../_shared/documents.ts';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind'],
  properties: { kind: { type: 'string', enum: ['cv', 'motivation_letter', 'other'] } },
};

const RULES = [
  'Say what kind of document this is.',
  '"cv": a CV or resume, or any list of a person\'s education, skills, work, volunteering or projects, even very short or with little experience.',
  '"motivation_letter": a letter or text in the person\'s own words about themselves, why they want to join, their goals, or why they are a good fit. A cover letter counts.',
  '"other": clearly something else, for example a certificate, ID, school report, receipt, homework, a blank page or random text.',
  'When unsure, never answer "other".',
].join(' ');

const wrongFile = {
  cv: 'This file does not look like a CV. A CV lists your education, skills and any work, volunteering or projects. Please upload your CV. If you do not have one, you can write about yourself instead.',
  letter: 'This file does not look like a motivation letter. Your letter should be in your own words, telling us why you want to join the bootcamp and what you hope to do with technology. Please upload your letter.',
};

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

    // Check it is the right kind of document. Any problem here means we simply accept the file.
    try {
      const { data: file } = await db.storage.from('application-cvs').download(path);
      const text = file ? await documentToText(new Uint8Array(await file.arrayBuffer()), file_name ?? path).catch(() => '') : '';
      if (text.trim().length >= 80) {
        const result = await generateJson<{ kind: string }>({ name: 'document_kind', instructions: RULES, input: text.slice(0, 6000), schema });
        const wanted = letter ? 'motivation_letter' : 'cv';
        if (result.data.kind === 'other' || (result.data.kind !== wanted && letter)) {
          await db.storage.from('application-cvs').remove([path]);
          return fail(letter ? wrongFile.letter : wrongFile.cv);
        }
        if (result.data.kind === 'motivation_letter' && !letter) {
          await db.storage.from('application-cvs').remove([path]);
          return fail('This looks like your motivation letter. Please upload it in the motivation letter place below, and upload your CV here.');
        }
      }
    } catch (e) {
      console.error('document check skipped', e);
    }

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

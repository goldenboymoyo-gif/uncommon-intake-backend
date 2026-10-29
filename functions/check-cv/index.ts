// Checks an applicant's uploaded file before it is added to their application:
// is it really a CV, and does it fit what Uncommon teaches (software development,
// digital marketing, product design)? This only checks the document. It never
// decides about the person, and anyone can still apply by writing about themselves.
import { corsHeaders, fail, json } from '../_shared/cors.ts';
import { adminClient, getCaller } from '../_shared/clients.ts';
import { cleanText, generateJson } from '../_shared/ai.ts';
import { documentToText } from '../_shared/documents.ts';

type Check = { is_cv: boolean; fits_our_courses: boolean; message: string };

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['is_cv', 'fits_our_courses', 'message'],
  properties: {
    is_cv: { type: 'boolean' },
    fits_our_courses: { type: 'boolean' },
    message: { type: 'string' },
  },
};

const RULES = [
  'You check a file an applicant uploaded as their CV for a free technology bootcamp in Zimbabwe that teaches software development, digital marketing and product design.',
  'is_cv: true only if the document is a CV or resume about the applicant (name, skills, education, experience). False for letters, essays, certificates, ID documents, school reports, notes, adverts or random files.',
  'fits_our_courses: true if the CV shows any link to what we teach: computers or ICT, coding, websites, apps, data, IT support, social media, online marketing, content, graphic or product design, or a stated wish to work in technology, marketing or design. A young person with little experience but some of this counts as true.',
  'fits_our_courses: false only when the CV is clearly aimed at an unrelated career with no link at all to technology, digital marketing or design, for example only cooking, teaching, nursing, farming or driving.',
  'message: when both are true, write an empty string. Otherwise write 2 or 3 short, kind sentences to the applicant ("you"). Say what the file looks like, and ask them to upload a real CV that shows their interest, study or experience in software development, digital marketing or product design. Never judge them as a person.',
].join(' ');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = adminClient();
  let newPath: string | null = null;
  try {
    const caller = await getCaller(req);
    if (!caller) return fail('Please sign in again.', 401);
    const { application_id, path, file_name } = await req.json();

    const { data: app } = await db
      .from('applications')
      .select('id, applicant_id, submitted_at, cv_path')
      .eq('id', application_id)
      .single();
    if (!app || app.applicant_id !== caller.id) return fail('Application not found.', 404);
    if (app.submitted_at) return fail('Your application is already sent.');
    if (!String(path).startsWith(`${caller.id}/${app.id}/`)) return fail('File not found.', 404);
    newPath = path;

    const { data: file, error } = await db.storage.from('application-cvs').download(path);
    if (error || !file) return fail('We could not open your file. Please try again.');
    const text = await documentToText(new Uint8Array(await file.arrayBuffer()), file_name ?? path);

    const reject = async (message: string) => {
      await db.storage.from('application-cvs').remove([path]);
      return fail(message, 422);
    };
    if (text.trim().length < 30) {
      return await reject('We could not read the words in this file. Please upload your CV as a PDF or .docx file.');
    }

    const result = await generateJson<Check>({ name: 'cv_check', instructions: RULES, input: `Uploaded file:\n"""\n${text.slice(0, 15000)}\n"""`, schema });
    if (!result.data.is_cv || !result.data.fits_our_courses) {
      return await reject(
        cleanText(result.data.message) ||
          'This file does not look like a CV for what we teach. Please upload a CV that shows your interest in software development, digital marketing or product design.',
      );
    }

    // Good CV: attach it, and remove the old one if there was one.
    const { data: updated, error: rowErr } = await db
      .from('applications')
      .update({ cv_path: path, cv_name: file_name ?? 'CV' })
      .eq('id', app.id)
      .select()
      .single();
    if (rowErr) throw rowErr;
    if (app.cv_path && app.cv_path !== path) await db.storage.from('application-cvs').remove([app.cv_path]);
    return json(updated);
  } catch (e) {
    console.error(e);
    if (newPath) await db.storage.from('application-cvs').remove([newPath]);
    return fail('We could not check your CV right now. Please try again in a moment.', 500);
  }
});

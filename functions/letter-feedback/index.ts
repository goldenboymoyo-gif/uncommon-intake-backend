// Gives suggestions on a motivational letter. It never writes or rewrites the letter.
import { corsHeaders, fail, json } from '../_shared/cors.ts';
import { adminClient, getCaller } from '../_shared/clients.ts';
import { generateJson } from '../_shared/ai.ts';
import { documentToText } from '../_shared/documents.ts';

type Feedback = {
  strengths: string[];
  suggestions: { area: string; suggestion: string }[];
};

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['strengths', 'suggestions'],
  properties: {
    strengths: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    suggestions: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['area', 'suggestion'],
        properties: { area: { type: 'string' }, suggestion: { type: 'string' } },
      },
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const caller = await getCaller(req);
    if (!caller) return fail('Please sign in again.', 401);

    const { application_id } = await req.json();
    const db = adminClient();
    const { data: app } = await db
      .from('applications')
      .select('id, applicant_id, letter_path, letter_name')
      .eq('id', application_id)
      .single();
    if (!app || app.applicant_id !== caller.id) return fail('Application not found.', 404);
    if (!app.letter_path) return fail('Please upload your letter first.');

    const { data: file, error } = await db.storage.from('letters').download(app.letter_path);
    if (error || !file) return fail('We could not open your letter. Please upload it again.');
    const text = await documentToText(new Uint8Array(await file.arrayBuffer()), app.letter_name ?? app.letter_path);
    if (text.length < 50) {
      return fail('We could not read the words in your letter. Please upload a PDF or a .docx file with typed text.');
    }

    const result = await generateJson<Feedback>({
      name: 'letter_feedback',
      instructions: [
        'You give feedback on a motivational letter written by someone applying to the bootcamp.',
        'Give up to 3 short strengths and up to 5 short, practical suggestions the writer can act on.',
        'NEVER write, rewrite or rephrase any part of the letter. Never give example sentences or wording to copy.',
        'Describe what to improve, not the new words. Example of a good suggestion: "Say why you want to work in tech."',
        'Do not judge whether the person should be accepted.',
      ].join(' '),
      input: `Motivational letter:\n"""\n${text}\n"""`,
      schema,
    });

    const { data: saved } = await db
      .from('letter_feedback')
      .insert({ application_id, suggestions: result.data, provider: result.provider, model: result.model })
      .select()
      .single();
    return json(saved);
  } catch (e) {
    console.error(e);
    return fail('Feedback is not available right now. Please try again later.', 500);
  }
});

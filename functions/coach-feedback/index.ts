// Career coach for students: CV feedback, cover letter feedback, and job interview practice.
// Gives feedback only. It never writes the CV, the letter or the answer for the student.
import { corsHeaders, fail, json } from '../_shared/cors.ts';
import { adminClient, getCaller } from '../_shared/clients.ts';
import { generateJson } from '../_shared/ai.ts';
import { documentToText } from '../_shared/documents.ts';

type Feedback = { strengths: string[]; suggestions: { area: string; suggestion: string }[] };

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

const guidance = {
  cv: 'You give feedback on a CV for an entry level tech job. Look at structure, clarity, skills, projects and contact details.',
  cover_letter: 'You give feedback on a cover letter for an entry level tech job. Look at clarity, fit with the job, examples and length.',
  interview_practice: 'You give feedback on one practice answer to a job interview question. Look at clarity, structure (situation, action, result) and examples.',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const caller = await getCaller(req);
    if (!caller) return fail('Please sign in again.', 401);
    if (caller.role !== 'student') return fail('The career coach opens once you are a student.', 403);

    const { kind, text, file_path, file_name, question, title } = await req.json();
    if (!(kind in guidance)) return fail('Please choose what you want feedback on.');

    const db = adminClient();
    let content: string = (text ?? '').trim();
    if (!content && file_path) {
      if (!String(file_path).startsWith(`${caller.id}/`)) return fail('File not found.', 404);
      const { data: file } = await db.storage.from('coach-files').download(file_path);
      if (file) content = await documentToText(new Uint8Array(await file.arrayBuffer()), file_name ?? file_path);
    }
    if (content.length < 20) return fail('Please add a little more text so we can give useful feedback.');

    const input = kind === 'interview_practice'
      ? `Interview question: ${question ?? ''}\n\nAnswer:\n"""\n${content}\n"""`
      : `Document:\n"""\n${content}\n"""`;

    const result = await generateJson<Feedback>({
      name: 'coach_feedback',
      instructions: `${guidance[kind as keyof typeof guidance]} Give up to 3 strengths and up to 5 practical suggestions. Never rewrite the text or give wording to copy.`,
      input,
      schema,
    });

    const { data: saved } = await db
      .from('coach_sessions')
      .insert({
        student_id: caller.id,
        kind,
        title: title ?? question ?? '',
        input_text: content.slice(0, 20000),
        file_path: file_path ?? null,
        feedback: result.data,
        model: `${result.provider}:${result.model}`,
      })
      .select()
      .single();
    return json(saved);
  } catch (e) {
    console.error(e);
    return fail('Feedback is not available right now. Please try again later.', 500);
  }
});

// Career coach for students: CV coach, cover letter coach, and job interview practice.
// Students pick the career they are going for, so the coach can talk about that field.
// Gives feedback only. It never writes the CV, the letter or the answer for the student.
import { corsHeaders, fail, json } from '../_shared/cors.ts';
import { adminClient, getCaller } from '../_shared/clients.ts';
import { cleanText, generateJson } from '../_shared/ai.ts';
import { documentToText } from '../_shared/documents.ts';

type Feedback = {
  document_ok: boolean;
  problem: string;
  strengths: string[];
  suggestions: { area: string; suggestion: string }[];
};

const feedbackSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['document_ok', 'problem', 'strengths', 'suggestions'],
  properties: {
    document_ok: { type: 'boolean' },
    problem: { type: 'string' },
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

const questionsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: { questions: { type: 'array', items: { type: 'string' }, minItems: 5, maxItems: 5 } },
};

const guidance = {
  cv: [
    'You coach a student on their CV for the career below.',
    'First check the document. Set document_ok to false if it is not a CV (for example a letter, an essay, notes, a certificate or a random document).',
    'Also set document_ok to false if the CV is clearly written for a very different career from the one below, for example a chef or teaching CV when they want a software job.',
    'When document_ok is false, write "problem" to the student in 2 or 3 short, kind sentences: say what the document looks like, and what a CV for this career should show instead. Leave strengths and suggestions empty.',
    'When document_ok is true, leave "problem" empty and teach them: look at structure, a short profile, skills that match the career, projects with results, work and training, contact details and links, length and spelling.',
  ].join(' '),
  cover_letter: [
    'You coach a student on a cover letter for the career below.',
    'First check the document. Set document_ok to false if it is not a cover letter (for example a CV, an essay, notes or a random document).',
    'Also set document_ok to false if the letter is clearly for a very different career from the one below.',
    'When document_ok is false, write "problem" to the student in 2 or 3 short, kind sentences: say what the document looks like, and what a cover letter for this career should do instead. Leave strengths and suggestions empty.',
    'When document_ok is true, leave "problem" empty and teach them: a clear opening that names the job, why this company, one or two real examples, matching the job advert, length, and a polite close.',
  ].join(' '),
  interview_practice: [
    'You coach a student on one practice answer to a job interview question for the career below.',
    'Set document_ok to true and leave "problem" empty, unless the answer is not an attempt to answer the question; then set it false and kindly ask them to try answering the question.',
    'Look at clarity, structure (situation, action, result), real examples, and whether the answer shows skills that matter in this career.',
  ].join(' '),
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const caller = await getCaller(req);
    if (!caller) return fail('Please sign in again.', 401);
    if (caller.role !== 'student') return fail('The career coach opens once you are a student.', 403);

    const body = await req.json();
    const career = String(body.career ?? '').trim().slice(0, 80);
    if (career.length < 2) return fail('Please choose the career you are going for.');

    // Real interview questions for the chosen career.
    if (body.action === 'questions') {
      const result = await generateJson<{ questions: string[] }>({
        name: 'interview_questions',
        instructions: [
          `Write 5 interview questions that employers in Zimbabwe and abroad really ask in a ${career} interview for an entry level or junior role.`,
          'Mix them: one or two about the person and their motivation, two or three about skills and real work in this field, and one about a situation (for example a hard problem, a deadline or a team conflict).',
          'For technical roles, ask practical questions a junior can answer by talking, not trick puzzles.',
          'Each question is one sentence, open, and asks about one thing. Vary them each time.',
          'Never ask about age, family, religion, health, tribe, politics or money.',
        ].join(' '),
        input: `Career: ${career}`,
        schema: questionsSchema,
      });
      return json({ questions: result.data.questions.map(cleanText) });
    }

    const { kind, text, file_path, file_name, question, title } = body;
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
      ? `Career: ${career}\nInterview question: ${question ?? ''}\n\nAnswer:\n"""\n${content}\n"""`
      : `Career: ${career}\n\nDocument:\n"""\n${content}\n"""`;

    const result = await generateJson<Feedback>({
      name: 'coach_feedback',
      instructions: `${guidance[kind as keyof typeof guidance]} Give up to 3 strengths and up to 5 practical suggestions, each explaining why it matters so they learn. Never rewrite the text or give wording to copy.`,
      input,
      schema: feedbackSchema,
    });

    if (!result.data.document_ok) {
      return fail(cleanText(result.data.problem) || 'This does not look like the right kind of document. Please check it and try again.', 422);
    }

    const feedback = {
      strengths: result.data.strengths.map(cleanText),
      suggestions: result.data.suggestions.map((s) => ({ area: cleanText(s.area), suggestion: cleanText(s.suggestion) })),
    };

    const { data: saved } = await db
      .from('coach_sessions')
      .insert({
        student_id: caller.id,
        kind,
        title: title ?? question ?? '',
        input_text: content.slice(0, 20000),
        file_path: file_path ?? null,
        feedback,
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

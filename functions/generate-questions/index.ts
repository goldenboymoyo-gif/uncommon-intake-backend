// Writes 5 professional interview questions for one applicant, based on their CV
// (or their short "about you" text if they have no CV).
// Runs once per application: if questions already exist, the same ones are returned.
// The AI only writes questions. It does not judge the CV or the person.
import { corsHeaders, fail, json } from '../_shared/cors.ts';
import { adminClient, getCaller, isStaffRole } from '../_shared/clients.ts';
import { generateJson } from '../_shared/ai.ts';
import { documentToText } from '../_shared/documents.ts';

type Questions = { questions: { question: string; based_on: string }[] };

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      minItems: 5,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'based_on'],
        properties: {
          question: { type: 'string' },
          based_on: { type: 'string' },
        },
      },
    },
  },
};

const RULES = [
  'You write interview questions for people applying to a free, 12 month, full-time technology bootcamp for unemployed young adults in Zimbabwe.',
  'Write exactly 5 questions based on the applicant document below.',
  'Be professional, warm and respectful, like a good interviewer at a well run organisation.',
  'Each question must be open (not yes/no), ask about one thing only, and be answerable in 1 to 3 minutes by speaking or typing.',
  'Use simple English. Short sentences. No jargon, no slang, no trick questions, no brain teasers.',
  'Always speak to the applicant as "you". Never use their name or write about them in the third person.',
  'Do not use hyphens, dashes or arrows. Write "12 month" not "12-month", and "cofounder" not "co-founder".',
  'Ask about skills, learning, projects, work or volunteering, problem solving, teamwork, and why they want to join.',
  'Refer to real things in the document so each question feels personal, for example a course, job, project or skill they list.',
  'If the document is short or has little experience, ask about learning, interests, everyday problem solving and goals instead. Never make them feel judged for little experience.',
  'NEVER ask about age, date of birth, gender, marital status, children or family plans, religion, ethnicity, tribe, nationality, health, disability, pregnancy, politics, money, or gaps in employment.',
  'Never quote personal contact details, ID numbers or addresses from the document.',
  'Do not comment on the quality of the document. Do not score or judge the person.',
  'For each question, "based_on" is a short note for staff (under 12 words) saying which part of the document it comes from.',
].join(' ');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const caller = await getCaller(req);
    if (!caller) return fail('Please sign in again.', 401);
    const { application_id } = await req.json();

    const db = adminClient();
    const { data: app } = await db
      .from('applications')
      .select('id, applicant_id, intake_id, submitted_at, cv_path, cv_name, about_text')
      .eq('id', application_id)
      .single();
    if (!app || (app.applicant_id !== caller.id && !isStaffRole(caller.role))) return fail('Application not found.', 404);
    if (!app.submitted_at) return fail('Please send your application first.');

    // Same questions every time: never regenerate.
    const { data: existing } = await db
      .from('interview_questions')
      .select('id, position, prompt')
      .eq('application_id', app.id)
      .order('position');
    if (existing && existing.length >= 5) return json(existing);

    let text = (app.about_text ?? '').trim();
    if (app.cv_path) {
      const { data: file, error } = await db.storage.from('application-cvs').download(app.cv_path);
      if (error || !file) return fail('We could not open your CV. Please contact the Uncommon team.');
      text = await documentToText(new Uint8Array(await file.arrayBuffer()), app.cv_name ?? app.cv_path);
    }
    if (text.length < 30) {
      return fail('We could not read enough words in your CV. Please contact the Uncommon team for help.');
    }

    const result = await generateJson<Questions>({
      name: 'interview_questions',
      instructions: RULES,
      input: `${app.cv_path ? 'Applicant CV' : 'Applicant wrote about themselves (no CV)'}:\n"""\n${text}\n"""`,
      schema,
    });

    const rows = result.data.questions.slice(0, 5).map((q, i) => ({
      intake_id: app.intake_id,
      application_id: app.id,
      position: i + 1,
      prompt: q.question.trim(),
      based_on: q.based_on.trim(),
      ai_generated: true,
      model: `${result.provider}:${result.model}`,
    }));
    if (rows.length < 5) return fail('We could not prepare your questions. Please try again in a moment.', 500);

    const { data: saved, error: insErr } = await db.from('interview_questions').insert(rows).select('id, position, prompt');
    if (insErr) {
      // Another request may have saved them first. Return whatever is there.
      const { data: again } = await db.from('interview_questions').select('id, position, prompt').eq('application_id', app.id).order('position');
      if (again && again.length >= 5) return json(again);
      throw insErr;
    }
    await db.from('applications').update({ questions_ready_at: new Date().toISOString() }).eq('id', app.id);
    return json(saved);
  } catch (e) {
    console.error(e);
    return fail('We could not prepare your questions right now. Please try again in a moment.', 500);
  }
});

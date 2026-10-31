// Finds common themes in written survey answers for staff.
// Every theme keeps the ids of the raw answers it came from, so staff can always check the source.
import { corsHeaders, fail, json } from '../_shared/cors.ts';
import { adminClient, canSeeHub, getCaller, isStaffRole } from '../_shared/clients.ts';
import { generateJson } from '../_shared/ai.ts';

type Themes = { themes: { theme: string; answer_numbers: number[] }[] };

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['themes'],
  properties: {
    themes: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['theme', 'answer_numbers'],
        properties: { theme: { type: 'string' }, answer_numbers: { type: 'array', items: { type: 'integer' } } },
      },
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const caller = await getCaller(req);
    if (!caller || !isStaffRole(caller.role)) return fail('Only staff can do this.', 403);
    const { question_id } = await req.json();

    const db = adminClient();
    const { data: question } = await db.from('survey_questions').select('id, survey_id, prompt, kind').eq('id', question_id).single();
    if (!question || question.kind !== 'text') return fail('Themes work on written answers only.');
    const { data: survey } = await db.from('surveys').select('hub_id').eq('id', question.survey_id).single();
    if (!survey || !canSeeHub(caller, survey.hub_id)) return fail('This survey belongs to another hub.', 403);

    const { data: responses } = await db.from('survey_responses').select('id, value').eq('question_id', question_id);
    const answers = (responses ?? []).filter((r) => typeof r.value === 'string' && r.value.trim());
    if (answers.length < 3) return fail('There are not enough answers yet to find themes.');

    const result = await generateJson<Themes>({
      name: 'survey_themes',
      instructions: 'Group these numbered survey answers into a few short themes. For each theme, list the numbers of the answers that support it. Do not name or guess who wrote an answer.',
      input: `Question: ${question.prompt}\n\n${answers.map((a, i) => `${i + 1}. ${String(a.value).slice(0, 1000)}`).join('\n')}`,
      schema,
    });

    // Only keep links to answers that really exist.
    const rows = result.data.themes.map((t) => ({
      survey_id: question.survey_id,
      question_id,
      theme: t.theme,
      response_ids: t.answer_numbers.filter((n) => n >= 1 && n <= answers.length).map((n) => answers[n - 1].id),
      model: `${result.provider}:${result.model}`,
    })).filter((t) => t.response_ids.length > 0);

    await db.from('survey_themes').delete().eq('question_id', question_id);
    const { data: saved } = await db.from('survey_themes').insert(rows).select();
    return json(saved ?? []);
  } catch (e) {
    console.error(e);
    return fail('Themes are not available right now. Please try again later.', 500);
  }
});

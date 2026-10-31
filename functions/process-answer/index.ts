// Turns one interview answer into text (speech to text for audio and video),
// then writes a short summary against the staff checklist.
// Text only: no face, voice tone or emotion analysis. No score and no decision.
import { corsHeaders, fail, json } from '../_shared/cors.ts';
import { adminClient, canSeeHub, getCaller } from '../_shared/clients.ts';
import { generateJson, transcribe } from '../_shared/ai.ts';

type Summary = {
  summary: string;
  checklist: { item: string; what_the_answer_says: string }[];
};

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'checklist'],
  properties: {
    summary: { type: 'string' },
    checklist: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['item', 'what_the_answer_says'],
        properties: { item: { type: 'string' }, what_the_answer_says: { type: 'string' } },
      },
    },
  },
};

const mimeFor = (path: string) =>
  path.endsWith('.webm') ? 'audio/webm' : path.endsWith('.mp4') ? 'video/mp4' : path.endsWith('.mov') ? 'video/quicktime' : 'audio/mp4';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = adminClient();
  let answerId: string | undefined;
  try {
    const caller = await getCaller(req);
    if (!caller) return fail('Please sign in again.', 401);
    ({ answer_id: answerId } = await req.json());

    const { data: answer } = await db
      .from('interview_answers')
      .select('*, applications!inner(applicant_id, intake_id, hub_id), interview_questions!inner(prompt)')
      .eq('id', answerId)
      .single();
    if (!answer) return fail('Answer not found.', 404);
    if (answer.applications.applicant_id !== caller.id && !canSeeHub(caller, answer.applications.hub_id)) return fail('Answer not found.', 404);

    // 1. Speech to text
    let transcript: string = answer.transcript ?? '';
    if (answer.format !== 'text' && !transcript) {
      if (!answer.media_path) return fail('The recording has not been uploaded yet.');
      const { data: file, error } = await db.storage.from('interview-media').download(answer.media_path);
      if (error || !file) return fail('We could not open the recording.');
      const name = answer.media_path.split('/').pop() ?? 'answer.m4a';
      const result = await transcribe(new Uint8Array(await file.arrayBuffer()), name, mimeFor(answer.media_path));
      transcript = result.data.trim();
      await db.from('interview_answers').update({ transcript, state: 'transcribed' }).eq('id', answerId);
    }
    const answerText = answer.format === 'text' ? (answer.text_answer ?? '') : transcript;

    // 2. Summary against the checklist
    const { data: checklist } = await db
      .from('review_checklist')
      .select('item')
      .eq('intake_id', answer.applications.intake_id)
      .order('position');
    const items = (checklist ?? []).map((c: { item: string }) => c.item);

    const result = await generateJson<Summary>({
      name: 'answer_summary',
      instructions: [
        'Summarise one interview answer for staff in 2 or 3 short sentences.',
        'Then, for each checklist item, say in one short sentence what the answer says about it,',
        'or "The answer does not talk about this." if it does not.',
        'Use only the words of the answer. Do not give a score, rating, ranking or recommendation.',
        'The answer may be a speech to text transcript, so ignore small spelling or grammar mistakes.',
      ].join(' '),
      input: `Question: ${answer.interview_questions.prompt}\n\nChecklist:\n${items.map((i: string) => `- ${i}`).join('\n') || '- (no checklist items yet)'}\n\nAnswer:\n"""\n${answerText}\n"""`,
      schema,
    });

    const { data: saved } = await db
      .from('interview_answers')
      .update({ ai_summary: result.data, ai_model: `${result.provider}:${result.model}`, state: 'summarised' })
      .eq('id', answerId)
      .select('id, state, transcript, ai_summary')
      .single();
    return json(saved);
  } catch (e) {
    console.error(e);
    if (answerId) await db.from('interview_answers').update({ state: 'failed' }).eq('id', answerId).neq('state', 'summarised');
    return fail('We saved your answer. The text version will be ready a little later.', 500);
  }
});

// The English Tutor: a teacher that places, teaches and tests students and graduates.
// The AI teaches and marks single answers. This code counts every score from the saved answers,
// so levels, points and progress always come from real evidence and never from the AI's opinion.
import { corsHeaders, fail, json } from '../_shared/cors.ts';
import { adminClient, getCaller, isStaffRole } from '../_shared/clients.ts';
import { cleanText, generateJson, transcribe } from '../_shared/ai.ts';
import { curriculum, dailyActivities, findLesson, Skill } from '../_shared/englishCurriculum.ts';

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const SKILLS: Skill[] = ['grammar', 'vocabulary', 'speaking', 'writing', 'reading', 'listening'];
const ASSESSMENT_SKILLS: Skill[] = ['vocabulary', 'grammar', 'reading', 'writing', 'listening', 'speaking'];
const TARGET = { assessment: 12, lesson: 5, daily: 2, weekly: 10, level_test: 12 } as const;
const PASS = { lesson: 70, daily: 50, weekly: 60, level_test: 75, assessment: 0 } as const;
const POINTS = { assessment: 10, lesson: 20, daily: 5, weekly: 15, level_test: 30 } as const;
const LESSONS_BEFORE_LEVEL_TEST = 5;
const DAILY_MESSAGE_LIMIT = 100;
const MAX_SECONDS_PER_REPLY = 180;

type Kind = keyof typeof TARGET;
// deno-lint-ignore no-explicit-any
type Row = any;

const teacherSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['thinking', 'reply', 'speak_text', 'graded', 'mistakes', 'vocabulary'],
  properties: {
    thinking: { type: 'string' },
    reply: { type: 'string' },
    speak_text: { type: 'string' },
    graded: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['question', 'correct_answer', 'is_correct', 'explanation'],
      properties: {
        question: { type: 'string' },
        correct_answer: { type: 'string' },
        is_correct: { type: 'boolean' },
        explanation: { type: 'string' },
      },
    },
    mistakes: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pattern', 'example', 'correction'],
        properties: { pattern: { type: 'string' }, example: { type: 'string' }, correction: { type: 'string' } },
      },
    },
    vocabulary: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['word', 'meaning', 'example'],
        properties: { word: { type: 'string' }, meaning: { type: 'string' }, example: { type: 'string' } },
      },
    },
  },
};

const TEACHER = [
  'You are Chipo, a patient, professional English teacher at Uncommon in Zimbabwe, teaching one person in a phone chat.',
  'Always speak as a teacher, never as a general assistant. Stay on learning English.',
  'Before you reply, think carefully in "thinking", which the student never sees: what they wrote, what is right, what is wrong and why, and the best next small step. Then write "reply".',
  'Write at most 90 words in plain text. Do not use lists. Ask only one question in each message, then wait.',
  'Match your words to the level given. For A1 and A2 use very short sentences and common words.',
  'Never insult or shame the person. When they make a mistake, first recognise their attempt, then give the correct sentence, explain why in simple words, and ask them to try a similar one.',
  'Do not give the answer to a new exercise before they try it. Teach them how to reach it.',
  'Do not rewrite their whole text. Point out one or two mistakes, explain them, and ask them to rewrite.',
  'Never say they have improved unless the facts below show it. Never give a score or a level yourself.',
  'Voice notes reach you as the words we heard. You can say which word was heard differently and which sound to practise. Never comment on their accent or voice.',
  'Fill "graded" only when their last message answers an exercise or question you set: "question" is what you asked, "is_correct" is your honest marking, and "explanation" is one short teaching sentence. Otherwise use null, for example when they ask for help or do not understand. An empty or copied answer is not correct.',
  'List real mistakes from their last message in "mistakes": "pattern" is a short general name like "past tense of go". Put new words you taught in "vocabulary".',
  'Leave "speak_text" empty unless a listening or pronunciation task needs words read aloud. For listening tasks, put the sentence, conversation or story in "speak_text" and do NOT repeat it in "reply": just tell them to tap Listen and then ask your question.',
].join(' ');

const languageRule = (language: string, level: string) =>
  language === 'English'
    ? 'Teach only in English.'
    : LEVELS.indexOf(level) >= 2
      ? `English is the main language. Use ${language} only for one short explanation when they are clearly stuck, and encourage them to reply in English.`
      : `English is the main language. You may add one short explanation in ${language} for a hard idea, and encourage them to try in English. If you are not sure of the ${language} words, explain in simple English instead.`;

const percent = (rows: Row[]) => (rows.length ? Math.round((rows.filter((r) => r.is_correct).length / rows.length) * 100) : null);

function placement(answers: Row[]) {
  let level = 'A1';
  for (const candidate of LEVELS) {
    const atLevel = answers.filter((a) => a.level === candidate);
    if (atLevel.length >= 2 && (percent(atLevel) ?? 0) >= 50) level = candidate;
  }
  return level;
}

function skillScores(answers: Row[]) {
  const out: Record<string, { score: number | null; answers: number }> = {};
  for (const skill of SKILLS) {
    const rows = answers.filter((a) => a.skill === skill);
    // Too few answers is not evidence, so it shows as not measured yet.
    out[skill] = { score: rows.length >= 3 ? percent(rows.slice(0, 30)) : null, answers: rows.length };
  }
  return out;
}

const weakestSkills = (scores: ReturnType<typeof skillScores>) =>
  SKILLS.filter((s) => scores[s].score !== null).sort((a, b) => (scores[a].score ?? 0) - (scores[b].score ?? 0));

function buildPlan(level: string, scores: ReturnType<typeof skillScores>, passedIds: Set<string>) {
  const weak = weakestSkills(scores).slice(0, 2);
  const focus = weak.length ? weak : (['grammar', 'vocabulary'] as Skill[]);
  const lessonsFor = (skill: Skill) => curriculum.find((m) => m.skill === skill)!.lessons.filter((l) => !passedIds.has(l.id));
  const recommended = [...focus.flatMap((s) => lessonsFor(s).slice(0, 2)), ...lessonsFor('speaking').slice(0, 1)]
    .filter((l, i, all) => all.findIndex((x) => x.id === l.id) === i)
    .slice(0, 5)
    .map((l) => ({ id: l.id, title: l.title }));
  const next = LEVELS[LEVELS.indexOf(level) + 1];
  return {
    weaknesses: focus,
    objectives: [
      `Get stronger in ${focus.join(' and ')}.`,
      next ? `Reach ${next} by passing the level test.` : 'Keep your C2 English strong with regular practice.',
      'Speak English with more confidence.',
    ],
    recommended,
    daily: 'Finish at least one daily activity.',
    weekly: 'Take the weekly test once a week.',
    target: next ? `Pass ${LESSONS_BEFORE_LEVEL_TEST} lessons at ${level}, then take the level test.` : 'Pass the weekly test each week.',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const caller = await getCaller(req);
    if (!caller) return fail('Please sign in again.', 401);
    const body = await req.json();
    const db = adminClient();

    // ---------- Staff: progress summaries only. Conversations stay private. ----------
    if (body.action === 'staff_overview') {
      if (!isStaffRole(caller.role)) return fail('Only staff can do this.', 403);
      const [{ data: people }, { data: learners }, { data: answers }, { data: sessions }, { data: mistakes }] = await Promise.all([
        db.from('english_profiles').select('user_id, level, last_active_on, streak_days, learning_seconds'),
        db.from('profiles').select('id, first_names, surname, role').in('role', ['student', 'graduate']),
        db.from('english_answers').select('user_id, is_correct, created_at').order('created_at', { ascending: false }).limit(5000),
        db.from('english_sessions').select('user_id, kind, title, score, passed, completed_at').eq('status', 'completed').order('completed_at', { ascending: false }).limit(2000),
        db.from('english_mistakes').select('pattern, times').limit(5000),
      ]);
      const twoWeeksAgo = Date.now() - 14 * 86400000;
      const students = (learners ?? []).map((p: Row) => {
        const ep = (people ?? []).find((e: Row) => e.user_id === p.id);
        const own = (answers ?? []).filter((a: Row) => a.user_id === p.id);
        const results = (sessions ?? []).filter((s: Row) => s.user_id === p.id);
        const score = percent(own.slice(0, 30));
        const reasons: string[] = [];
        if (!ep?.level) reasons.push('Has not done the placement');
        if (score !== null && own.length >= 10 && score < 50) reasons.push('Low scores');
        if (ep?.level && (!ep.last_active_on || new Date(ep.last_active_on).getTime() < twoWeeksAgo)) reasons.push('Not active for 2 weeks');
        return {
          id: p.id,
          name: `${p.first_names} ${p.surname}`.trim(),
          level: ep?.level ?? null,
          last_active_on: ep?.last_active_on ?? null,
          lessons_passed: results.filter((s: Row) => s.kind === 'lesson' && s.passed).length,
          learning_minutes: Math.round((ep?.learning_seconds ?? 0) / 60),
          recent_score: score,
          recent_results: results.slice(0, 3).map((s: Row) => ({ title: s.title, score: s.score, passed: s.passed })),
          reasons,
        };
      });
      const totals = new Map<string, number>();
      for (const m of mistakes ?? []) totals.set(m.pattern, (totals.get(m.pattern) ?? 0) + m.times);
      const common = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([pattern, times]) => ({ pattern, times }));
      return json({ students, common });
    }

    if (caller.role !== 'student' && caller.role !== 'graduate') return fail('The English Tutor opens once you are a student.', 403);

    const { data: existing } = await db.from('english_profiles').select('*').eq('user_id', caller.id).maybeSingle();
    let profile: Row = existing;
    if (!profile) {
      const { data: created, error } = await db.from('english_profiles').insert({ user_id: caller.id }).select().single();
      if (error) throw error;
      profile = created;
    }
    const today = new Date().toISOString().slice(0, 10);

    // ---------- Dashboard, counted from real activity ----------
    if (body.action === 'overview') {
      const [{ data: answers }, { data: sessions }, { count: words }, { data: done }, { data: mistakes }] = await Promise.all([
        db.from('english_answers').select('skill, level, is_correct, created_at').eq('user_id', caller.id).order('created_at', { ascending: false }).limit(500),
        db.from('english_sessions').select('id, kind, lesson_id, title, level, status, score, passed, completed_at').eq('user_id', caller.id).order('created_at', { ascending: false }).limit(300),
        db.from('english_vocabulary').select('word', { count: 'exact', head: true }).eq('user_id', caller.id),
        db.from('english_daily').select('activity').eq('user_id', caller.id).eq('day', today),
        db.from('english_mistakes').select('pattern, correction, times').eq('user_id', caller.id).order('times', { ascending: false }).limit(3),
      ]);
      const all = (sessions ?? []) as Row[];
      const scores = skillScores(answers ?? []);
      const finished = all.filter((s) => s.status === 'completed');
      const passedAtLevel = new Set(finished.filter((s) => s.kind === 'lesson' && s.passed && s.level === profile.level).map((s) => s.lesson_id));
      const passedEver = new Set(finished.filter((s) => s.kind === 'lesson' && s.passed).map((s) => s.lesson_id));
      const plan = profile.level ? buildPlan(profile.level, scores, passedAtLevel) : null;
      const lastWeekly = finished.find((s) => s.kind === 'weekly');
      const lastLevelTest = finished.find((s) => s.kind === 'level_test' && s.level === profile.level);
      const writing = (answers ?? []).filter((a: Row) => a.skill === 'writing');
      const speakingCount = (answers ?? []).filter((a: Row) => a.skill === 'speaking').length;
      const lessonsPassed = finished.filter((s) => s.kind === 'lesson' && s.passed).length;
      const achievements = [
        { title: 'Finished your placement', earned: !!profile.level },
        { title: 'First lesson passed', earned: lessonsPassed >= 1 },
        { title: '10 lessons passed', earned: lessonsPassed >= 10 },
        { title: '7 day streak', earned: profile.best_streak >= 7 },
        { title: '50 words learned', earned: (words ?? 0) >= 50 },
        { title: '20 spoken answers', earned: speakingCount >= 20 },
      ];
      return json({
        level: profile.level,
        language: profile.language,
        points: profile.points,
        streak: profile.streak_days,
        learning_minutes: Math.round(profile.learning_seconds / 60),
        words: words ?? 0,
        lessons_passed: lessonsPassed,
        speaking_answers: speakingCount,
        writing_scores: { first: percent(writing.slice(-5)), recent: writing.length >= 10 ? percent(writing.slice(0, 5)) : null },
        skills: scores,
        plan,
        recommended: plan?.recommended[0] ?? null,
        mistakes: mistakes ?? [],
        achievements,
        active_assessment: all.find((s) => s.kind === 'assessment' && s.status === 'active')?.id ?? null,
        daily: dailyActivities.map((d) => ({ id: d.id, title: d.title, done: (done ?? []).some((x: Row) => x.activity === d.id) })),
        modules: curriculum.map((m) => ({
          id: m.id,
          title: m.title,
          lessons: m.lessons.map((l) => ({ ...l, passed: passedAtLevel.has(l.id), passed_before: passedEver.has(l.id) })),
        })),
        can_weekly: !!profile.level && (!lastWeekly || Date.now() - new Date(lastWeekly.completed_at).getTime() >= 7 * 86400000),
        level_test: {
          next: LEVELS[LEVELS.indexOf(profile.level) + 1] ?? null,
          lessons_needed: Math.max(0, LESSONS_BEFORE_LEVEL_TEST - passedAtLevel.size),
          ready: !!profile.level && profile.level !== 'C2' && passedAtLevel.size >= LESSONS_BEFORE_LEVEL_TEST &&
            (!lastLevelTest || Date.now() - new Date(lastLevelTest.completed_at).getTime() >= 3 * 86400000),
        },
      });
    }

    if (body.action === 'set_language') {
      if (!['English', 'Shona', 'Ndebele', 'Tonga'].includes(body.language)) return fail('Please choose a language.');
      await db.from('english_profiles').update({ language: body.language, updated_at: new Date().toISOString() }).eq('user_id', caller.id);
      return json({ language: body.language });
    }

    // ---------- Read a teacher message aloud. Only saved messages, and each is made once. ----------
    if (body.action === 'speak') {
      const { data: message } = await db.from('english_messages').select('id, body, speak_text').eq('id', body.message_id).eq('user_id', caller.id).single();
      if (!message) return fail('This message is no longer available.', 404);
      const path = `${caller.id}/english/${message.id}.mp3`;
      const { data: found } = await db.storage.from('coach-files').createSignedUrl(path, 600);
      if (found?.signedUrl) return json({ url: found.signedUrl });
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: Deno.env.get('OPENAI_TTS_MODEL') ?? 'gpt-4o-mini-tts', voice: 'alloy', input: (message.speak_text || message.body).slice(0, 1200), response_format: 'mp3' }),
      });
      if (!res.ok) throw new Error(`speech error ${res.status}: ${await res.text()}`);
      const { error } = await db.storage.from('coach-files').upload(path, await res.arrayBuffer(), { contentType: 'audio/mpeg', upsert: true });
      if (error) throw error;
      const { data: link } = await db.storage.from('coach-files').createSignedUrl(path, 600);
      return json({ url: link?.signedUrl });
    }

    const limitReached = async () => {
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      const { count } = await db.from('english_messages').select('id', { count: 'exact', head: true })
        .eq('user_id', caller.id).eq('sender', 'student').gte('created_at', start.toISOString());
      return (count ?? 0) >= DAILY_MESSAGE_LIMIT;
    };
    const LIMIT_TEXT = `You have reached today's limit of ${DAILY_MESSAGE_LIMIT} messages. Well done for practising. Come back tomorrow.`;

    // What the teacher remembers about this person across sessions.
    const memory = async () => {
      const [{ data: mistakes }, { data: words }, { data: recent }] = await Promise.all([
        db.from('english_mistakes').select('pattern, times').eq('user_id', caller.id).order('times', { ascending: false }).limit(5),
        db.from('english_vocabulary').select('word').eq('user_id', caller.id).order('next_review').limit(8),
        db.from('english_sessions').select('title, passed').eq('user_id', caller.id).eq('status', 'completed').order('completed_at', { ascending: false }).limit(4),
      ]);
      return [
        `Recurring mistakes: ${(mistakes ?? []).map((m: Row) => `${m.pattern} (${m.times} times)`).join(', ') || 'none yet'}. Work on these when you can.`,
        `Words to revise: ${(words ?? []).map((w: Row) => w.word).join(', ') || 'none yet'}.`,
        `Recent work: ${(recent ?? []).map((s: Row) => `${s.title} (${s.passed ? 'passed' : 'not passed yet'})`).join(', ') || 'none yet'}.`,
      ].join(' ');
    };

    const sessionRule = (session: Row, graded: number, correct: number, activityTask = '') => {
      const target = TARGET[session.kind as Kind];
      if (session.kind === 'assessment') {
        return `This is the placement check. Ask one question at CEFR level ${session.next_level} testing ${session.next_skill}. Give only a very short, kind comment on each answer and do not teach yet. For speaking, ask them to tap the microphone, but accept typing if they cannot. Question ${Math.min(graded + 1, target)} of ${target}.`;
      }
      if (session.kind === 'weekly' || session.kind === 'level_test') {
        return `This is a ${session.kind === 'weekly' ? 'weekly progress test' : 'level test'} at CEFR level ${session.next_level}. Your next question must test ${session.next_skill}. Give a very short comment and do not teach. Question ${Math.min(graded + 1, target)} of ${target}.`;
      }
      if (session.kind === 'daily') return `This is a short daily activity at level ${session.level}. ${activityTask} Marked answers so far: ${graded} of ${target}.`;
      const found = findLesson(session.lesson_id);
      return `Lesson: "${found?.lesson.title}". Objective: ${found?.lesson.objective} Level: ${session.level}. Teach with a short explanation and an example, then give one exercise at a time. If they get something wrong, explain it and check again with a similar exercise before moving on. Marked answers so far: ${graded}, correct: ${correct}. Keep going until they show they understand.${session.skill === 'speaking' ? ' Ask them to use the microphone, and make the conversation a little harder as they do well. Typing is fine if they cannot use it.' : ''}`;
    };

    // ---------- Start something ----------
    if (body.action === 'start') {
      const kind = body.kind as Kind;
      if (!(kind in TARGET)) return fail('Please choose what you want to do.');
      if (await limitReached()) return fail(LIMIT_TEXT, 429);

      if (kind === 'assessment') {
        const { data: active } = await db.from('english_sessions').select('id').eq('user_id', caller.id).eq('kind', 'assessment').eq('status', 'active').maybeSingle();
        if (active) return json({ id: active.id });
      } else if (!profile.level) {
        return fail('Please finish your placement check first.');
      }

      const level = profile.level ?? 'A1';
      let title = 'Placement check';
      let skill: Skill | null = ASSESSMENT_SKILLS[0];
      let nextLevel = 'A1';
      let lessonId: string | null = null;
      let activityTask = '';

      if (kind === 'lesson') {
        const found = findLesson(String(body.lesson_id));
        if (!found) return fail('This lesson is no longer available.', 404);
        title = found.lesson.title;
        skill = found.module.skill;
        lessonId = found.lesson.id;
        nextLevel = level;
      } else if (kind === 'daily') {
        const activity = dailyActivities.find((d) => d.id === body.activity);
        if (!activity) return fail('This activity is no longer available.', 404);
        title = activity.title;
        skill = activity.skill;
        lessonId = activity.id;
        nextLevel = level;
        activityTask = activity.task;
      } else if (kind === 'weekly') {
        const { data: last } = await db.from('english_sessions').select('completed_at').eq('user_id', caller.id).eq('kind', 'weekly').eq('status', 'completed').order('completed_at', { ascending: false }).limit(1).maybeSingle();
        if (last && Date.now() - new Date(last.completed_at).getTime() < 7 * 86400000) return fail('Your next weekly test opens 7 days after your last one.');
        title = 'Weekly test';
        nextLevel = level;
      } else if (kind === 'level_test') {
        const next = LEVELS[LEVELS.indexOf(level) + 1];
        if (!next) return fail('You are already at the top level.');
        const { data: passed } = await db.from('english_sessions').select('lesson_id').eq('user_id', caller.id).eq('kind', 'lesson').eq('level', level).eq('passed', true);
        if (new Set((passed ?? []).map((p: Row) => p.lesson_id)).size < LESSONS_BEFORE_LEVEL_TEST) return fail(`Pass ${LESSONS_BEFORE_LEVEL_TEST} lessons at ${level} before the level test.`);
        title = `Level test for ${next}`;
        nextLevel = next;
      }

      const { data: session, error } = await db.from('english_sessions')
        .insert({ user_id: caller.id, kind, lesson_id: lessonId, skill, title, level, next_level: nextLevel, next_skill: skill })
        .select().single();
      if (error) throw error;

      // Lesson openings are shared to save AI costs, so they hold nothing personal.
      const cacheKey = kind === 'lesson' ? `${lessonId}:${level}:${profile.language}` : null;
      let opening: string | null = null;
      let speakText = '';
      if (cacheKey) {
        const { data: cached } = await db.from('english_lesson_cache').select('opening').eq('key', cacheKey).maybeSingle();
        opening = cached?.opening ?? null;
      }
      let model = 'cache';
      if (!opening) {
        const result = await generateJson<Row>({
          name: 'english_opening',
          instructions: `${TEACHER} ${languageRule(profile.language, level)} ${sessionRule(session, 0, 0, activityTask)} Start now: greet them in a few words, say what today's goal is, and ask your first question or give your first example and exercise. "graded" must be null.${kind === 'lesson' ? '' : ` ${await memory()}`}`,
          input: `First name: ${kind === 'lesson' ? 'do not use a name' : caller.first_names.split(' ')[0] || 'not given'}`,
          schema: teacherSchema,
        });
        opening = cleanText(result.data.reply);
        speakText = result.data.speak_text ?? '';
        model = `${result.provider}:${result.model}`;
        if (cacheKey && !speakText) await db.from('english_lesson_cache').upsert({ key: cacheKey, opening });
      }
      await db.from('english_messages').insert({ session_id: session.id, user_id: caller.id, sender: 'teacher', body: opening, speak_text: speakText || null, model });
      return json({ id: session.id });
    }

    // ---------- The student answers ----------
    const { data: session } = await db.from('english_sessions').select('*').eq('id', body.session_id).eq('user_id', caller.id).single();
    if (!session) return fail('This session is no longer available.', 404);
    if (session.status === 'completed') return fail('This one is finished. You can start it again from your lessons.');
    if (await limitReached()) return fail(LIMIT_TEXT, 429);

    let message = String(body.text ?? '').trim().slice(0, 4000);
    let fromVoice = false;
    if (body.audio_path) {
      if (!String(body.audio_path).startsWith(`${caller.id}/`)) return fail('File not found.', 404);
      const { data: file } = await db.storage.from('coach-files').download(body.audio_path);
      if (!file) return fail('We could not open your voice note. Please try again.');
      const name = String(body.audio_path).split('/').pop() ?? 'voice.m4a';
      const mime = name.endsWith('.webm') ? 'audio/webm' : name.endsWith('.ogg') ? 'audio/ogg' : 'audio/mp4';
      const heard = await transcribe(new Uint8Array(await file.arrayBuffer()), name, mime);
      await db.storage.from('coach-files').remove([body.audio_path]);
      message = heard.data.trim();
      fromVoice = true;
      if (!message) return fail('We could not hear any words. Please try again, or type your answer.');
    }
    if (!message) return fail('Please write your answer first.');

    const [{ data: earlier }, { data: marked }] = await Promise.all([
      db.from('english_messages').select('sender, body, speak_text, from_voice').eq('session_id', session.id).order('created_at', { ascending: false }).limit(24),
      db.from('english_answers').select('id, skill, level, is_correct').eq('session_id', session.id).order('created_at'),
    ]);
    const answers = (marked ?? []) as Row[];
    const transcript = [...(earlier ?? [])].reverse().map((m: Row) =>
      `${m.sender === 'teacher' ? 'Teacher' : 'Student'}${m.from_voice ? ' (voice note, the words we heard)' : ''}: ${m.body}${m.speak_text ? ` [read aloud: ${m.speak_text}]` : ''}`,
    ).join('\n');
    const activity = dailyActivities.find((d) => d.id === session.lesson_id);

    const result = await generateJson<Row>({
      name: 'english_teacher',
      instructions: `${TEACHER} ${languageRule(profile.language, session.level)} ${sessionRule(session, answers.length, answers.filter((a) => a.is_correct).length, activity?.task)} ${await memory()}`,
      input: `Chat so far:\n${transcript}\nStudent${fromVoice ? ' (voice note, the words we heard)' : ''}: ${message}`,
      schema: teacherSchema,
    });
    const ai = result.data;
    const replyText = cleanText(ai.reply);

    // Save the answer. The student's own words are the evidence, and the skill comes from this session.
    let newAnswer: Row = null;
    if (ai.graded) {
      let skill: Skill = session.next_skill ?? session.skill ?? 'grammar';
      // A typed answer cannot show speaking, so it never counts as speaking.
      if (skill === 'speaking' && !fromVoice) skill = 'writing';
      newAnswer = {
        session_id: session.id,
        user_id: caller.id,
        skill,
        level: session.next_level ?? session.level,
        question: cleanText(ai.graded.question).slice(0, 1000),
        student_answer: message,
        correct_answer: cleanText(ai.graded.correct_answer).slice(0, 1000),
        is_correct: !!ai.graded.is_correct,
        explanation: cleanText(ai.graded.explanation).slice(0, 1000),
      };
      await db.from('english_answers').insert(newAnswer);
      answers.push(newAnswer);
    }

    for (const m of ai.mistakes ?? []) {
      const pattern = cleanText(m.pattern).toLowerCase().slice(0, 80);
      if (!pattern) continue;
      const { data: seen } = await db.from('english_mistakes').select('times').eq('user_id', caller.id).eq('pattern', pattern).maybeSingle();
      await db.from('english_mistakes').upsert({ user_id: caller.id, pattern, example: String(m.example).slice(0, 300), correction: String(m.correction).slice(0, 300), times: (seen?.times ?? 0) + 1, last_seen: new Date().toISOString() });
    }
    const words = (ai.vocabulary ?? []).filter((v: Row) => v.word?.trim());
    if (words.length) {
      await db.from('english_vocabulary').upsert(
        words.map((v: Row) => ({ user_id: caller.id, word: v.word.trim().toLowerCase().slice(0, 60), meaning: cleanText(v.meaning).slice(0, 300), example: cleanText(v.example).slice(0, 300) })),
        { onConflict: 'user_id,word', ignoreDuplicates: true },
      );
    }

    // Learning time and streak come from real answers.
    const seconds = Math.min(MAX_SECONDS_PER_REPLY, Math.round((Date.now() - new Date(session.last_message_at).getTime()) / 1000));
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const streak = profile.last_active_on === today ? profile.streak_days : profile.last_active_on === yesterday ? profile.streak_days + 1 : 1;
    const update: Row = {
      learning_seconds: profile.learning_seconds + seconds,
      updated_at: new Date().toISOString(),
      ...(newAnswer ? { streak_days: streak, best_streak: Math.max(profile.best_streak, streak), last_active_on: today } : {}),
    };

    const sessionUpdate: Row = { last_message_at: new Date().toISOString() };
    const kind = session.kind as Kind;
    const target = TARGET[kind];

    // The next question: tests move level and skill by rule, not by the AI's choice.
    if (newAnswer && kind === 'assessment') {
      const at = LEVELS.indexOf(session.next_level);
      sessionUpdate.next_level = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, at + (newAnswer.is_correct ? 1 : -1)))];
      sessionUpdate.next_skill = ASSESSMENT_SKILLS[answers.length % ASSESSMENT_SKILLS.length];
    }
    if (newAnswer && (kind === 'weekly' || kind === 'level_test')) sessionUpdate.next_skill = SKILLS[answers.length % SKILLS.length];

    // Finished? Lessons keep going until the last answers show understanding, up to twice the target.
    const recent = answers.slice(-target);
    const recentScore = percent(recent) ?? 0;
    const isTaught = kind === 'lesson' || kind === 'daily';
    const finished = answers.length >= target && (!isTaught || recentScore >= PASS[kind] || answers.length >= target * 2);
    let outcome: Row = null;
    if (finished) {
      const score = isTaught ? recentScore : percent(answers) ?? 0;
      const passed = score >= PASS[kind];
      sessionUpdate.status = 'completed';
      sessionUpdate.completed_at = new Date().toISOString();
      sessionUpdate.score = score;
      sessionUpdate.passed = passed;
      outcome = { score, passed, kind };
      if (passed) update.points = profile.points + POINTS[kind];

      if (kind === 'assessment') {
        update.level = placement(answers);
        update.assessed_at = new Date().toISOString();
        outcome.level = update.level;
      }
      if (kind === 'level_test' && passed) {
        update.level = session.next_level;
        outcome.level = update.level;
      }
      if (kind === 'daily') await db.from('english_daily').upsert({ user_id: caller.id, day: today, activity: session.lesson_id });
      if (session.lesson_id === 'revision') {
        const { data: revised } = await db.from('english_vocabulary').select('word').eq('user_id', caller.id).order('next_review').limit(8);
        const later = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
        await db.from('english_vocabulary').update({ next_review: later }).eq('user_id', caller.id).in('word', (revised ?? []).map((w: Row) => w.word));
      }
      if (kind === 'assessment' || update.level) {
        const { data: everything } = await db.from('english_answers').select('skill, is_correct').eq('user_id', caller.id).order('created_at', { ascending: false }).limit(500);
        update.plan = buildPlan(update.level ?? profile.level, skillScores(everything ?? []), new Set());
      }
    }

    await db.from('english_profiles').update(update).eq('user_id', caller.id);
    await db.from('english_sessions').update(sessionUpdate).eq('id', session.id);
    const { data: saved, error: saveError } = await db.from('english_messages').insert([
      // Rows saved together must have the same fields, or the missing ones are saved as empty.
      { session_id: session.id, user_id: caller.id, sender: 'student', body: message, speak_text: null, from_voice: fromVoice, model: null, created_at: new Date().toISOString() },
      { session_id: session.id, user_id: caller.id, sender: 'teacher', body: replyText, speak_text: ai.speak_text?.trim() || null, from_voice: false, model: `${result.provider}:${result.model}`, created_at: new Date(Date.now() + 1000).toISOString() },
    ]).select('id, sender, body, speak_text, from_voice, created_at');
    if (saveError) throw saveError;
    return json({ messages: saved, outcome, progress: { marked: answers.length, target } });
  } catch (e) {
    console.error(e);
    return fail('Your teacher is not available right now. Please try again in a moment.', 500);
  }
});

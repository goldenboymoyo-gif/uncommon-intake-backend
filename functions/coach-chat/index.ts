// WhatsApp style career coach for students and graduates: CV, cover letter, interview and English.
// The coach asks one thing at a time and builds on what the person just said.
// It teaches and gives feedback. It never writes the CV, the letter or the answer for them.
import { corsHeaders, fail, json } from '../_shared/cors.ts';
import { adminClient, getCaller } from '../_shared/clients.ts';
import { cleanText, generateJson, transcribe } from '../_shared/ai.ts';
import { documentToText } from '../_shared/documents.ts';

const DAILY_LIMIT = 100;
const HISTORY = 30;

type Topic = 'cv' | 'cover_letter' | 'interview' | 'english';
type Subject = { label: string; coach: string };

const careers: Record<string, Subject> = {
  software: { label: 'software developer', coach: 'Tendai' },
  marketing: { label: 'digital marketer', coach: 'Rudo' },
  design: { label: 'product designer', coach: 'Farai' },
  hr: { label: 'HR interview for a tech job', coach: 'Nyasha' },
  other: { label: '', coach: 'Tatenda' },
};

const english: Record<string, Subject & { focus: string }> = {
  general: { label: 'everyday English', coach: 'Chipo', focus: 'how to greet people, make small talk, ask for things and keep a conversation going politely.' },
  work: { label: 'English for work', coach: 'Chipo', focus: 'professional English: talking to managers and clients, meetings, polite requests, emails and phone calls.' },
  pronunciation: {
    label: 'pronunciation',
    coach: 'Chipo',
    focus: 'saying words clearly. Give a word or short sentence, show how it sounds with simple spacing (for example "pro nun see AY shun"), and ask them to tap the microphone and say it. Voice notes reach you as the words we heard, so compare those with the word you asked for. If a different word was heard, say which sound to practise and try again. Never comment on their accent.',
  },
  spelling: { label: 'spelling', coach: 'Chipo', focus: 'spelling. Give a short sentence or a word to spell, mark what is wrong, explain the rule or a trick to remember it, then test them again.' },
};

const replySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['thinking', 'reply'],
  properties: { thinking: { type: 'string' }, reply: { type: 'string' } },
};

const openingSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['is_tech', 'reply'],
  properties: { is_tech: { type: 'boolean' }, reply: { type: 'string' } },
};

const CHAT_STYLE = [
  'Before you reply, think carefully in "thinking", which the student never sees: what exactly did they say, what is strong, what is vague or wrong, do they sound sure of it, and what one thing would help them most next. Then write "reply" based on that, and refer to the real words they used.',
  'This is a chat on a phone, like WhatsApp. Write 1 to 4 short sentences in plain text, with no lists.',
  'Ask only one question in each message. Never offer a list of questions to choose from.',
  'Use simple English that a person still learning English can follow. If they write in Shona or Ndebele, you may explain a hard idea in that language, then return to English.',
  'Uncommon only teaches technology: software development, digital marketing and product design. If they ask about a career or subject outside technology, kindly bring the chat back to technology jobs.',
  'Judge only their words. If someone honestly asks whether you are a person, say you are an AI coach.',
].join(' ');

function coachRules(topic: Topic, name: string, subject: string, subjectId: string) {
  const who = `Your name is ${name}, a coach at Uncommon in Zimbabwe.`;
  if (topic === 'interview') {
    return [
      who,
      `You run a realistic practice interview for this role: ${subject}.`,
      'Act like a real interviewer who also teaches. After each answer, say in one or two sentences what worked and one thing to fix, then ask the next question.',
      'Build the next question from what they just said. If the answer is vague or sounds unsure, dig in: ask for a real example, the steps they took, the result, or why they chose it, so you can see if they truly know it and can answer with confidence. Tell them plainly when an answer sounds unsure and what would make it stronger.',
      'Include real questions for this role, including practical skill questions a junior can answer by talking. Never give them words to copy. Never ask about age, family, religion, health, tribe, politics or money.',
    ].join(' ');
  }
  if (topic === 'cv') {
    return [
      who,
      `You teach the person to write a strong CV for this career: ${subject}.`,
      'They may upload or paste their CV. Look at structure, a short profile, skills for this career, projects with results, work and training, contact details and links, length and spelling.',
      'If what they send is not a CV, or is written for a career outside technology, say so kindly and explain what a CV for this career should show.',
      'Teach one thing at a time: explain what to fix and why it matters, then ask them to rewrite that part and send it back. Never write the CV or give wording to copy.',
    ].join(' ');
  }
  if (topic === 'cover_letter') {
    return [
      who,
      `You teach the person to write a strong cover letter for this career: ${subject}.`,
      'They may upload or paste their letter. Look at a clear opening that names the job, why this company, one or two real examples, matching the job advert, length and a polite close.',
      'If what they send is not a cover letter, or is for a career outside technology, say so kindly and explain what a good letter does.',
      'Teach one thing at a time: explain what to fix and why it matters, then ask them to rewrite that part and send it back. Never write the letter or give wording to copy.',
    ].join(' ');
  }
  return [
    who,
    `You are a patient English teacher. Today's lesson is ${english[subjectId]?.focus ?? 'everyday English.'}`,
    'Correct mistakes gently: show the better sentence, explain why in a few words, then ask them to try again or move to the next small step. Praise real progress. Build each message on what they just wrote or said.',
  ].join(' ');
}

const openingFor = (topic: Topic) =>
  topic === 'interview'
    ? 'Start the chat: greet them in one short sentence, then ask the first question an interviewer for this role would normally open with.'
    : topic === 'english'
      ? 'Start the chat: greet them in one short sentence, then ask one easy question that starts the lesson.'
      : 'Start the chat: greet them in one short sentence, then ask them to upload or paste what they have, or to tell you the job they are going for if they have not written it yet.';

const audioMime = (path: string) =>
  path.endsWith('.webm') ? 'audio/webm' : path.endsWith('.ogg') ? 'audio/ogg' : path.endsWith('.mp3') ? 'audio/mpeg' : 'audio/mp4';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const caller = await getCaller(req);
    if (!caller) return fail('Please sign in again.', 401);
    if (caller.role !== 'student' && caller.role !== 'graduate') return fail('The career coach opens once you are a student.', 403);

    const body = await req.json();
    const db = adminClient();
    const { data: me } = await db.from('profiles').select('first_names').eq('id', caller.id).single();
    const firstName = (me?.first_names ?? '').split(' ')[0];

    const limitReached = async () => {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const { count } = await db
        .from('coach_messages')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', caller.id)
        .eq('sender', 'student')
        .gte('created_at', today.toISOString());
      return (count ?? 0) >= DAILY_LIMIT;
    };

    // The coach reads a word or sentence aloud. One file per person, replaced each time.
    if (body.action === 'speak') {
      const text = String(body.text ?? '').trim().slice(0, 400);
      if (!text) return fail('There is nothing to read.');
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: Deno.env.get('OPENAI_TTS_MODEL') ?? 'gpt-4o-mini-tts', voice: 'alloy', input: text, response_format: 'mp3' }),
      });
      if (!res.ok) throw new Error(`speech error ${res.status}: ${await res.text()}`);
      const path = `${caller.id}/coach-voice.mp3`;
      const { error } = await db.storage.from('coach-files').upload(path, await res.arrayBuffer(), { contentType: 'audio/mpeg', upsert: true });
      if (error) throw error;
      const { data: link } = await db.storage.from('coach-files').createSignedUrl(path, 300);
      return json({ url: link?.signedUrl });
    }

    // Start a new chat. The coach speaks first.
    if (body.action === 'start') {
      const topic = body.topic as Topic;
      if (!['cv', 'cover_letter', 'interview', 'english'].includes(topic)) return fail('Please choose what you want to learn.');
      const subjectId = String(body.subject_id ?? '');
      const known = topic === 'english' ? english[subjectId] : careers[subjectId];
      if (!known) return fail('Please choose what you want to learn.');
      const subject = subjectId === 'other' ? String(body.subject ?? '').trim().slice(0, 80) : known.label;
      if (subject.length < 2) return fail('Please type the tech career you want.');
      if (await limitReached()) return fail(`You have reached today's limit of ${DAILY_LIMIT} coach messages. Come back tomorrow.`, 429);

      const result = await generateJson<{ is_tech: boolean; reply: string }>({
        name: 'coach_opening',
        instructions: `${coachRules(topic, known.coach, subject, subjectId)} ${CHAT_STYLE} ${openingFor(topic)} Set is_tech to false only if the career below has nothing to do with technology, digital marketing or design. English lessons are always true.`,
        input: `Student's first name: ${firstName || 'not given'}\nCareer or lesson: ${subject}`,
        schema: openingSchema,
      });
      if (!result.data.is_tech && subjectId === 'other') {
        return fail('We only coach technology careers. Please type a tech career, like data analyst, IT support or cyber security.', 422);
      }

      const { data: chat, error } = await db
        .from('coach_chats')
        .insert({ user_id: caller.id, topic, subject_id: subjectId, subject })
        .select()
        .single();
      if (error) throw error;
      await db.from('coach_messages').insert({
        chat_id: chat.id,
        user_id: caller.id,
        sender: 'coach',
        body: cleanText(result.data.reply),
        model: `${result.provider}:${result.model}`,
      });
      return json(chat);
    }

    // The student sends a message: text, a file, or a voice note.
    const { chat_id, text, file_path, file_name, audio_path } = body;
    const { data: chat } = await db.from('coach_chats').select('*').eq('id', chat_id).eq('user_id', caller.id).single();
    if (!chat) return fail('This chat is no longer available.', 404);
    if (await limitReached()) return fail(`You have reached today's limit of ${DAILY_LIMIT} coach messages. Come back tomorrow.`, 429);

    let message = String(text ?? '').trim().slice(0, 6000);
    let documentText: string | null = null;
    let fromVoice = false;

    for (const path of [file_path, audio_path]) {
      if (path && !String(path).startsWith(`${caller.id}/`)) return fail('File not found.', 404);
    }
    if (file_path) {
      const { data: file } = await db.storage.from('coach-files').download(file_path);
      if (!file) return fail('We could not open your file. Please try again.');
      documentText = (await documentToText(new Uint8Array(await file.arrayBuffer()), file_name ?? file_path)).slice(0, 15000);
      await db.storage.from('coach-files').remove([file_path]);
      if (documentText.trim().length < 20) return fail('We could not read the words in this file. Please paste the text instead.');
      message = message || `I sent my file: ${file_name ?? 'document'}`;
    }
    if (audio_path) {
      const { data: file } = await db.storage.from('coach-files').download(audio_path);
      if (!file) return fail('We could not open your voice note. Please try again.');
      const heard = await transcribe(new Uint8Array(await file.arrayBuffer()), String(audio_path).split('/').pop() ?? 'voice.m4a', audioMime(audio_path));
      await db.storage.from('coach-files').remove([audio_path]);
      message = heard.data.trim();
      fromVoice = true;
      if (!message) return fail('We could not hear any words. Please try again, or type your answer.');
    }
    if (!message) return fail('Please write a message first.');

    const { data: earlier } = await db
      .from('coach_messages')
      .select('sender, body, from_voice, document_text')
      .eq('chat_id', chat.id)
      .order('created_at', { ascending: false })
      .limit(HISTORY);
    const line = (m: { sender: string; body: string; from_voice?: boolean; document_text?: string | null }) =>
      `${m.sender === 'coach' ? 'Coach' : 'Student'}${m.from_voice ? ' (voice note, these are the words we heard)' : ''}: ${m.body}${m.document_text ? `\nTheir document:\n"""\n${m.document_text}\n"""` : ''}`;
    const transcript = [...(earlier ?? [])].reverse().map(line).join('\n');

    const coachName = (chat.topic === 'english' ? english[chat.subject_id] : careers[chat.subject_id])?.coach ?? 'Tatenda';
    const result = await generateJson<{ reply: string }>({
      name: 'coach_reply',
      instructions: `${coachRules(chat.topic, coachName, chat.subject, chat.subject_id)} ${CHAT_STYLE} Reply to the last student message only, as the coach.`,
      input: `Student's first name: ${firstName || 'not given'}\n\nChat so far:\n${transcript}\n${line({ sender: 'student', body: message, from_voice: fromVoice, document_text: documentText })}`,
      schema: replySchema,
    });

    const { data: saved, error } = await db
      .from('coach_messages')
      .insert([
        // Rows saved together must have the same fields, or the missing ones are saved as empty.
        { chat_id: chat.id, user_id: caller.id, sender: 'student', body: message, from_voice: fromVoice, document_text: documentText, model: null, created_at: new Date().toISOString() },
        { chat_id: chat.id, user_id: caller.id, sender: 'coach', body: cleanText(result.data.reply), from_voice: false, document_text: null, model: `${result.provider}:${result.model}`, created_at: new Date(Date.now() + 1000).toISOString() },
      ])
      .select('id, sender, body, from_voice, created_at');
    if (error) throw error;
    await db.from('coach_chats').update({ updated_at: new Date().toISOString() }).eq('id', chat.id);
    return json({ messages: saved });
  } catch (e) {
    console.error(e);
    return fail('The coach is not available right now. Please try again in a moment.', 500);
  }
});

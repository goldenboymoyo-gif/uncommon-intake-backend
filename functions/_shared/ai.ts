// One small AI module for every Edge Function.
// AI_PROVIDER picks the provider: "openai" (default) or "huggingface".
// The AI only gives feedback and summaries. It never makes a decision about a person.

type JsonSchema = Record<string, unknown>;

export type AiResult<T> = { data: T; provider: string; model: string };

const provider = (Deno.env.get('AI_PROVIDER') ?? 'openai').toLowerCase();

// Rules added to every prompt.
const GUARDRAILS = [
  'You help staff and applicants of a free technology bootcamp.',
  'Never decide, score, rank or recommend whether a person should be accepted or rejected.',
  'Never comment on face, voice, tone, accent, emotion, appearance, age, gender, religion, health or background.',
  'Work only from the text you are given. Do not invent facts.',
  'Write in simple, plain English with short sentences.',
  'Sound like a kind, experienced human coach, not a machine.',
  'Never use hyphens, dashes or arrows in your writing: write "12 month" not "12-month", and use commas or full stops instead of dashes.',
  'No emojis, no hashtags, no bold or markdown, and no phrases like "Great question", "delve", "leverage", "showcase", "in today's fast paced world" or "I hope this helps".',
].join(' ');

// Removes any dashes the model still writes, so text never looks machine made.
export function cleanText(text: string): string {
  return text.replace(/\s*[–—]\s*/g, ', ').replace(/(\w)-(\w)/g, '$1 $2').replace(/^\s*[-*]\s+/gm, '').trim();
}

export async function generateJson<T>(opts: {
  name: string;
  instructions: string;
  input: string;
  schema: JsonSchema;
}): Promise<AiResult<T>> {
  const system = `${GUARDRAILS} ${opts.instructions}`;
  return provider === 'huggingface'
    ? await hfJson<T>(system, opts)
    : await openAiJson<T>(system, opts);
}

export async function transcribe(audio: Uint8Array, filename: string, mime: string): Promise<AiResult<string>> {
  return provider === 'huggingface'
    ? await hfTranscribe(audio, mime)
    : await openAiTranscribe(audio, filename, mime);
}

// ---------- OpenAI ----------
async function openAiJson<T>(system: string, opts: { name: string; input: string; schema: JsonSchema }): Promise<AiResult<T>> {
  const model = requireEnv('OPENAI_MODEL');
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireEnv('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: system },
        { role: 'user', content: opts.input },
      ],
      text: { format: { type: 'json_schema', name: opts.name, schema: opts.schema, strict: true } },
      store: false,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const text: string | undefined = body.output
    ?.flatMap((item: { content?: { type: string; text?: string }[] }) => item.content ?? [])
    .find((c: { type: string }) => c.type === 'output_text')?.text;
  if (!text) throw new Error('OpenAI returned no text');
  return { data: JSON.parse(text) as T, provider: 'openai', model };
}

async function openAiTranscribe(audio: Uint8Array, filename: string, mime: string): Promise<AiResult<string>> {
  const model = requireEnv('OPENAI_TRANSCRIBE_MODEL');
  const form = new FormData();
  form.append('file', new Blob([audio as BlobPart], { type: mime }), filename);
  form.append('model', model);
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireEnv('OPENAI_API_KEY')}` },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI transcribe error ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return { data: String(body.text ?? ''), provider: 'openai', model };
}

// ---------- Hugging Face Inference Providers (fallback) ----------
async function hfJson<T>(system: string, opts: { name: string; input: string; schema: JsonSchema }): Promise<AiResult<T>> {
  const model = requireEnv('HF_MODEL');
  const res = await fetch('https://router.huggingface.co/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireEnv('HF_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: `${system} Reply with JSON only that matches this schema: ${JSON.stringify(opts.schema)}` },
        { role: 'user', content: opts.input },
      ],
      response_format: { type: 'json_schema', json_schema: { name: opts.name, schema: opts.schema, strict: true } },
    }),
  });
  if (!res.ok) throw new Error(`Hugging Face error ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const text: string = body.choices?.[0]?.message?.content ?? '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('Hugging Face returned no JSON');
  return { data: JSON.parse(text.slice(start, end + 1)) as T, provider: 'huggingface', model };
}

async function hfTranscribe(audio: Uint8Array, mime: string): Promise<AiResult<string>> {
  const model = requireEnv('HF_TRANSCRIBE_MODEL');
  const res = await fetch(`https://router.huggingface.co/hf-inference/models/${model}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireEnv('HF_TOKEN')}`, 'Content-Type': mime },
    body: audio as BodyInit,
  });
  if (!res.ok) throw new Error(`Hugging Face transcribe error ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return { data: String(body.text ?? ''), provider: 'huggingface', model };
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing secret ${name}`);
  return value;
}

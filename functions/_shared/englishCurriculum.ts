// The English Tutor curriculum. The app reads it through the english-tutor function.
export type Skill = 'grammar' | 'vocabulary' | 'speaking' | 'writing' | 'reading' | 'listening';
export type Lesson = { id: string; title: string; objective: string };
export type Module = { id: string; title: string; skill: Skill; lessons: Lesson[] };

const lessons = (prefix: string, items: [string, string][]): Lesson[] =>
  items.map(([title, objective], i) => ({ id: `${prefix}${i + 1}`, title, objective }));

export const curriculum: Module[] = [
  {
    id: 'vocabulary',
    title: 'Vocabulary',
    skill: 'vocabulary',
    lessons: lessons('v', [
      ['Everyday words', 'Use common everyday words correctly in sentences.'],
      ['Word meanings', 'Work out what a new word means and use it.'],
      ['Synonyms and antonyms', 'Choose words with the same or opposite meaning.'],
      ['Common expressions', 'Understand and use common English expressions.'],
      ['Professional words', 'Use polite, professional words with other people.'],
      ['Workplace words', 'Use words you need in a tech workplace.'],
      ['Academic words', 'Understand words used in study and training.'],
      ['Words in sentences', 'Put new words in the right place in a sentence.'],
    ]),
  },
  {
    id: 'grammar',
    title: 'Grammar',
    skill: 'grammar',
    lessons: lessons('g', [
      ['Nouns', 'Find and use nouns, including plurals.'],
      ['Pronouns', 'Replace nouns with the correct pronoun.'],
      ['Verbs', 'Find and use verbs correctly.'],
      ['Adjectives', 'Describe people and things with adjectives.'],
      ['Adverbs', 'Say how and when things happen with adverbs.'],
      ['Prepositions', 'Choose prepositions like in, on and at.'],
      ['Conjunctions', 'Join ideas with words like and, but and because.'],
      ['Articles', 'Choose between a, an and the.'],
      ['Tenses', 'Use past, present and future tenses correctly.'],
      ['Subject and verb agreement', 'Make the verb agree with its subject.'],
      ['Building sentences', 'Put words in the right order to build clear sentences.'],
      ['Punctuation', 'Use full stops, commas, capitals and question marks.'],
      ['Active and passive voice', 'Change sentences between active and passive voice.'],
      ['Direct and indirect speech', 'Report what someone said correctly.'],
    ]),
  },
  {
    id: 'speaking',
    title: 'Speaking and communication',
    skill: 'speaking',
    lessons: lessons('s', [
      ['Introducing yourself', 'Say who you are and what you do with confidence.'],
      ['Talking about your family', 'Talk about your family in clear sentences.'],
      ['Talking about your education', 'Explain what you have studied and learned.'],
      ['Asking for directions', 'Ask for directions and understand the answer.'],
      ['Talking with classmates', 'Start and keep a friendly conversation going.'],
      ['Attending interviews', 'Answer interview questions clearly.'],
      ['Speaking to employers', 'Speak politely and professionally to an employer.'],
      ['Taking part in meetings', 'Share an idea and ask questions in a meeting.'],
      ['Giving presentations', 'Open, explain and close a short presentation.'],
    ]),
  },
  {
    id: 'writing',
    title: 'Writing',
    skill: 'writing',
    lessons: lessons('w', [
      ['Correct sentences', 'Write complete sentences with no common mistakes.'],
      ['Paragraphs', 'Write a clear paragraph with one main idea.'],
      ['Emails', 'Write a clear email with a greeting and a close.'],
      ['Professional messages', 'Write short, polite work messages.'],
      ['CVs', 'Write clear sentences for a CV in your own words.'],
      ['Cover letters', 'Write a clear cover letter in your own words.'],
      ['Reports', 'Report what happened in a clear order.'],
      ['Essays', 'Plan and write a short essay.'],
      ['Job applications', 'Answer job application questions in your own words.'],
    ]),
  },
  {
    id: 'reading',
    title: 'Reading',
    skill: 'reading',
    lessons: lessons('r', [
      ['Understanding a passage', 'Read a short passage and say what happened.'],
      ['Words in a passage', 'Work out new words from the passage around them.'],
      ['Finding the main idea', 'Find the main idea of a passage.'],
      ['Reading between the lines', 'Work out what a writer means but does not say.'],
      ['Thinking about what you read', 'Give your own view of a passage, with reasons.'],
    ]),
  },
  {
    id: 'listening',
    title: 'Listening',
    skill: 'listening',
    lessons: lessons('l', [
      ['Listening to sentences', 'Understand short spoken sentences.'],
      ['Listening to conversations', 'Follow who said what in a conversation.'],
      ['Listening to short stories', 'Understand what happens in a short spoken story.'],
      ['Listening at work', 'Understand spoken instructions at work.'],
    ]),
  },
];

export const findLesson = (id: string) => {
  for (const module of curriculum) {
    const lesson = module.lessons.find((l) => l.id === id);
    if (lesson) return { module, lesson };
  }
  return null;
};

export const dailyActivities: { id: string; title: string; skill: Skill; task: string }[] = [
  { id: 'word', title: 'Word of the day', skill: 'vocabulary', task: 'Teach one useful new word, then check they can use it.' },
  { id: 'grammar', title: 'Grammar challenge', skill: 'grammar', task: 'Give one short grammar challenge based on their common mistakes.' },
  { id: 'speaking', title: 'Speaking challenge', skill: 'speaking', task: 'Ask them to answer one short question using the microphone.' },
  { id: 'reading', title: 'Short reading', skill: 'reading', task: 'Give a passage of 3 or 4 sentences, then ask about it.' },
  { id: 'writing', title: 'Writing task', skill: 'writing', task: 'Ask them to write 2 or 3 sentences about a real topic.' },
  { id: 'revision', title: 'Word revision', skill: 'vocabulary', task: 'Test words they have learned before.' },
];

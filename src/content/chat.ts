/** Scripted Q&As. Shown as "Quick answers" now; reused by the avatar chat in Phase 2. */
import { EMAIL, GITHUB, LINKEDIN } from './links';
import type { ChatTopic } from './types';

export const chatTopics: ChatTopic[] = [
  {
    id: 'who',
    prompt: 'Who are you?',
    answer: [
      {
        type: 'text',
        text: 'I\'m Richman, a software developer in Auckland. I\'m finishing a Bachelor of Engineering (Honours) in Software Engineering at the University of Auckland, and I work at Sandfield.',
      },
    ],
    followUps: ['what-do'],
  },
  {
    id: 'what-do',
    prompt: 'What do you do?',
    answer: [
      {
        type: 'text',
        text: 'I build software across web, mobile and AI. At work that means internal tools with C#/.NET, PostgreSQL and React, plus a bit of native iOS and Android. I like getting things from idea to something people can actually use.',
      },
    ],
    followUps: ['built'],
  },
  {
    id: 'built',
    prompt: 'What have you built?',
    answer: [
      {
        type: 'text',
        text: 'My favourite is DementiaGuide AI, an iOS care assistant with a talking 3D avatar and answers grounded in curated sources. I also led a team of 8 as Scrum Master on a gamified engineering-pathways platform, and built the media pipeline and authoring tools for a medical teaching simulator. Fly to the Sky Tower for the full list.',
      },
    ],
    followUps: ['fun'],
  },
  {
    id: 'fun',
    prompt: 'What do you do for fun?',
    answer: [
      {
        type: 'text',
        text: 'Snowboarding is the big one. I also play volleyball and badminton, go on road trips, hit the beach, and when the weather turns I game or cook something I spotted on TikTok. I\'m an avid AI enjoyer too.',
      },
    ],
    followUps: ['reach'],
  },
  {
    id: 'reach',
    prompt: 'How do I reach you?',
    answer: [
      {
        type: 'text',
        text: `Email is easiest: ${EMAIL}. You can also find me on [GitHub](${GITHUB}) and [LinkedIn](${LINKEDIN}).`,
      },
    ],
  },
];

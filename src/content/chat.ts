/**
 * The bridge chat. Every answer restates facts already on the site (projects.ts, work.ts,
 * study.ts, offclock.ts); nothing here is new information. Topics marked quick are also the
 * "Quick answers" on the read-as-page view.
 */
import { DEMENTIAGUIDE_REPO, EMAIL, GITHUB, LINKEDIN } from './links';
import type { ChatScript, ChatTopic } from './types';

export const chatTopics: ChatTopic[] = [
  {
    id: 'who',
    prompt: 'Who are you?',
    quick: true,
    keywords: ['who are you', 'about you', 'about yourself', 'yourself', 'introduce', 'richman', 'your name', 'background'],
    answer: [
      {
        type: 'text',
        text: 'I\'m Richman, a software developer in Auckland. I\'m finishing a Bachelor of Engineering (Honours) in Software Engineering at the University of Auckland, and I work at Sandfield.',
      },
    ],
    followUps: ['what-do', 'study'],
  },
  {
    id: 'what-do',
    prompt: 'What do you do?',
    quick: true,
    keywords: ['what do you do', 'day to day', 'job', 'role', 'occupation', 'career', 'for a living', 'developer'],
    answer: [
      {
        type: 'text',
        text: 'I build software across web, mobile and AI. At work that means internal tools with C#/.NET, PostgreSQL and React, plus a bit of native iOS and Android. I like getting things from idea to something people can actually use.',
      },
    ],
    followUps: ['built', 'stack'],
  },
  {
    id: 'built',
    prompt: 'What have you built?',
    quick: true,
    keywords: ['what have you built', 'built', 'project', 'portfolio', 'made', 'side project', 'apps'],
    answer: [
      {
        type: 'text',
        text: 'My favourite is DementiaGuide AI, an iOS care assistant with a talking 3D avatar and answers grounded in curated sources. I was also Scrum Master for a team of 8 building a gamified engineering-pathways platform, and built the media pipeline and authoring tools for a medical teaching simulator. Fly to the Sky Tower for the full list.',
      },
    ],
    followUps: ['dementiaguide', 'wie'],
  },
  {
    id: 'fun',
    prompt: 'What do you do for fun?',
    quick: true,
    keywords: [
      'for fun', 'fun', 'hobby', 'hobbies', 'free time', 'spare time', 'weekend', 'outside of work', 'interests',
      'snowboard', 'volleyball', 'badminton', 'road trip', 'beach', 'gaming', 'games', 'cook', 'cooking', 'tiktok',
    ],
    answer: [
      {
        type: 'text',
        text: 'Snowboarding is the big one. I also play volleyball and badminton, go on road trips, hit the beach, and when the weather turns I game or cook something I spotted on TikTok. I\'m an avid AI enjoyer too.',
      },
    ],
    followUps: ['site', 'reach'],
  },
  {
    id: 'reach',
    prompt: 'How do I reach you?',
    quick: true,
    keywords: ['contact', 'reach', 'email', 'get in touch', 'hire', 'hiring', 'linkedin', 'github', 'message you', 'connect', 'talk to you'],
    answer: [
      {
        type: 'text',
        text: `Email is easiest: ${EMAIL}. You can also find me on [GitHub](${GITHUB}) and [LinkedIn](${LINKEDIN}).`,
      },
    ],
  },
  {
    id: 'work',
    prompt: 'Where do you work?',
    keywords: ['where do you work', 'where are you working', 'sandfield', 'work', 'working', 'company', 'employer', 'office', 'intern', 'internship', 'fetch', 'experience'],
    answer: [
      {
        type: 'text',
        text: 'I\'m a Software Developer at **Sandfield** on Ponsonby Road. I started there as an intern in November 2025 and joined the team as a developer in November 2026. I build internal tools with C#/.NET, PostgreSQL and React with TypeScript, plus native iOS and Android work. Before that I interned at **Fetch TCG**, building a Shopify theme.',
      },
    ],
    followUps: ['stack', 'study'],
  },
  {
    id: 'study',
    prompt: 'What are you studying?',
    keywords: ['study', 'studying', 'university', 'uni', 'degree', 'gpa', 'grades', 'school', 'uoa', 'honours', 'course', 'sesa', 'treasurer', 'graduate', 'graduating'],
    answer: [
      {
        type: 'text',
        text: 'Software Engineering at the University of Auckland, a Bachelor of Engineering (Honours) from 2023 to 2026. My GPA is 8.0 out of 9, and I made the Dean\'s Honours List in 2023 and 2024. Outside class I\'m Treasurer of **SESA**, the Software Engineering Student Association, and before that I ran its social events.',
      },
    ],
    followUps: ['wie', 'fun'],
  },
  {
    id: 'stack',
    prompt: 'What\'s your tech stack?',
    keywords: [
      'stack', 'tech', 'technology', 'technologies', 'language', 'framework', 'skills', 'tools', 'full stack',
      'typescript', 'javascript', 'react', 'c#', 'dotnet', 'node', 'postgres', 'postgresql', 'mongodb', 'backend', 'frontend',
    ],
    answer: [
      {
        type: 'text',
        text: 'On the front end, **TypeScript** and **React**. On the back end, **C#/.NET** and **Node**, with **PostgreSQL** or **MongoDB** for data. I\'ve also done native iOS and Android work, a React Native app with Expo, and retrieval (RAG) for AI assistants. This site is TypeScript and three.js with no game engine.',
      },
    ],
    followUps: ['work', 'site'],
  },
  {
    id: 'dementiaguide',
    prompt: 'Tell me about DementiaGuide AI',
    keywords: ['dementiaguide', 'dementia', 'research', 'final year', 'avatar', 'rag', 'care assistant', 'healthcare', 'ai project'],
    answer: [
      {
        type: 'text',
        text: `It's my final-year research project, built with a project partner. It's an iOS assistant that answers dementia-care questions in plain language. Every answer is grounded in **449 curated passages** found with hybrid search, and a **real-time 3D avatar** reads it aloud. The source is on [GitHub](${DEMENTIAGUIDE_REPO}).`,
      },
    ],
    followUps: ['stack', 'wie'],
  },
  {
    id: 'wie',
    prompt: 'What was WIE Academy?',
    keywords: ['wie', 'women in engineering', 'academy', 'scrum', 'scrum master', 'team project', 'team', 'phaser', '761', 'leadership', 'agile', 'gamified'],
    answer: [
      {
        type: 'text',
        text: 'A web platform for the University of Auckland\'s Women in Engineering Academy that helps high school students explore engineering pathways through a small game. I was **Scrum Master** for a team of 8, and I built the TypeScript migration, the campus map and walk scene, an arrival-letter cutscene, the campus shop and Vercel deploys from CI.',
      },
    ],
    followUps: ['built', 'reach'],
  },
  {
    id: 'site',
    prompt: 'How did you build this site?',
    keywords: ['this site', 'this website', 'website', 'site', 'built this', 'make this', 'made this', 'three', 'threejs', 'plane', 'map', 'lidar', 'openstreetmap', '3d', 'game'],
    answer: [
      {
        type: 'text',
        text: 'The buildings are **OpenStreetMap** footprints with heights from **LINZ LiDAR** surveys, and the scene is drawn with **three.js** at a deliberately low resolution so it stays pixelated. It\'s TypeScript and Vite with no game engine, and everything here also exists as a plain page with no JavaScript.',
      },
    ],
    followUps: ['stack', 'reach'],
  },
  {
    id: 'where',
    prompt: 'Where are you based?',
    keywords: ['where are you', 'where are you from', 'where do you live', 'based', 'location', 'located', 'new zealand', 'nz'],
    answer: [
      {
        type: 'text',
        text: 'Auckland, New Zealand. Sandfield is on Ponsonby Road and I study at the University of Auckland, and you can fly to both from here.',
      },
    ],
    followUps: ['work', 'study'],
  },
];

export const chatScript: ChatScript = {
  greeting: [
    { type: 'text', text: 'Hey, I\'m Richman. Thanks for flying all the way up here! Pick a question below or type your own.' },
  ],
  fallback: [
    {
      type: 'text',
      text: `My answers are pre-written for now, so I couldn't match that one. Try one of the questions below, or ask me by email at ${EMAIL}.`,
    },
  ],
  starters: ['who', 'built', 'fun'],
  smallTalk: [
    {
      // Checked before the topics, so job-seeking questions get a straight "email me" rather than the Sandfield answer.
      id: 'by-email',
      priority: true,
      keywords: [
        'looking for a job', 'looking for work', 'looking for a new', 'new job', 'open to work', 'open to opportunities',
        'job hunting', 'job search', 'relocate', 'relocating', 'relocation', 'visa', 'salary', 'notice period', 'availability',
      ],
      answer: [{ type: 'text', text: `That's one I'd rather answer properly over email, at ${EMAIL}.` }],
    },
    {
      id: 'hello',
      keywords: ['hi', 'hello', 'hey', 'kia ora', 'yo', 'gday', 'good morning', 'good afternoon', 'good evening'],
      answer: [{ type: 'text', text: 'Hey! Ask me about my work, projects or study, or what I get up to on weekends.' }],
    },
    {
      id: 'how-are-you',
      keywords: ['how are you', 'hows it going', 'how is it going', 'whats up'],
      answer: [{ type: 'text', text: 'Pretty good, thanks for asking! The view from up here helps.' }],
    },
    {
      id: 'thanks',
      keywords: ['thanks', 'thank you', 'thx', 'cheers', 'appreciate'],
      answer: [{ type: 'text', text: `No worries! If you want to keep talking, email me at ${EMAIL}.` }],
    },
    {
      id: 'bye',
      keywords: ['bye', 'goodbye', 'see you', 'see ya', 'cya'],
      answer: [{ type: 'text', text: 'See you! Press Esc to get back to flying.' }],
    },
  ],
};

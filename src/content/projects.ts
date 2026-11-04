/** Sky Tower stop: the things I have built. Source of truth for facts is the CV. */
import { DEMENTIAGUIDE_REPO, VPS_LIVE, VPS_REPO } from './links';
import type { Page } from './types';

export const projectPages: Page[] = [
  {
    id: 'dementiaguide',
    kicker: 'Final-year research project',
    title: 'DementiaGuide AI',
    subtitle: 'An iOS care assistant with a talking 3D avatar',
    period: '2026',
    blocks: [
      {
        type: 'text',
        text: 'DementiaGuide AI is an iOS assistant that answers dementia-care questions in plain language. It is my final-year research project, built with a project partner, with a focus on answers you can trust.',
      },
      { type: 'media', media: { src: '/media/dementiaguide-app.webp', alt: 'Four screens from the DementiaGuide AI app: the 3D avatar speaking, a chat answering a carer support question, the cited source card, and the sources list under the answer', width: 1200, height: 683, caption: 'The avatar, a grounded answer and its cited source (from the final report)' } },
      {
        type: 'list',
        items: [
          'Retrieval-augmented generation (RAG) over **449 curated passages**, so every answer is grounded in a source you can cite.',
          '**Hybrid search**, combining vector and keyword matching, to find the right passage.',
          'A **real-time 3D speaking avatar** that reads the answer aloud.',
          'Evaluation rebuilt around **deterministic retrieval and safety metrics** after an LLM judge turned out to discriminate poorly.',
          'A **systematic review of 13 sources** on AI-assisted dementia care, with WHO health-AI ethics guidance applied to the safety and privacy design.',
        ],
      },
      { type: 'media', media: { src: '/media/dementiaguide-lipsync.webp', alt: 'Three frames of the 3D avatar showing distinct mouth shapes for the sounds b, ah and f', width: 1200, height: 504, caption: 'Lip-sync: distinct mouth shapes from the final pipeline' } },
      { type: 'tags', items: ['React Native (Expo)', 'TypeScript', 'RAG', 'Hybrid search', 'PostgreSQL', 'ElevenLabs'] },
      { type: 'links', links: [{ label: 'Source on GitHub', href: DEMENTIAGUIDE_REPO, kind: 'repo', primary: true }] },
    ],
  },
  {
    id: 'wie-academy',
    kicker: 'SOFTENG 761 team project',
    title: 'WIE Academy',
    subtitle: 'A gamified engineering-pathways platform',
    period: 'Aug – Oct 2026',
    blocks: [
      {
        type: 'text',
        text: 'A web platform, built for the University of Auckland\'s Women in Engineering Academy, that helps high school students explore engineering pathways through a small game. The Academy is a real client with real students. I was **Scrum Master** for a team of 8.',
      },
      {
        type: 'text',
        text: 'My own work was the **TypeScript migration**, the **campus map and walk scene**, an **arrival-letter cutscene**, **Vercel deploys from CI**, and the **campus shop**.',
      },
      { type: 'tags', items: ['React', 'Phaser', 'TypeScript', 'Node / Express', 'Supabase Postgres', 'Payload CMS', 'Vercel'] },
      { type: 'text', text: 'The repository stays private until after exams, so there are no links here yet.' },
    ],
  },
  {
    id: 'chudvents',
    kicker: 'CS732 team project',
    title: 'Chudvents',
    subtitle: 'Club event discovery with a friends system',
    period: 'Mar – May 2026',
    blocks: [
      {
        type: 'text',
        text: 'A web app for finding university club events and seeing which ones your friends are going to. Built in a team of 9 for CS732.',
      },
      { type: 'media', media: { src: '/media/chudvents-feed.webp', alt: 'The Chudvents event feed: category filters across the top and cards for upcoming university club events', width: 1200, height: 604, caption: 'The event feed' } },
      { type: 'tags', items: ['React', 'TypeScript', 'Express', 'MongoDB', 'Firebase Auth'] },
    ],
  },
  {
    id: 'vps',
    kicker: 'WDCC',
    title: 'Virtual Patient Simulator',
    subtitle: 'Media pipeline and scenario authoring for medical teaching',
    blocks: [
      {
        type: 'text',
        text: 'A simulator that University of Auckland Medical and Health Science students use to work through patient cases. I built the **image-upload pipeline** that serves **4,000+ students**, storing media in MongoDB GridFS and syncing its metadata with Firestore.',
      },
      {
        type: 'text',
        text: 'I also built the **scenario-authoring UI** educators use to create and edit cases, with data access wrapped in custom React hooks so they can embed rich media without touching code.',
      },
      { type: 'tags', items: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS', 'MongoDB', 'Firestore', 'GitHub Actions', 'Fly.io'] },
      {
        type: 'links',
        links: [
          { label: 'Live site', href: VPS_LIVE, kind: 'live', primary: true },
          { label: 'Source on GitHub', href: VPS_REPO, kind: 'repo' },
        ],
      },
    ],
  },
  {
    id: 'this-site',
    kicker: 'You are standing in it',
    title: 'This site',
    subtitle: 'A small plane over real central Auckland',
    blocks: [
      {
        type: 'text',
        text: 'The world you are flying over is built from open data. The buildings come from **OpenStreetMap** footprints, with heights taken from **LINZ LiDAR** surveys, and the scene is drawn with **three.js** at a deliberately low resolution so it stays crisp and pixelated.',
      },
      {
        type: 'text',
        text: 'Everything you can read here also exists as a plain page with no JavaScript, for screen readers, slow connections and anyone who would rather skim.',
      },
      { type: 'media', media: { src: '/media/this-site.webp', alt: 'The pixel plane flying over Wynyard Quarter towards the Sky Tower, with the flight HUD along the bottom', width: 1200, height: 608, caption: 'Over Wynyard Quarter, heading for the Sky Tower' } },
      { type: 'tags', items: ['TypeScript', 'three.js', 'Vite', 'OpenStreetMap', 'LINZ LiDAR'] },
    ],
  },
];

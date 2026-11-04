/** Harbour Bridge stop: contact details and the scripted quick answers. */
import { chatTopics } from './chat';
import { contactLinks, EMAIL } from './links';
import type { Block, Page } from './types';

/** "Quick answers" is generated from the quick chat topics so the page and the chat never drift. */
const quickAnswerBlocks: Block[] = chatTopics.filter((t) => t.quick).flatMap((t): Block[] => [
  { type: 'text', text: `**${t.prompt}**` },
  ...t.answer,
]);

export const contactPages: Page[] = [
  {
    id: 'contact',
    kicker: 'Say hello',
    title: 'Get in touch',
    subtitle: 'I read every message',
    blocks: [
      {
        type: 'text',
        text: `Happy to chat about work, projects or anything you found on this site. Email is the quickest way to reach me: ${EMAIL}.`,
      },
      { type: 'links', links: contactLinks },
    ],
  },
  {
    id: 'quick-answers',
    kicker: 'Short version',
    title: 'Quick answers',
    subtitle: 'The questions people ask first',
    blocks: quickAnswerBlocks,
  },
];

/**
 * Ponsonby Road stop. Sandfield is described at capability level only: no metrics, no client or
 * product names, no internal project names (denylist in tests/content.test.ts).
 */
import type { Page } from './types';

export const workPages: Page[] = [
  {
    id: 'sandfield',
    kicker: 'Where I work',
    title: 'Sandfield',
    subtitle: 'Software Developer',
    period: 'Intern from Nov 2025, now a Software Developer',
    blocks: [
      {
        type: 'text',
        text: 'I started at Sandfield as a Software Engineering Intern in November 2025, and I am now joining the team as a Software Developer.',
      },
      {
        type: 'list',
        items: [
          'Built internal tools across **C#/.NET**, **PostgreSQL** with EF Core, and **React** with **TypeScript**.',
          'Background processing with **Hangfire** across many repositories.',
          'Retrieval (**RAG**) for an AI assistant, so its answers draw on the right context.',
          'Native **iOS** and **Android** work.',
        ],
      },
      {
        type: 'text',
        text: 'I keep the detail at the level of skills, because the products and clients belong to the team.',
      },
      { type: 'tags', items: ['C#', '.NET', 'EF Core', 'PostgreSQL', 'React', 'TypeScript', 'Hangfire', 'RAG', 'iOS', 'Android'] },
    ],
  },
  {
    id: 'fetch-tcg',
    kicker: 'Earlier internship',
    title: 'Fetch TCG Ltd.',
    subtitle: 'Software Engineering Intern',
    period: 'Nov 2024 – Feb 2025',
    blocks: [
      {
        type: 'list',
        items: [
          'Designed and built a reusable **Shopify theme** in **Liquid**, making the UI more consistent and easier to maintain for an e-commerce platform with **1,000+ registered users**.',
          'Built **product search and filtering** with Liquid and NextUI across large product collections.',
          'Improved front-end performance with **lazy loading**, asset minification and theme optimisation.',
        ],
      },
      { type: 'tags', items: ['Shopify', 'Liquid', 'NextUI', 'Performance'] },
    ],
  },
];

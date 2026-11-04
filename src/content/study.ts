/** University of Auckland stop. Figures are the CV's: GPA is 8.0 / 9. */
import { SESA_SITE } from './links';
import type { Page } from './types';

export const GPA = '8.0 / 9';

export const studyPages: Page[] = [
  {
    id: 'degree',
    kicker: 'The University of Auckland',
    title: 'Software Engineering (Honours)',
    subtitle: 'Bachelor of Engineering (Honours)',
    period: '2023–2026',
    blocks: [
      {
        type: 'facts',
        items: [
          { label: 'Degree', value: 'BE(Hons), Software Engineering' },
          { label: 'Years', value: '2023–2026' },
          { label: 'Cumulative GPA', value: GPA },
          { label: 'Honours', value: 'Dean\'s Honours List 2023 & 2024, top 5% of cohort' },
        ],
      },
      {
        type: 'text',
        text: '**Relevant coursework:** Object-Oriented Programming in Java (A+), Database Systems (A+), Data Structures and Algorithms, Operating Systems, Software Architecture, Networks and Security, Linear Programming.',
      },
      { type: 'tags', items: ['Java', 'Databases', 'Algorithms', 'Operating systems', 'Architecture'] },
    ],
  },
  {
    id: 'sesa',
    kicker: 'Student association',
    title: 'SESA',
    subtitle: 'Treasurer, previously Social Events Lead',
    period: 'Social Events Lead 2024–2025 · Treasurer 2026–present',
    blocks: [
      {
        type: 'text',
        text: 'The Software Engineering Student Association is the University of Auckland club for software students. I look after its money, and before that I ran its social events.',
      },
      {
        type: 'list',
        items: [
          'As **Treasurer**: budgets, payment batches and reconciliation in Xero, with a receipt attached to every payment.',
          'Designed a repeatable **AI-assisted reimbursement workflow** with a **human approval step** before anything is paid.',
          'As **Social Events Lead**: led a team of 4 coordinators organising events for software students.',
        ],
      },
      { type: 'links', links: [{ label: 'SESA website', href: SESA_SITE, kind: 'other' }] },
    ],
  },
  {
    id: 'wdcc',
    kicker: 'Student club',
    title: 'WDCC',
    subtitle: 'Web Development and Consulting Club',
    blocks: [
      {
        type: 'text',
        text: 'Through the University of Auckland\'s Web Development and Consulting Club I worked on the Virtual Patient Simulator, a real tool used in medical teaching. You can read about what I built on the Projects stop.',
      },
    ],
  },
];

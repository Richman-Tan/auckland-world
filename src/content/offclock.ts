/** Maungawhau / Mt Eden stop. Hobbies only; no upcoming trips or dates. */
import type { Page } from './types';

export const offclockPages: Page[] = [
  {
    id: 'offclock',
    kicker: 'Maungawhau / Mt Eden',
    title: 'Off the clock',
    subtitle: 'What I get up to when I am not coding',
    blocks: [
      {
        type: 'text',
        text: 'Away from the keyboard I am usually outside. **Snowboarding** is my favourite excuse for a trip up the mountain, and I love a game of **volleyball** or **badminton**. If you cannot find me, I am probably on a **road trip** or at the **beach**.',
      },
      {
        type: 'text',
        text: 'When the weather packs in, I settle in for some **gaming**, or cook a recipe I spotted on **TikTok**. I am also an avid **AI enjoyer**, curious about what it can already pull off and where it is heading next.',
      },
      { type: 'tags', items: ['Snowboarding', 'Volleyball', 'Badminton', 'Road trips', 'The beach', 'Gaming', 'Cooking', 'AI'] },
    ],
  },
];

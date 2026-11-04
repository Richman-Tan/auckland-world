/** The site content. M4 replaces the placeholders with the real profile and pages. */
import { stops } from './stops';
import type { SiteContent } from './types';

export const content: SiteContent = {
  profile: {
    name: 'Richman Tan',
    title: 'Software Developer · Sandfield',
    location: 'Auckland, New Zealand',
    tagline: 'Placeholder tagline.',
    intro: 'Placeholder intro.',
    email: 'richmantan0@gmail.com',
    links: [],
  },
  stops,
  // Over Wynyard Quarter, heading for Sky Tower.
  spawn: { at: { lat: -36.8395, lon: 174.759 }, altitudeAsl: 150, headingDeg: 164 },
  chatTopics: [],
  credits: [],
};

export type { SiteContent } from './types';

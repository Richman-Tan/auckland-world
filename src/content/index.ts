/** The site content: one source for the 3D world, the briefings, the read-as-page view and chat. */
import { chatTopics } from './chat';
import { contactLinks, EMAIL } from './links';
import { stops } from './stops';
import type { SiteContent } from './types';

export const content: SiteContent = {
  profile: {
    name: 'Richman Tan',
    title: 'Software Developer · Sandfield',
    location: 'Auckland, New Zealand',
    tagline: 'I build software across web, mobile and AI, and this is my corner of Auckland.',
    intro:
      'Hi, I am Richman. I am finishing a software engineering degree at the University of Auckland and working as a developer at Sandfield. This site is a small plane over real Auckland: fly to a beacon to see my projects, work and study, say hello, or find out what I do away from the keyboard.',
    email: EMAIL,
    links: contactLinks,
  },
  stops,
  // Over Wynyard Quarter, heading for Sky Tower.
  spawn: { at: { lat: -36.8395, lon: 174.759 }, altitudeAsl: 150, headingDeg: 164 },
  chatTopics,
  credits: [
    {
      label: 'Map data',
      text: 'Map data © OpenStreetMap contributors, ODbL. Derived map data in this site is available under the ODbL.',
      href: 'https://www.openstreetmap.org/copyright',
    },
    {
      label: 'Elevation and heights',
      text: 'Elevation and building heights from the Auckland LiDAR 1m DEM and DSM (2024), Toitū Te Whenua LINZ, CC BY 4.0.',
      href: 'https://creativecommons.org/licenses/by/4.0/',
    },
    {
      label: 'Fonts',
      text: 'Jersey 10 and Departure Mono, both under the SIL Open Font License 1.1.',
      href: 'https://openfontlicense.org/',
    },
    { label: 'Concept', text: 'Concept inspired by dvlan.dev.', href: 'https://dvlan.dev/' },
  ],
};

export type { SiteContent } from './types';

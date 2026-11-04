/**
 * The content model. One source for the 3D world (beacons, briefings, nav), the read-as-page
 * view and, in Phase 2, rooms and chat. Pure data types: no DOM, no three.
 */
import type { PaletteKey } from '../shared/palette';

export type StopId = 'projects' | 'work' | 'study' | 'talk' | 'offclock';

export interface GeoPoint {
  lat: number;
  lon: number;
}

/** Where a beacon stands: a lat/lon, or a measured landmark position from meta.json. */
export type Anchor =
  | { kind: 'geo'; lat: number; lon: number }
  | { kind: 'landmark'; id: 'skyTower' | 'harbourBridgeTop' };

export interface Link {
  label: string;
  href: string;
  kind: 'repo' | 'live' | 'email' | 'social' | 'cv' | 'other';
  primary?: boolean;
}

export interface Media {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption?: string;
}

/** Text supports inline **bold** and [label](https://...) links only. */
export type Block =
  | { type: 'text'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'facts'; items: { label: string; value: string }[] }
  | { type: 'tags'; items: string[] }
  | { type: 'media'; media: Media }
  | { type: 'links'; links: Link[] };

export interface Page {
  id: string;
  kicker?: string;
  title: string;
  subtitle?: string;
  period?: string;
  blocks: Block[];
}

/** What you can do at a stop. Phase 2 features are added here and nowhere else. */
export type Experience =
  | { kind: 'briefing' }
  | { kind: 'room'; roomId: string; status: 'planned' | 'live' }
  | { kind: 'chat'; topicsId: string; backend: 'scripted' | 'remote'; status: 'planned' | 'live' };

export interface Beacon {
  at: Anchor;
  /** Base of the light column: metres above the ground, the sea, or the landmark point itself. */
  height: { ref: 'ground' | 'sea' | 'anchor'; metres: number };
  color: PaletteKey;
  icon: 'code' | 'briefcase' | 'cap' | 'chat' | 'peak';
  /** Horizontal distance (m) at which the approach prompt appears. */
  triggerRadius: number;
  /** Radius (m) of the holding orbit flown on arrival and while reading. */
  orbitRadius: number;
}

export interface Stop {
  id: StopId;
  hotkey: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /** Short label for HUD and nav, e.g. "PROJECTS". */
  label: string;
  /** Real place name, e.g. "Sky Tower". */
  place: string;
  /** One line shown in the nav list and title screen. */
  pitch: string;
  beacon: Beacon;
  briefing: Page[];
  experiences: Experience[];
}

export interface Profile {
  name: string;
  title: string;
  location: string;
  tagline: string;
  intro: string;
  email: string;
  links: Link[];
  resumeUrl?: string;
}

export interface ChatTopic {
  id: string;
  /** The question as a visitor would ask it; shown on suggestion chips. */
  prompt: string;
  answer: Block[];
  /** Words and short phrases that route a typed question here (scripted matching). */
  keywords: string[];
  /** Topics to suggest next, in order. */
  followUps?: string[];
  /** Also listed under "Quick answers" on the read-as-page view. */
  quick?: boolean;
}

/** Replies that are not about a topic: greetings, thanks, goodbyes. Never carry facts. */
export interface ChatSmallTalk {
  id: string;
  keywords: string[];
  /** Matched before the topics (otherwise only when no topic matches). */
  priority?: boolean;
  answer: Block[];
}

export interface ChatScript {
  greeting: Block[];
  /** Said when a typed question matches nothing. */
  fallback: Block[];
  /** Topic ids offered before the first question. */
  starters: string[];
  smallTalk: ChatSmallTalk[];
}

export interface SiteContent {
  profile: Profile;
  stops: Stop[];
  spawn: { at: GeoPoint; altitudeAsl: number; headingDeg: number };
  chatTopics: ChatTopic[];
  chat: ChatScript;
  credits: { label: string; text: string; href?: string }[];
}

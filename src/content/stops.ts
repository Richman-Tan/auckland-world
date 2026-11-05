/**
 * The five stops. Beacon anchors are final. Briefing pages live in projects.ts, work.ts,
 * study.ts, contact.ts and offclock.ts.
 */
import { contactPages } from './contact';
import { offclockPages } from './offclock';
import { projectPages } from './projects';
import { studyPages } from './study';
import type { Stop } from './types';
import { workPages } from './work';


export const stops: Stop[] = [
  {
    id: 'projects',
    hotkey: 1,
    label: 'PROJECTS',
    place: 'Sky Tower',
    pitch: 'Apps, platforms and research I have built',
    // Anchor is the pod top (226 m); +108 m clears the mast and its aircraft light (about 331 m), so the
    // icon and light column sit above the antenna instead of on it.
    beacon: { at: { kind: 'landmark', id: 'skyTower' }, height: { ref: 'anchor', metres: 108 }, color: 'pohutukawa', icon: 'code', triggerRadius: 220, orbitRadius: 240 },
    briefing: projectPages,
    experiences: [{ kind: 'briefing' }, { kind: 'room', roomId: 'skydeck', status: 'live', label: 'Sky Deck' }],
  },
  {
    id: 'work',
    hotkey: 2,
    label: 'WORK',
    place: 'Ponsonby Road',
    pitch: 'Sandfield, and my earlier internship',
    // 130 Ponsonby Rd (Sandfield's public address, confirmed by the user), geocoded from OSM addr:* tags.
    beacon: { at: { kind: 'geo', lat: -36.856975, lon: 174.747333 }, height: { ref: 'ground', metres: 30 }, color: 'kowhai', icon: 'briefcase', triggerRadius: 180, orbitRadius: 200 },
    briefing: workPages,
    experiences: [{ kind: 'briefing' }, { kind: 'room', roomId: 'office', status: 'planned' }],
  },
  {
    id: 'study',
    hotkey: 3,
    label: 'STUDY',
    place: 'University of Auckland',
    pitch: 'Software Engineering at the University of Auckland',
    // Faculty of Engineering, 20 Symonds St.
    beacon: { at: { kind: 'geo', lat: -36.8523, lon: 174.7698 }, height: { ref: 'ground', metres: 30 }, color: 'harbour', icon: 'cap', triggerRadius: 180, orbitRadius: 200 },
    briefing: studyPages,
    experiences: [{ kind: 'briefing' }],
  },
  {
    id: 'talk',
    hotkey: 4,
    label: 'TALK TO ME',
    place: 'Auckland Harbour Bridge',
    pitch: 'Chat with me, or grab my email and links',
    beacon: { at: { kind: 'landmark', id: 'harbourBridgeTop' }, height: { ref: 'anchor', metres: 6 }, color: 'cream', icon: 'chat', triggerRadius: 200, orbitRadius: 220 },
    briefing: contactPages,
    experiences: [{ kind: 'briefing' }, { kind: 'chat', topicsId: 'main', backend: 'remote', status: 'live' }],
  },
  {
    id: 'offclock',
    hotkey: 5,
    label: 'OFF THE CLOCK',
    place: 'Maungawhau / Mt Eden',
    pitch: 'Snowboarding, sport and the beach',
    // Maungawhau summit (OSM natural=peak).
    beacon: { at: { kind: 'geo', lat: -36.87805, lon: 174.76452 }, height: { ref: 'ground', metres: 10 }, color: 'volcanic', icon: 'peak', triggerRadius: 220, orbitRadius: 240 },
    briefing: offclockPages,
    experiences: [{ kind: 'briefing' }],
  },
];

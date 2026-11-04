/**
 * The five stops. Beacon anchors are final; briefing pages here are placeholders that M4
 * replaces with the real, checked content (projects.ts, work.ts, study.ts, contact.ts, offclock.ts).
 */
import type { Stop } from './types';

const placeholder = (title: string) => [
  { id: 'placeholder', title, blocks: [{ type: 'text' as const, text: 'Content coming soon.' }] },
];

export const stops: Stop[] = [
  {
    id: 'projects',
    hotkey: 1,
    label: 'PROJECTS',
    place: 'Sky Tower',
    pitch: 'Things I have built',
    beacon: { at: { kind: 'landmark', id: 'skyTower' }, height: { ref: 'anchor', metres: 4 }, color: 'pohutukawa', icon: 'code', triggerRadius: 220, orbitRadius: 240 },
    briefing: placeholder('Projects'),
    experiences: [{ kind: 'briefing' }, { kind: 'room', roomId: 'skydeck', status: 'planned' }],
  },
  {
    id: 'work',
    hotkey: 2,
    label: 'WORK',
    place: 'Ponsonby Road',
    pitch: 'Where I work',
    // 130 Ponsonby Rd (Sandfield's public address); M1 refines from OSM addr:* tags. User to confirm.
    beacon: { at: { kind: 'geo', lat: -36.8561, lon: 174.7461 }, height: { ref: 'ground', metres: 30 }, color: 'kowhai', icon: 'briefcase', triggerRadius: 180, orbitRadius: 200 },
    briefing: placeholder('Work'),
    experiences: [{ kind: 'briefing' }, { kind: 'room', roomId: 'office', status: 'planned' }],
  },
  {
    id: 'study',
    hotkey: 3,
    label: 'STUDY',
    place: 'University of Auckland',
    pitch: 'Software engineering at UoA',
    // Faculty of Engineering, 20 Symonds St.
    beacon: { at: { kind: 'geo', lat: -36.8523, lon: 174.7698 }, height: { ref: 'ground', metres: 30 }, color: 'harbour', icon: 'cap', triggerRadius: 180, orbitRadius: 200 },
    briefing: placeholder('Study'),
    experiences: [{ kind: 'briefing' }],
  },
  {
    id: 'talk',
    hotkey: 4,
    label: 'TALK TO ME',
    place: 'Auckland Harbour Bridge',
    pitch: 'Say hello',
    beacon: { at: { kind: 'landmark', id: 'harbourBridgeTop' }, height: { ref: 'anchor', metres: 6 }, color: 'cream', icon: 'chat', triggerRadius: 200, orbitRadius: 220 },
    briefing: placeholder('Talk to me'),
    experiences: [{ kind: 'briefing' }, { kind: 'chat', topicsId: 'main', backend: 'scripted', status: 'planned' }],
  },
  {
    id: 'offclock',
    hotkey: 5,
    label: 'OFF THE CLOCK',
    place: 'Maungawhau / Mt Eden',
    pitch: 'When I am not coding',
    beacon: { at: { kind: 'geo', lat: -36.8767, lon: 174.7643 }, height: { ref: 'ground', metres: 10 }, color: 'volcanic', icon: 'peak', triggerRadius: 220, orbitRadius: 240 },
    briefing: placeholder('Off the clock'),
    experiences: [{ kind: 'briefing' }],
  },
];

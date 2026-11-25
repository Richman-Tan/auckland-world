/** Shared, checked links. Only https: and mailto: are allowed (enforced in tests/content.test.ts). */
import type { Link } from './types';

export const EMAIL = 'richmantan0@gmail.com';

/**
 * The site's public address, no trailing slash. The canonical links in index.html and
 * page/index.html, public/sitemap.xml, public/robots.txt and the structured data must all agree
 * with it (tests/page.test.ts checks that they do).
 */
export const SITE_URL = 'https://richmantan.dev';

/**
 * The public copy of the CV, served from public/. It is not the CV sent to employers: it is rebuilt
 * from the same source by `npm run cv:web`, without the phone number, the status row or the
 * Sandfield detail (scripts/lib/cvWeb.ts). Never copy a CV PDF into public/ by hand.
 */
export const CV_FILE = 'Richman-Tan-CV.pdf';
export const CV_URL = `${SITE_URL}/${CV_FILE}`;

export const GITHUB = 'https://github.com/Richman-Tan';
export const LINKEDIN = 'https://www.linkedin.com/in/richman-tan/';

export const contactLinks: Link[] = [
  { label: 'Email', href: `mailto:${EMAIL}`, kind: 'email', primary: true },
  { label: 'CV', href: CV_URL, kind: 'cv' },
  { label: 'GitHub', href: GITHUB, kind: 'social' },
  { label: 'LinkedIn', href: LINKEDIN, kind: 'social' },
];

/**
 * Repository links, each checked as public with
 * curl -s -o /dev/null -w '%{http_code}' <url> on 2026-11-05 (200 = public).
 * Dropped: UOA-CS732-S1-2026/group-project-chuds (404, private) and the WIE Academy repo
 * (private until after exams, so it has no links at all).
 */
export const DEMENTIAGUIDE_REPO = 'https://github.com/Richman-Tan/DementiaGuideAI';
export const VPS_REPO = 'https://github.com/UoaWDCC/VPS';
export const VPS_LIVE = 'https://wdcc-vps.fly.dev';
export const SESA_SITE = 'https://sesa.org.nz/';

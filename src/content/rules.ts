/**
 * What the site never publishes. Kept in one place so the content tests and the public CV's guard
 * (scripts/lib/cvWeb.ts) hold to the same list.
 */

/**
 * Sandfield is described at capability level only: no internal project, product or client names,
 * and no figures about its systems. These are the names and figures that exist elsewhere (the CV
 * sent to employers, private notes) and must not reach the site.
 */
export const SANDFIELD_DENY: readonly string[] = [
  'CallerChecker',
  'Caller Verification',
  'SecurityDashboard',
  'security vulnerability dashboard',
  'SAL.',
  'Mainstreet',
  '200+ engineers',
  '1,000+ security alerts',
  '100+ repositories',
  '10+ REST APIs',
];

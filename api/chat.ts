/**
 * /api/chat on Vercel's Node.js runtime. POST answers a visitor's typed question as Richman's avatar,
 * using Claude Haiku and only the site's own content; GET reports whether the AI is switched on.
 * The key comes from the ANTHROPIC_API_KEY environment variable; without it the endpoint reports
 * itself disabled and the chat keeps its scripted answers.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createChatHandler, isSiteOrigin } from '../src/chat/server.js';
import { SITE_LINKS, SYSTEM_PROMPT } from './_site.js';

const apiKey = process.env.ANTHROPIC_API_KEY;

const handle = createChatHandler({
  client: apiKey ? new Anthropic({ apiKey }) : null,
  system: SYSTEM_PROMPT,
  isAllowedOrigin: isSiteOrigin,
  allowedLinks: new Set(SITE_LINKS),
});

export const GET = handle;
export const POST = handle;

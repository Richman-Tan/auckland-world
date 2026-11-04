/**
 * POST /api/chat: answers a visitor's typed question as Richman's avatar, using Claude Haiku and
 * only the site's own content. GET /api/chat reports whether the AI is switched on.
 * The key comes from the ANTHROPIC_API_KEY environment variable on Vercel; without it the endpoint
 * reports itself disabled and the chat keeps its scripted answers.
 */
import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt, siteLinks } from '../src/chat/prompt';
import { createChatHandler, isSiteOrigin } from '../src/chat/server';
import { content } from '../src/content';

export const config = { runtime: 'edge' };

const apiKey = process.env.ANTHROPIC_API_KEY;

export default createChatHandler({
  client: apiKey ? new Anthropic({ apiKey }) : null,
  system: buildSystemPrompt(content),
  isAllowedOrigin: isSiteOrigin,
  allowedLinks: siteLinks(content),
});

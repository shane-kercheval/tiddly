/**
 * Ready-to-paste prompts handed to a user's AI agent from the UI's
 * AgentPromptButton CTAs. Composed from shared guidance bodies so the same
 * instruction text isn't duplicated (and can't drift) across the surfaces that
 * use it: the landing + features pages (evaluation), the AI-integration setup
 * widget (MCP setup), and the first-run empty state (app-usage orientation).
 *
 * Each prompt points at one of the hosted agent artifacts
 * (https://tiddly.me/llms*.txt); keep these in step with that family.
 */

const EVALUATION_INTRO =
  "You're helping me evaluate Tiddly (https://tiddly.me) — a tool for managing bookmarks, notes, and prompt templates and connecting them to AI tools via MCP."

// Evaluation path: read the hub, then give an honest, concise assessment.
const EVALUATION_GUIDANCE = `Start by reading https://tiddly.me/llms.txt — it's written for AI agents and is enough on its own for an overview. It links to deeper pages (app usage, AI integration, the CLI, pricing, and the FAQ); don't read them all up front — follow a link only when our conversation calls for that depth.

Then give me an honest assessment: what Tiddly actually does, who it's a good fit for, who it's not for, how it compares to tools I might already use for this, and what trying it would involve. Ask me about my workflow and current tools if that would sharpen the recommendation. Keep it concise and skimmable — not an exhaustive writeup.`

const MCP_SETUP_INTRO =
  'Help me connect Tiddly (https://tiddly.me) to my AI tools so my bookmarks, notes, and prompts are available to you via MCP.'

// MCP setup path: read the integration guide, pick OAuth vs CLI per its
// guidance, then walk through setup with per-step confirmation (and explicit
// permission before installing anything).
const MCP_SETUP_GUIDANCE = `Read https://tiddly.me/llms-integration.txt — it explains the two ways to connect (OAuth paste-the-URL for apps with connector support, or Tiddly's CLI for token-based setups) and which tools support which.

Once you've read it — and before configuring anything — ask me:
- Which AI tool(s) to set up.
- Whether to connect my bookmarks & notes, my prompts, or both — these are two separate MCP servers, so confirm which I want.

Recommend the connection path the integration guide describes for my tool (OAuth where supported; the CLI otherwise), and mention anything the guide flags about my tool — how it surfaces prompts, or any current caveats — so I can decide what to enable.

Then walk me through the setup. For the CLI path: read https://tiddly.me/llms-cli-instructions.txt first (or run \`tiddly ai-instructions\`), ask my permission before installing the CLI, and before running each command tell me what it will do and any implications (tokens it creates, config files it changes), running it only after I confirm. For the OAuth path: give me the steps for my app and let me do the sign-in myself.`

/** Landing-page evaluation CTA — points the agent at the llms.txt hub. */
export const EVALUATION_PROMPT = `${EVALUATION_INTRO}

${EVALUATION_GUIDANCE}`

/** AI-integration setup widget CTA — arms the agent to drive the CLI setup. */
export const MCP_SETUP_PROMPT = `${MCP_SETUP_INTRO}

${MCP_SETUP_GUIDANCE}`

/**
 * First-run empty-state CTA — orients a brand-new user. Points at the app-usage
 * guide and asks the agent for a brief, high-value tour (skipping the obvious)
 * rather than acting on the account, so it works before any MCP connection.
 */
export const ORIENTATION_PROMPT = `I just started using Tiddly (https://tiddly.me) — a place to keep my bookmarks, notes, and prompt templates and connect them to my AI tools. Help me get oriented.

Read https://tiddly.me/llms-app-usage.txt for how Tiddly works. Then give me a brief, high-value orientation for getting started — skip the obvious (what a bookmark or note is) and focus on what's worth knowing: how filters and collections organize content, the Chrome extension for saving bookmarks as I browse, and where to connect my AI tools so they can use my content. Keep it short, then answer any follow-up questions using what you read.`

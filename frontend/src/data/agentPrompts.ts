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

// MCP setup path: read the CLI guide, confirm scope, then configure with
// per-command confirmation (and explicit permission before installing).
const MCP_SETUP_GUIDANCE = `Read https://tiddly.me/llms-cli-instructions.txt — the guide for Tiddly's CLI (you can also get it by running \`tiddly ai-instructions\`). The CLI is how you connect AI tools to Tiddly: it configures Tiddly's hosted (remote) MCP servers into your AI tool's config and manages the access tokens.

Once you've read the guide — and before configuring anything — ask me:
- Which AI tool(s) to set up — Claude Code, Claude Desktop, Codex, or Antigravity.
- Whether to connect my bookmarks & notes, my prompts, or both — these are two separate MCP servers, so confirm which I want.

If I choose Codex (or Antigravity), explain — as the instructions describe — that it can't consume MCP prompts the way Claude Code and Claude Desktop can, so Tiddly sets prompts up as skills there instead, and let me decide what to enable.

Then walk me through the setup: if the Tiddly CLI isn't already installed, ask my permission before installing it; then help me log in and configure the servers I chose. Before running each command, tell me what it will do and any implications (tokens it creates, config files it changes), and run it only after I confirm.`

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

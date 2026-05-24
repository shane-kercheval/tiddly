---
route: /docs/features/ai
title: Docs - AI Features
description: AI-powered features on the Pro plan — tag suggestions, metadata generation, relationship discovery, argument suggestions, and configuration including bring-your-own-key and model selection.
---

# AI Features

Tiddly includes AI-powered features that help you organize, tag, and discover connections across your bookmarks, notes, and prompts. All AI features are available on the Pro plan and can optionally use your own API keys for additional flexibility.

## Tag Suggestions

When you open the tag input on any item, AI automatically suggests relevant tags based on the item's title, URL, description, and content. Suggestions appear as muted chips to the right of your existing tags — click one to add it.

- **How it works** — the server sends your existing tag vocabulary and recent tagging patterns to the AI model, which suggests tags that are consistent with your style
- **Where** — tag input on bookmarks, notes, and prompts (list and detail views)

## Metadata Generation

Generate titles and descriptions from your content using the sparkle icon next to each field. The AI analyzes your content and produces concise, descriptive text.

- **Title generation** — requires a description or content to generate from. If the description is also empty, both title and description are generated together.
- **Description generation** — requires content to generate from. The existing title is used as context for better results.
- **Where** — sparkle icon on title and description fields in bookmarks, notes, and prompts

## Relationship Discovery

Find related content across your library. When you open the linked content input on any item, AI searches for items with similar topics and suggests connections.

- **How it works** — the server searches by title relevance and shared tags, then asks the AI to identify which candidates are genuinely related
- **Cross-type** — discovers relationships between bookmarks, notes, and prompts
- **Where** — linked content input in the detail view of any item

## Argument Suggestions

For prompt templates, AI can generate argument names and descriptions based on the template content and its `{{ placeholders }}`.

- **Generate all** — scans the template for placeholders and generates descriptions for each one
- **Individual suggestions** — suggest a name from a description, or a description from a name, for a single argument
- **Where** — sparkle icons in the prompt editor's arguments section

## Configuration

AI features work out of the box on the Pro plan with no configuration needed. For more control, you can provide your own API keys and choose specific models per use case.

- **Bring Your Own Key (BYOK)** — provide your own API key from Google, OpenAI, or Anthropic. Your key is stored only in your browser's local storage and is never saved on our servers.
- **Model selection** — choose from a curated list of models when using your own key. Each use case can use a different model and provider.
- **Rate limits** — AI calls have separate rate limits from regular API calls. BYOK users get higher limits. See [pricing](/pricing) for details.

Configure AI settings in [Settings → AI Configuration](/app/settings/ai).

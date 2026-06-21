/**
 * Hand-curated metadata for `/app/settings/*` pages, used by the command
 * palette to make settings discoverable by both label and body keywords.
 *
 * The pattern mirrors `docsRoutes.tsx`: each entry has a `searchText` field
 * (keyword soup, not prose) so users searching for a concept reach the right
 * settings page even when the label doesn't contain the term. The motivating
 * example: typing `mcp` should surface `Settings: AI Integration` (where MCP
 * is configured) — but the literal label doesn't contain that term.
 *
 * MAINTENANCE: when you add a `/app/settings/*` page or substantially change
 * an existing one, update the corresponding entry here. `AGENTS.md`'s
 * "Files to Keep in Sync" section calls this out as a tracked obligation.
 *
 * Order in this array is the display order in the palette under the Settings
 * group (which sits above Docs and Tips).
 */
import type { ReactNode } from 'react'
import {
  AdjustmentsIcon,
  TagIcon,
  KeyIcon,
  SparklesIcon,
  HistoryIcon,
  GlobeIcon,
  HelpIcon,
} from '../components/icons'

export interface SettingsRoute {
  /** Path that matches an entry in `routePrefetch.ts`. */
  path: string
  /** Display label in the palette. Prefixed `Settings:` consistently. */
  label: string
  /** Icon — varies per settings page (each is a distinct destination). */
  icon: ReactNode
  /** Keyword-rich summary matched alongside `label` (case-insensitive substring). */
  searchText: string
}

export const SETTINGS_ROUTES: SettingsRoute[] = [
  {
    path: '/app/settings/general',
    label: 'Settings: General',
    icon: <AdjustmentsIcon className="h-4 w-4" />,
    searchText:
      'general account profile email user logged in plan tier free pro beta '
      + 'subscription upgrade layout full width fullwidth display preferences ui '
      + 'theme keyboard shortcuts limits usage quota item limits bookmarks notes '
      + 'prompts content length characters version history retention days personal '
      + 'access tokens pat rate limits read write per minute per day requests',
  },
  {
    path: '/app/settings/tags',
    label: 'Settings: Tags',
    icon: <TagIcon className="h-4 w-4" />,
    searchText:
      'tags tag management rename delete merge inline edit usage count sort '
      + 'alphabetical name ascending descending active inactive unused archived '
      + 'deleted filter list global namespace shared across content bookmarks '
      + 'notes prompts',
  },
  {
    path: '/app/settings/tokens',
    label: 'Settings: Personal Access Tokens',
    icon: <KeyIcon className="h-4 w-4" />,
    searchText:
      'personal access tokens pat api access bearer authorization bm_ create '
      + 'token delete revoke rename security secret password environment variable '
      + 'secret manager version control programmatic api curl scope expiration '
      + 'expires days ci automation headless',
  },
  {
    path: '/app/settings/ai',
    label: 'Settings: AI Configuration',
    icon: <SparklesIcon className="h-4 w-4" />,
    searchText:
      'ai configuration features tag suggestions metadata generation title '
      + 'description relationship discovery linked content argument suggestions '
      + 'sparkle byok bring your own key api key google openai anthropic gemini '
      + 'claude model selection use case suggestions transform auto-complete chat '
      + 'rate limits quota remaining pro plan upgrade billing api keys per use case',
  },
  {
    path: '/app/settings/ai-integration',
    label: 'Settings: AI Integration',
    icon: <SparklesIcon className="h-4 w-4" />,
    searchText:
      'ai integration mcp model context protocol claude desktop claude code '
      + 'codex antigravity agy gemini google setup configure cli command tokens scope user '
      + 'directory tools servers content prompts skills agent connect ai '
      + 'assistant install remove status detect',
  },
  {
    path: '/app/settings/history',
    label: 'Settings: Version History',
    icon: <HistoryIcon className="h-4 w-4" />,
    searchText:
      'version history changes audit trail account wide filter type bookmark '
      + 'note prompt action create update delete restore undelete archive '
      + 'unarchive source web api mcp iphone date range last 7 days 30 days '
      + 'custom range diff version v1 v2 timeline pagination all items recent '
      + 'changes',
  },
  {
    path: '/app/settings/shared',
    label: 'Settings: Shared Content',
    icon: <GlobeIcon className="h-4 w-4" />,
    searchText:
      'shared content public links manage unshare stop sharing what have i shared '
      + 'publicly shared items audit bookmarks notes prompts public url share token '
      + 'revoke regenerate visibility privacy who can see',
  },
  {
    path: '/app/settings/faq',
    label: 'Settings: FAQ',
    icon: <HelpIcon className="h-4 w-4" />,
    searchText:
      'faq frequently asked questions help support troubleshooting how does '
      + 'clicking content list bookmarks notes prompts filter collection sidebar '
      + 'tags rename delete inactive archive trash difference version history '
      + 'restore retention plan free pro relationships content limit storage '
      + 'search operators ai suggestions byok personal access tokens pat secure '
      + 'mcp integration claude codex desktop skills prompt templates variables',
  },
]

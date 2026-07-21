/**
 * Reusable AI Integration setup widget driving the CLI-based setup flow.
 * Used by both Settings → AI Integration and Docs → AI Integration.
 */
import { useState, useEffect, useRef } from 'react'
import type { ReactNode, KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../services/api'
import { useAuthStatus } from '../hooks/useAuthStatus'
import { AgentPromptButton } from './AgentPromptButton'
import { MCP_SETUP_PROMPT } from '../data/agentPrompts'
import { DocsMarkdown } from './markdown/DocsMarkdown'
import { getProseDoc } from '../content/proseDocs'
import type { TagCount, TagListResponse } from '../types'


// Selector types
type ServerType = 'content' | 'prompts'
type CliToolType = 'claude-desktop' | 'claude-code' | 'codex' | 'antigravity'
type CliActionType = 'configure' | 'remove'
type ScopeType = 'user' | 'directory'
type TagMatchType = 'all' | 'any'

// All MCP-configurable tools, in display order.
const ALL_CLI_TOOLS: CliToolType[] = ['claude-desktop', 'claude-code', 'codex', 'antigravity']
// Tools with a Tiddly skills integration. Antigravity is excluded — it has no
// skills support (its plugin model differs from our SKILL.md export), so it
// must never appear in `tiddly skills configure` commands or skills paths.
const SKILLS_CLI_TOOLS: CliToolType[] = ['claude-desktop', 'claude-code', 'codex']
// Tools that only support user scope (no --scope directory).
const USER_SCOPE_ONLY_TOOLS: CliToolType[] = ['claude-desktop', 'antigravity']

interface PillOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
  disabledLabel?: string
}

/**
 * Info tooltip that shows on hover.
 */
function InfoTooltip({ text }: { text: string }): ReactNode {
  return (
    <span className="relative group inline-flex">
      <svg className="w-3.5 h-3.5 text-gray-300 hover:text-gray-500 cursor-help transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M12 18h.01" />
        <circle cx="12" cy="12" r="10" strokeWidth={2} />
      </svg>
      <span className="invisible group-hover:visible absolute left-0 bottom-full mb-2 w-64 rounded-lg bg-gray-800 text-white text-xs px-3 py-2 shadow-lg z-20 leading-relaxed">
        {text}
        <span className="absolute left-3 top-full border-4 border-transparent border-t-gray-800" />
      </span>
    </span>
  )
}

/**
 * Section divider with label and optional tooltip.
 */
function SectionDivider({ label, tooltip }: { label: string; tooltip?: string }): ReactNode {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      <div className="flex-1 border-t border-gray-200" />
    </div>
  )
}

/**
 * Multi-select pill toggle group. Clicking a pill toggles it on/off.
 */
function PillToggleGroup<T extends string>({
  options,
  selected,
  onChange,
}: {
  options: PillOption<T>[]
  selected: Set<T>
  onChange: (selected: Set<T>) => void
}): ReactNode {
  const toggle = (value: T): void => {
    const next = new Set(selected)
    if (next.has(value)) {
      next.delete(value)
    } else {
      next.add(value)
    }
    onChange(next)
  }

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const isSelected = selected.has(opt.value)
        const isDisabled = opt.disabled
        return (
          <button
            key={opt.value}
            type="button"
            disabled={isDisabled}
            onClick={() => !isDisabled && toggle(opt.value)}
            className={`
              px-3 py-1 text-xs font-medium rounded-full border transition-all
              ${
                isDisabled
                  ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
                  : isSelected
                  ? 'border-[#f09040] bg-[#f09040] text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-[#f09040] hover:text-[#d97b3d]'
              }
            `}
          >
            {opt.label}
            {isDisabled && opt.disabledLabel && (
              <span className="ml-1.5 text-xs opacity-60">{opt.disabledLabel}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Single-select pill group. Same visual as PillToggleGroup but mutually exclusive.
 */
function PillSelectGroup<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: PillOption<T>[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
}): ReactNode {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const isSelected = value === opt.value
        const isDisabled = disabled || opt.disabled
        return (
          <button
            key={opt.value}
            type="button"
            disabled={isDisabled}
            onClick={() => !isDisabled && onChange(opt.value)}
            className={`
              px-3 py-1 text-xs font-medium rounded-full border transition-all
              ${
                isDisabled
                  ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
                  : isSelected
                  ? 'border-[#f09040] bg-[#f09040] text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-[#f09040] hover:text-[#d97b3d]'
              }
            `}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Numbered step card for setup instructions.
 */
function generateCLICommands(
  action: CliActionType,
  selectedServers: Set<ServerType>,
  installSkills: boolean,
  selectedTools: Set<CliToolType>,
  scope: ScopeType,
  skillsTags: string[],
  skillsTagMatch: TagMatchType,
  deleteTokens: boolean,
): string {
  if (action === 'remove') {
    return generateRemoveCommands(selectedServers, installSkills, selectedTools, deleteTokens, scope)
  }

  const needsCd = scope === 'directory'
  const parts: string[] = []

  if (selectedServers.size > 0 && selectedTools.size > 0) {
    let cmd = 'tiddly mcp configure'

    const mcpTools = ALL_CLI_TOOLS.filter((t) => selectedTools.has(t))
    if (mcpTools.length < ALL_CLI_TOOLS.length) {
      cmd += ' ' + mcpTools.join(' ')
    }

    if (selectedServers.size === 1) {
      cmd += ` --servers ${[...selectedServers][0]}`
    }

    if (scope !== 'user') {
      cmd += ` --scope ${scope}`
    }

    parts.push(cmd)
  }

  const skillsTools = SKILLS_CLI_TOOLS.filter((t) => selectedTools.has(t))
  if (installSkills && skillsTools.length > 0) {
    let cmd = 'tiddly skills configure'

    if (skillsTools.length < SKILLS_CLI_TOOLS.length) {
      cmd += ' ' + skillsTools.join(' ')
    }

    if (scope !== 'user') {
      cmd += ` --scope ${scope}`
    }

    if (skillsTags.length === 0) {
      cmd += ' --tags ""'
    } else if (skillsTags.length !== 1 || skillsTags[0] !== 'skill') {
      cmd += ` --tags ${skillsTags.join(',')}`
    }

    if (skillsTagMatch === 'any') {
      cmd += ' --tag-match any'
    }

    parts.push(cmd)
  }

  if (parts.length === 0) return ''

  if (needsCd) {
    parts.unshift('cd /path/to/your/project')
  }

  if (parts.length === 1) return parts[0]
  return parts.join(needsCd ? '\n' : ' && \\\n')
}

/**
 * Generate CLI remove command(s) based on selected options.
 */
function generateRemoveCommands(
  selectedServers: Set<ServerType>,
  removeSkills: boolean,
  selectedTools: Set<CliToolType>,
  deleteTokens: boolean,
  scope: ScopeType,
): string {
  const needsCd = scope === 'directory'
  const parts: string[] = []

  if (selectedServers.size > 0 && selectedTools.size > 0) {
    const mcpTools = ALL_CLI_TOOLS.filter((t) => selectedTools.has(t))
    for (const tool of mcpTools) {
      let cmd = `tiddly mcp remove ${tool}`
      if (selectedServers.size === 1) {
        cmd += ` --servers ${[...selectedServers][0]}`
      }
      if (scope !== 'user') {
        cmd += ` --scope ${scope}`
      }
      if (deleteTokens) {
        cmd += ' --delete-tokens'
      }
      parts.push(cmd)
    }
  }

  if (removeSkills && selectedTools.size > 0) {
    const skillsTools = SKILLS_CLI_TOOLS.filter((t) => selectedTools.has(t))
    for (const tool of skillsTools) {
      if (tool === 'claude-desktop') {
        parts.push('# Claude Desktop: manually remove skills from Settings > Capabilities')
      } else if (scope === 'user') {
        const dir = tool === 'claude-code' ? '~/.claude/skills/' : '~/.agents/skills/'
        parts.push(`# WARNING: Removes ALL skills including non-Tiddly ones`)
        parts.push(`# rm -rf ${dir}`)
        // Also clean deprecated Codex path if applicable
        if (tool === 'codex') {
          parts.push(`# rm -rf ~/.codex/skills/`)
        }
      } else {
        const dir = tool === 'claude-code' ? '.claude/skills/' : '.agents/skills/'
        parts.push(`# WARNING: Removes ALL directory-level skills including non-Tiddly ones`)
        parts.push(`# rm -rf ${dir}`)
      }
    }
  }

  if (parts.length === 0) return ''

  if (needsCd) {
    parts.unshift('cd /path/to/your/project')
  }

  return parts.join('\n')
}

const CLI_TOOL_LABELS: Record<CliToolType, string> = {
  'claude-desktop': 'Claude Desktop',
  'claude-code': 'Claude Code',
  'codex': 'Codex',
  'antigravity': 'Antigravity',
}

interface AffectedFile {
  path: string
  description: string
}

/**
 * Returns the list of files/directories that will be created or modified
 * based on the selected tools, scope, and what's being configured.
 */
function getAffectedFiles(
  selectedTools: Set<CliToolType>,
  scope: ScopeType,
  hasMcpServers: boolean,
  installSkills: boolean,
  action: CliActionType,
): AffectedFile[] {
  const files: AffectedFile[] = []

  if (hasMcpServers) {
    if (selectedTools.has('claude-code')) {
      files.push(scope === 'user'
        ? { path: '~/.claude.json', description: 'Claude Code MCP (--scope user)' }
        : { path: '~/.claude.json', description: 'Claude Code MCP (--scope directory, under project key)' })
    }
    if (selectedTools.has('codex')) {
      files.push(scope === 'user'
        ? { path: '~/.codex/config.toml', description: 'Codex MCP (user-level config)' }
        : { path: '.codex/config.toml', description: 'Codex MCP (project-scoped config)' })
    }
    if (selectedTools.has('claude-desktop')) {
      files.push({ path: '~/Library/Application Support/Claude/claude_desktop_config.json', description: 'Claude Desktop MCP (macOS)' })
    }
    if (selectedTools.has('antigravity')) {
      files.push({ path: '~/.gemini/config/mcp_config.json', description: 'Antigravity MCP (shared by the agy CLI and the IDE)' })
    }
  }

  if (installSkills) {
    if (selectedTools.has('claude-code')) {
      files.push(scope === 'user'
        ? { path: '~/.claude/skills/', description: 'Claude Code skills (personal)' }
        : { path: '.claude/skills/', description: 'Claude Code skills (project directory)' })
    }
    if (selectedTools.has('codex')) {
      if (scope === 'user') {
        files.push({ path: '~/.agents/skills/', description: 'Codex skills (USER scope)' })
        if (action === 'remove') {
          files.push({ path: '~/.codex/skills/', description: 'Codex skills (deprecated path)' })
        }
      } else {
        files.push({ path: '.agents/skills/', description: 'Codex skills (REPO scope)' })
      }
    }
  }

  return files
}

/**
 * Returns the user-scope-only tools (Claude Desktop, Antigravity) selected
 * alongside directory scope — an invalid combination since those tools only
 * support user scope. Empty when there's no conflict.
 */
function userScopeOnlyDirectoryConflicts(selectedTools: Set<CliToolType>, scope: ScopeType): CliToolType[] {
  if (scope !== 'directory') return []
  return USER_SCOPE_ONLY_TOOLS.filter((t) => selectedTools.has(t))
}

/**
 * Returns the selected tools that have no Tiddly skills integration (e.g.
 * Antigravity) when skills are enabled — an invalid combination, since skills
 * cannot be installed for those tools. Empty when skills are off or every
 * selected tool supports skills. Preserves ALL_CLI_TOOLS display order.
 */
function skillsUnsupportedConflicts(selectedTools: Set<CliToolType>, installSkills: boolean): CliToolType[] {
  if (!installSkills) return []
  return ALL_CLI_TOOLS.filter((t) => selectedTools.has(t) && !SKILLS_CLI_TOOLS.includes(t))
}

/**
 * CLI-first setup section with toggle grid and live command generation.
 */
function CLISetupSection(): ReactNode {
  const { isAuthenticated } = useAuthStatus()

  // Action: configure or remove
  const [cliAction, setCliAction] = useState<CliActionType>('configure')
  const isRemove = cliAction === 'remove'

  // What to configure/remove
  const [selectedServers, setSelectedServers] = useState<Set<ServerType>>(new Set(['content', 'prompts']))
  const [installSkills, setInstallSkills] = useState(false)
  const [deleteTokens, setDeleteTokens] = useState(false)

  // Where to configure/remove
  const [selectedTools, setSelectedTools] = useState<Set<CliToolType>>(new Set(['claude-code', 'codex']))

  // Scope (single selector for both MCP and skills)
  const [scope, setScope] = useState<ScopeType>('user')
  const [removeScope, setRemoveScope] = useState<ScopeType>('user')

  // Skills tag filter
  const [promptTags, setPromptTags] = useState<TagCount[]>([])
  const [skillsTags, setSkillsTags] = useState<string[]>(['skill'])
  const [skillsTagMatch, setSkillsTagMatch] = useState<TagMatchType>('all')

  // Command copy state
  const [copiedCommand, setCopiedCommand] = useState(false)
  const [copiedInstall, setCopiedInstall] = useState(false)
  const [copiedLogin, setCopiedLogin] = useState(false)

  // Fetch prompt tags on mount (only when authenticated to avoid 401 redirect)
  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    const fetchPromptTags = async (): Promise<void> => {
      try {
        const response = await api.get<TagListResponse>('/tags/?content_types=prompt')
        if (!cancelled) {
          const tags = response.data.tags
          setPromptTags(tags)
          const defaultTags = getDefaultSkillTags(tags)
          if (defaultTags.length > 0) {
            setSkillsTags(defaultTags)
          }
        }
      } catch {
        // Silent fail
      }
    }
    fetchPromptTags()
    return () => { cancelled = true }
  }, [isAuthenticated])

  const hasMcpServers = selectedServers.size > 0
  const hasSelections = (hasMcpServers || installSkills) && selectedTools.size > 0
  const activeScope = isRemove ? removeScope : scope
  const scopeConflictTools = userScopeOnlyDirectoryConflicts(selectedTools, activeScope)
  const scopeConflictError = scopeConflictTools.length > 0
  const skillsConflictTools = skillsUnsupportedConflicts(selectedTools, installSkills)
  const skillsConflictError = skillsConflictTools.length > 0
  const command = (scopeConflictError || skillsConflictError) ? '' : generateCLICommands(cliAction, selectedServers, installSkills, selectedTools, activeScope, skillsTags, skillsTagMatch, deleteTokens)
  const hasAnything = hasSelections && command !== ''
  const affectedFiles = hasAnything ? getAffectedFiles(selectedTools, activeScope, hasMcpServers, installSkills, cliAction) : []

  const handleCopyCommand = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(command)
      setCopiedCommand(true)
      setTimeout(() => setCopiedCommand(false), 2000)
    } catch { /* Silent fail */ }
  }

  const installCommand = 'curl -fsSL https://raw.githubusercontent.com/shane-kercheval/tiddly/main/cli/install.sh | sh'
  const handleCopyInstall = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(installCommand)
      setCopiedInstall(true)
      setTimeout(() => setCopiedInstall(false), 2000)
    } catch { /* Silent fail */ }
  }

  const loginCommand = 'tiddly login'
  const handleCopyLogin = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(loginCommand)
      setCopiedLogin(true)
      setTimeout(() => setCopiedLogin(false), 2000)
    } catch { /* Silent fail */ }
  }

  // Tool options
  const toolOptions: PillOption<CliToolType>[] = [
    { value: 'claude-desktop', label: 'Claude Desktop' },
    { value: 'claude-code', label: 'Claude Code' },
    { value: 'codex', label: 'Codex' },
    { value: 'antigravity', label: 'Antigravity' },
  ]

  // Server options
  const serverOptions: PillOption<ServerType>[] = [
    { value: 'content', label: 'Bookmarks & Notes' },
    { value: 'prompts', label: 'Prompts' },
  ]

  // Scope options
  const scopeOptions: PillOption<ScopeType>[] = [
    { value: 'user', label: 'User' },
    { value: 'directory', label: 'Directory' },
  ]

  // Tag match options
  const tagMatchOptions: PillOption<TagMatchType>[] = [
    { value: 'all', label: 'All tags' },
    { value: 'any', label: 'Any tag' },
  ]

  // Action options
  const actionOptions: PillOption<CliActionType>[] = [
    { value: 'configure', label: 'Configure' },
    { value: 'remove', label: 'Remove' },
  ]

  return (
    <div data-testid="cli-setup-section">
      <p className="text-sm text-gray-500 mb-6">
        Use the Tiddly CLI to quickly configure or remove MCP servers and skills for your AI tools.
        Select what you'd like to do and follow the steps below.
      </p>

      {/* Status tip */}
      <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-2.5 mb-6" data-testid="status-tip">
        <p className="text-xs text-blue-700">
          Check which MCP servers and skills are configured on your machine with <code className="bg-blue-100 px-1 rounded text-xs">tiddly status</code>.
        </p>
      </div>

      {/* Action */}
      <div className="mb-6">
        <SectionDivider label="Action" tooltip="Configure sets up new integrations. Remove tears down existing configurations and optionally revokes tokens." />
        <PillSelectGroup options={actionOptions} value={cliAction} onChange={setCliAction} />
      </div>

      {/* Where to configure/remove */}
      <div className="mb-6">
        <SectionDivider label={isRemove ? 'Where to remove' : 'Where to configure'} tooltip="Tiddly MCP servers are compatible with any AI tool that supports the MCP protocol. If your tool isn't listed here, you can still configure it manually following your tool's MCP setup instructions." />
        <PillToggleGroup options={toolOptions} selected={selectedTools} onChange={setSelectedTools} />
      </div>

      {/* What to configure/remove */}
      <div className="mb-6">
        <SectionDivider label={isRemove ? 'What to remove' : 'What to configure'} tooltip="MCP Servers give AI tools direct access to your bookmarks, notes, and prompts. Skills are reusable instruction files exported from your prompts that AI tools can auto-invoke. Each tool handles skills differently — for example, Claude Code uses slash commands while Claude Desktop uses natural language." />
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="text-sm font-medium text-gray-600 w-28 flex-shrink-0">MCP Servers</span>
            <PillToggleGroup options={serverOptions} selected={selectedServers} onChange={setSelectedServers} />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="text-sm font-medium text-gray-600 w-28 flex-shrink-0">Skills</span>
            <PillSelectGroup<'yes' | 'no'>
              options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
              value={installSkills ? 'yes' : 'no'}
              onChange={(v) => setInstallSkills(v === 'yes')}
            />
          </div>
        </div>
      </div>

      {/* Options - remove flow (scope + delete tokens) */}
      {isRemove && (hasMcpServers || installSkills) && (
        <div className="mb-6">
          <SectionDivider label="Options" tooltip="Scope controls which config location to remove from. Delete Tokens revokes the PATs embedded in the tool configurations." />
          <div className="space-y-4">
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <span className="text-sm font-medium text-gray-600 w-28 flex-shrink-0">Scope</span>
                <PillSelectGroup options={scopeOptions} value={removeScope} onChange={setRemoveScope} />
              </div>
            </div>
            {hasMcpServers && (
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="text-sm font-medium text-gray-600 w-28 flex-shrink-0">Delete Tokens</span>
                  <PillSelectGroup<'yes' | 'no'>
                    options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
                    value={deleteTokens ? 'yes' : 'no'}
                    onChange={(v) => setDeleteTokens(v === 'yes')}
                  />
                </div>
                {deleteTokens && (
                  <p className="text-xs text-amber-600 mt-2 ml-0 sm:ml-28">
                    Requires <code className="rounded bg-amber-50 px-1 py-0.5 text-xs">tiddly login</code> — the CLI needs to authenticate to revoke tokens via the API.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Skills removal warning */}
      {isRemove && installSkills && (
        <div className="mb-6" data-testid="skills-remove-warning">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <h4 className="text-sm font-semibold text-amber-800 mb-2">Warning</h4>
            <p className="text-sm text-amber-800">
              The CLI cannot distinguish Tiddly skills from other skills. The commands below will delete <em>all</em> skill files in the skills directories, including any non-Tiddly skills. Uncomment the commands to execute them.
            </p>
          </div>
        </div>
      )}

      {/* Options - scope (hidden when removing) */}
      {!isRemove && (hasMcpServers || installSkills) && (
        <div className="mb-6">
          <SectionDivider label="Options" tooltip="Scope controls where configurations are stored. User scope makes integrations available everywhere. Directory scope limits them to the directory you run the command in." />
          <div className="space-y-4">
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <span className="text-sm font-medium text-gray-600 w-28 flex-shrink-0">Scope</span>
                <PillSelectGroup options={scopeOptions} value={scope} onChange={setScope} />
              </div>
              {scope === 'directory' && (
                <p className="text-xs text-gray-500 mt-2 ml-0 sm:ml-28">
                  Configuration only applies when running tools from a specific directory.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Skills tag filter (hidden when removing) */}
      {!isRemove && installSkills && (
        <div className="mb-6">
          <SectionDivider label="Skills tag filter" tooltip="Filter which of your prompts get exported as skills by tag. Only prompts matching the selected tags will be installed. Leave empty to export all prompts." />
          <p className="text-sm text-gray-500 mb-3">
            Filter which prompts to export as skills. Leave empty to export all prompts.
          </p>
          <SkillsTagSelector
            availableTags={promptTags}
            selectedTags={skillsTags}
            onChange={setSkillsTags}
          />
          <div className="flex items-center gap-2 mt-3">
            <span className="text-sm font-medium text-gray-600">Match</span>
            <PillSelectGroup options={tagMatchOptions} value={skillsTagMatch} onChange={setSkillsTagMatch} />
          </div>
        </div>
      )}

      {/* Steps */}
      <SectionDivider label="Steps" />
      {!hasSelections ? (
        <p className="text-sm text-gray-400 italic">Select at least one item and one target tool above.</p>
      ) : (scopeConflictError || skillsConflictError) ? (
        <div className="space-y-1">
          {scopeConflictError && (
            <p className="text-sm text-amber-600 italic">{scopeConflictTools.map((t) => CLI_TOOL_LABELS[t]).join(' and ')} only support{scopeConflictTools.length === 1 ? 's' : ''} User scope. Deselect {scopeConflictTools.length === 1 ? 'it' : 'them'} or switch to User scope.</p>
          )}
          {skillsConflictError && (
            <p className="text-sm text-amber-600 italic">{skillsConflictTools.map((t) => CLI_TOOL_LABELS[t]).join(' and ')} {skillsConflictTools.length === 1 ? 'does' : 'do'} not support skills. Deselect {skillsConflictTools.length === 1 ? 'it' : 'them'} or turn off Skills.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Step 1: Install CLI */}
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex gap-4">
              <span className="text-lg font-semibold text-[#d97b3d] select-none">1</span>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-gray-900">Install the CLI</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Skip if already installed.{' '}
                  <Link to="/docs/cli" className="text-[#d97b3d] hover:underline">CLI docs</Link>
                </p>
                <div className="relative mt-2">
                  <code className="block bg-gray-50 text-gray-700 px-3 py-2 rounded text-xs font-mono pr-14 overflow-x-auto">
                    {installCommand}
                  </code>
                  <button
                    onClick={handleCopyInstall}
                    className={`absolute top-1.5 right-1.5 rounded px-1.5 py-0.5 text-xs transition-colors ${
                      copiedInstall
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                    }`}
                  >
                    {copiedInstall ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Step 2: Login (not needed for remove unless --delete-tokens with MCP servers) */}
          {(!isRemove || (deleteTokens && hasMcpServers)) && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex gap-4">
                <span className="text-lg font-semibold text-[#d97b3d] select-none">2</span>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900">Log in</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Authenticate with your Tiddly account</p>
                  <div className="relative mt-2">
                    <code className="block bg-gray-50 text-gray-700 px-3 py-2 rounded text-xs font-mono pr-14 overflow-x-auto">
                      {loginCommand}
                    </code>
                    <button
                      onClick={handleCopyLogin}
                      className={`absolute top-1.5 right-1.5 rounded px-1.5 py-0.5 text-xs transition-colors ${
                        copiedLogin
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                      }`}
                    >
                      {copiedLogin ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3 (or 2 for remove without delete-tokens): Run command */}
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex gap-4">
              <span className="text-lg font-semibold text-[#d97b3d] select-none">{isRemove && !(deleteTokens && hasMcpServers) ? 2 : 3}</span>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-gray-900">{isRemove ? 'Remove your integrations' : 'Install your integrations'}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{isRemove ? 'Run this command to remove your selected integrations' : 'Run this command to configure your selected integrations'}</p>
                <div className="relative mt-2">
                  <code data-testid="cli-install-command" className="block bg-gray-50 text-gray-700 px-3 py-2 rounded text-xs font-mono pr-14 whitespace-pre-wrap overflow-x-auto">
                    {command}
                  </code>
                  <button
                    onClick={handleCopyCommand}
                    className={`absolute top-1.5 right-1.5 rounded px-1.5 py-0.5 text-xs transition-colors ${
                      copiedCommand
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                    }`}
                  >
                    {copiedCommand ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                {affectedFiles.length > 0 && (
                  <details className="mt-2" data-testid="affected-files">
                    <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">Files modified</summary>
                    <div className="mt-1.5 text-xs text-gray-400 font-mono space-y-0.5">
                      {affectedFiles.map((f) => (
                        <div key={f.path} className="flex gap-3">
                          <span className="text-gray-500 min-w-[15rem]">{f.path}</span>
                          <span>{f.description}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>
          </div>
          {/* Step 4 (or 3 for remove without delete-tokens): Restart tools */}
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex gap-4">
              <span className="text-lg font-semibold text-[#d97b3d] select-none">{isRemove && !(deleteTokens && hasMcpServers) ? 3 : 4}</span>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-gray-900">Restart your tools</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Restart{' '}
                  {(() => {
                    const names = [...selectedTools].map((t) => CLI_TOOL_LABELS[t])
                    if (names.length === 0) return 'your tools'
                    if (names.length === 1) return names[0]
                    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
                  })()}{' '}
                  to pick up the new integrations.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface SkillsTagSelectorProps {
  availableTags: TagCount[]
  selectedTags: string[]
  onChange: (tags: string[]) => void
}

function SkillsTagSelector({
  availableTags,
  selectedTags,
  onChange,
}: SkillsTagSelectorProps): ReactNode {
  const [isOpen, setIsOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Filter suggestions based on input
  const filteredTags = availableTags.filter(
    (tag) => tag.name.toLowerCase().includes(inputValue.toLowerCase())
  )

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleTag = (tagName: string): void => {
    if (selectedTags.includes(tagName)) {
      onChange(selectedTags.filter((t) => t !== tagName))
    } else {
      onChange([...selectedTags, tagName])
    }
  }

  const removeTag = (tagName: string): void => {
    onChange(selectedTags.filter((t) => t !== tagName))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      setIsOpen(false)
      inputRef.current?.blur()
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Selected tags display */}
      <div
        className="min-h-[34px] p-1.5 border border-gray-200 rounded-lg bg-white cursor-text flex flex-wrap gap-1.5 items-center"
        onClick={() => {
          setIsOpen(true)
          inputRef.current?.focus()
        }}
      >
        {selectedTags.length === 0 && !isOpen && (
          <span className="text-gray-400 text-sm">All prompts (click to filter by tags)</span>
        )}
        {selectedTags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[#fff0e5] text-[#d97b3d]"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                removeTag(tag)
              }}
              className="hover:text-orange-900"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
        {isOpen && (
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={selectedTags.length > 0 ? 'Add more...' : 'Type to filter...'}
            className="flex-1 min-w-[100px] outline-none text-sm"
            autoFocus
          />
        )}
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-10 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {filteredTags.length === 0 ? (
            <div className="px-3 py-1.5 text-sm text-gray-400">
              {inputValue ? 'No matching tags' : 'No tags available'}
            </div>
          ) : (
            filteredTags.map((tag) => {
              const isSelected = selectedTags.includes(tag.name)
              return (
                <button
                  key={tag.name}
                  type="button"
                  onClick={() => toggleTag(tag.name)}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition-colors ${
                    isSelected
                      ? 'bg-[#fff7f0] text-[#d97b3d]'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {isSelected && (
                      <svg className="w-4 h-4 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                    {tag.name}
                  </span>
                  <span className="text-xs text-gray-400">{tag.content_count}</span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

/**
 * One MCP server URL with a copy button, for the OAuth connect section.
 */
function ServerUrlRow({ label, url }: { label: string; url: string }): ReactNode {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* Silent fail */ }
  }

  return (
    <div>
      <p className="text-xs font-semibold text-gray-700 mb-1">{label}</p>
      <div className="relative">
        <code className="block bg-gray-50 text-gray-700 px-3 py-2 rounded text-xs font-mono pr-14 overflow-x-auto">
          {url}
        </code>
        <button
          onClick={handleCopy}
          className={`absolute top-1.5 right-1.5 rounded px-1.5 py-0.5 text-xs transition-colors ${
            copied
              ? 'bg-green-600 text-white'
              : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
          }`}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

// The per-app OAuth steps are single-sourced in the prose doc (also served to
// agents at /prose/connect-ai-apps.md); the widget renders everything after
// this marker so the two surfaces cannot drift.
const PER_APP_STEPS_MARKER = '<!-- widget:per-app-steps -->'

/**
 * OAuth connect tab: paste-the-URL setup for apps with remote MCP connector
 * support (Claude, ChatGPT, Claude Code, Codex). No tokens involved — the app
 * discovers the sign-in flow from the server URL. Per-app steps are rendered
 * from the shared prose doc.
 */
function OAuthConnectSection(): ReactNode {
  const doc = getProseDoc('connect-ai-apps')
  const markerIndex = doc.body.indexOf(PER_APP_STEPS_MARKER)
  const perAppSteps = markerIndex === -1 ? doc.body : doc.body.slice(markerIndex + PER_APP_STEPS_MARKER.length)

  return (
    <div>
      <p className="text-sm text-gray-600 mb-4">
        Paste a server URL into the app, sign in with your Tiddly account in the browser, and
        approve — that&rsquo;s the whole setup. The simplest path for Claude (web, desktop,
        mobile), Claude Code, and Codex.
      </p>
      <div className="flex flex-col gap-3 mb-6">
        <ServerUrlRow label="Bookmarks & Notes" url="https://content-mcp.tiddly.me/mcp" />
        <ServerUrlRow label="Prompts" url="https://prompts-mcp.tiddly.me/mcp" />
      </div>
      <DocsMarkdown body={perAppSteps} />
    </div>
  )
}

type SetupTab = 'oauth' | 'cli'

/**
 * Tab bar for the two setup paths. OAuth is the default — it's the simplest
 * path for every connector-capable app; the CLI tab covers what OAuth can't
 * (headless/SSH machines, scripts, tools without connector support).
 */
function SetupTabs({ active, onChange }: { active: SetupTab; onChange: (tab: SetupTab) => void }): ReactNode {
  const tabs: { value: SetupTab; label: string }[] = [
    { value: 'oauth', label: 'Connect with OAuth' },
    { value: 'cli', label: 'Setup via CLI' },
  ]
  return (
    <div className="flex gap-6 border-b border-gray-200 mb-6" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={active === tab.value}
          onClick={() => onChange(tab.value)}
          className={`pb-2 -mb-px text-sm font-semibold border-b-2 transition-colors ${
            active === tab.value
              ? 'border-[#f09040] text-gray-900'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Build the export URL for skills API endpoint.
 */
function getDefaultSkillTags(availableTags: TagCount[]): string[] {
  const tagNames = availableTags.map((t) => t.name)
  if (tagNames.includes('skill')) return ['skill']
  if (tagNames.includes('skills')) return ['skills']
  return []
}

export function AISetupWidget(): ReactNode {
  const [activeTab, setActiveTab] = useState<SetupTab>('oauth')

  return (
    <div>
      <p className="text-sm text-gray-600 mb-4">
        Connect AI assistants to your bookmarks, notes, and prompts using the{' '}
        <a
          href="https://modelcontextprotocol.io/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#d97b3d] hover:underline"
        >
          Model Context Protocol (MCP)
        </a>
        . Tiddly provides two MCP servers:
      </p>
      <ul className="text-sm text-gray-600 mb-4 list-disc list-inside space-y-1">
        <li><strong>Content Server</strong> — search and manage your bookmarks and notes</li>
        <li><strong>Prompt Server</strong> — search, view, and edit your prompt templates</li>
      </ul>
      <p className="text-sm text-gray-600 mb-8">
        You can also export your prompts as <strong>Agent Skills</strong> — reusable instruction
        files that AI assistants can auto-invoke based on context.
      </p>

      <div className="mb-8 flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-600">
          <span className="font-semibold text-gray-900">Prefer an agent to do it?</span> Hand your
          AI agent a prompt and it&rsquo;ll walk you through the setup below.
        </p>
        <AgentPromptButton
          buttonLabel="Set up with your AI agent"
          explanation="Paste this prompt into your AI agent."
          prompt={MCP_SETUP_PROMPT}
          buttonClassName="inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
        />
      </div>

      <SetupTabs active={activeTab} onChange={setActiveTab} />

      {activeTab === 'oauth' ? (
        <OAuthConnectSection />
      ) : (
        <div>
          <p className="text-sm text-gray-600 mb-6">
            Token-based setup for when OAuth can&rsquo;t work: headless or remote machines
            (e.g. SSH, where no browser can open to sign in), scripted setups, and tools
            without OAuth connector support (e.g. Antigravity). Also the home of{' '}
            <Link to="/docs/cli/skills" className="text-[#d97b3d] hover:underline">Skills</Link>{' '}
            export.
          </p>
          <CLISetupSection />
        </div>
      )}
    </div>
  )
}

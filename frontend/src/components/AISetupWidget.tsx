/**
 * Reusable AI Integration setup widget with CLI and manual (Curl/PAT) tabs.
 * Used by both Settings → AI Integration and Docs → AI Integration.
 */
import { useState, useEffect, useRef } from 'react'
import type { ReactNode, KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { config } from '../config'
import { api } from '../services/api'
import { useAuthStatus } from '../hooks/useAuthStatus'
import type { TagCount, TagListResponse } from '../types'

const CONFIG_PATH_MAC = '~/Library/Application\\ Support/Claude/claude_desktop_config.json'
const CONFIG_PATH_WINDOWS = '%APPDATA%\\Claude\\claude_desktop_config.json'

// Selector types
type ServerType = 'content' | 'prompts'
type ClientType = 'claude-desktop' | 'claude-code' | 'gemini-cli' | 'chatgpt' | 'codex'
type AuthType = 'bearer' | 'oauth'
type IntegrationType = 'mcp' | 'skills'
type SetupTab = 'cli' | 'manual'

interface McpServerConfig {
  command: string
  args: string[]
}

/**
 * Selector row component for PyTorch-style configuration.
 */
interface SelectorOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
  comingSoon?: boolean
}

interface SelectorRowProps<T extends string> {
  label: string
  options: SelectorOption<T>[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
}

function SelectorRow<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: SelectorRowProps<T>): ReactNode {
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-1.5">
      {/* Label - on mobile shows above options with orange border, on desktop shows inline */}
      <div className="border-l-4 border-l-[#f09040] pl-3 md:border-l-0 md:pl-4 md:w-32 md:flex-shrink-0">
        <span className={`text-sm font-medium ${disabled ? 'text-gray-400' : 'text-gray-700'}`}>{label}</span>
      </div>
      {/* Options - stack vertically on mobile, horizontal on desktop */}
      <div className="flex flex-col md:flex-row md:flex-1 gap-1.5 pl-4 md:pl-0">
        {options.map((option) => {
          const isSelected = value === option.value
          const isComingSoon = option.comingSoon
          const isOptionDisabled = disabled || option.disabled

          // Color scheme:
          // Supported: light orange (unselected) / dark orange (selected)
          // Unsupported/coming soon: light gray (unselected) / dark gray (selected)
          // Disabled: very light gray, not clickable

          return (
            <button
              key={option.value}
              type="button"
              disabled={isOptionDisabled}
              onClick={() => !isOptionDisabled && onChange(option.value)}
              className={`
                md:flex-1 px-4 py-2.5 text-sm font-medium transition-colors text-left md:text-center
                ${
                  isOptionDisabled
                    ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                    : isComingSoon
                    ? isSelected
                      ? 'bg-gray-300 text-gray-700'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    : isSelected
                    ? 'bg-[#f09040] text-white'
                    : 'bg-[#fff0e5] text-[#d97b3d] hover:bg-[#ffe4d1]'
                }
              `}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// =============================================================================
// CLI-First Setup Section
// =============================================================================

type CliToolType = 'claude-desktop' | 'claude-code' | 'codex'
type CliActionType = 'configure' | 'remove'
type McpScopeType = 'user' | 'local' | 'project'
type SkillsScopeType = 'global' | 'project'
type TagMatchType = 'all' | 'any'

// Scope support matrix (matches CLI handler.SupportedScopes())
const MCP_SCOPE_SUPPORT: Record<CliToolType, McpScopeType[]> = {
  'claude-desktop': ['user'],
  'claude-code': ['user', 'local', 'project'],
  'codex': ['user', 'project'],
}

const SKILLS_SCOPE_SUPPORT: Record<CliToolType, SkillsScopeType[]> = {
  'claude-desktop': ['global'],
  'claude-code': ['global', 'project'],
  'codex': ['global', 'project'],
}

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
function StepCard({ number, title, subtitle, children }: { number: number; title: string; subtitle?: string; children?: ReactNode }): ReactNode {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex gap-4">
        <span className="text-lg font-semibold text-[#d97b3d] select-none">{number}</span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * Generate CLI command(s) based on selected options.
 */
function generateCLICommands(
  action: CliActionType,
  selectedServers: Set<ServerType>,
  installSkills: boolean,
  selectedTools: Set<CliToolType>,
  mcpScope: McpScopeType,
  skillsScope: SkillsScopeType,
  skillsTags: string[],
  skillsTagMatch: TagMatchType,
  deleteTokens: boolean,
  removeMcpScope: McpScopeType,
): string {
  if (action === 'remove') {
    return generateRemoveCommands(selectedServers, installSkills, selectedTools, deleteTokens, removeMcpScope)
  }

  const allTools: CliToolType[] = ['claude-desktop', 'claude-code', 'codex']
  const needsCd = (mcpScope === 'local' || mcpScope === 'project') || (installSkills && skillsScope === 'project')
  const parts: string[] = []

  if (selectedServers.size > 0 && selectedTools.size > 0) {
    let cmd = 'tiddly mcp configure'

    // Add specific tools if not all selected
    const mcpTools = allTools.filter((t) => selectedTools.has(t))
    if (mcpTools.length < allTools.length) {
      cmd += ' ' + mcpTools.join(' ')
    }

    // Add --servers if not both
    if (selectedServers.size === 1) {
      cmd += ` --servers ${[...selectedServers][0]}`
    }

    // Add --scope if not default
    if (mcpScope !== 'user') {
      cmd += ` --scope ${mcpScope}`
    }

    parts.push(cmd)
  }

  if (installSkills && selectedTools.size > 0) {
    let cmd = 'tiddly skills configure'

    // Add specific tools if not all selected
    const skillsTools = allTools.filter((t) => selectedTools.has(t))
    if (skillsTools.length < allTools.length) {
      cmd += ' ' + skillsTools.join(' ')
    }

    // Add --scope if not default
    if (skillsScope !== 'global') {
      cmd += ` --scope ${skillsScope}`
    }

    // Add --tags if not default ('skill')
    if (skillsTags.length === 0) {
      cmd += ' --tags ""'
    } else if (skillsTags.length !== 1 || skillsTags[0] !== 'skill') {
      cmd += ` --tags ${skillsTags.join(',')}`
    }

    // Add --tag-match if not default
    if (skillsTagMatch === 'any') {
      cmd += ' --tag-match any'
    }

    parts.push(cmd)
  }

  if (parts.length === 0) return ''

  // Prepend cd when local/project scope requires a project directory
  if (needsCd) {
    parts.unshift('cd /path/to/your/project')
  }

  if (parts.length === 1) return parts[0]
  // Use && chaining when no cd is prepended (single copy-pasteable command that stops on failure)
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
  mcpScope: McpScopeType,
): string {
  const allTools: CliToolType[] = ['claude-desktop', 'claude-code', 'codex']
  const needsCd = mcpScope === 'local' || mcpScope === 'project'
  const parts: string[] = []

  if (selectedServers.size > 0 && selectedTools.size > 0) {
    // Skip tools that don't support the selected scope
    const mcpTools = allTools.filter((t) => selectedTools.has(t) && MCP_SCOPE_SUPPORT[t].includes(mcpScope))
    for (const tool of mcpTools) {
      let cmd = `tiddly mcp remove ${tool}`
      if (selectedServers.size === 1) {
        cmd += ` --servers ${[...selectedServers][0]}`
      }
      if (mcpScope !== 'user') {
        cmd += ` --scope ${mcpScope}`
      }
      if (deleteTokens) {
        cmd += ' --delete-tokens'
      }
      parts.push(cmd)
    }
  }

  if (removeSkills && selectedTools.size > 0) {
    const skillsTools = allTools.filter((t) => selectedTools.has(t))
    for (const tool of skillsTools) {
      if (tool === 'claude-desktop') {
        parts.push('# Claude Desktop: manually remove skills from Settings > Capabilities')
      } else {
        const dir = tool === 'claude-code' ? '~/.claude/skills/' : '~/.codex/skills/'
        parts.push(`# WARNING: Removes ALL skills including non-Tiddly ones`)
        parts.push(`# rm -rf ${dir}`)
      }
    }
    // Project-level skill paths when local/project scope
    if (needsCd) {
      parts.push('# WARNING: Removes ALL project-level skills including non-Tiddly ones')
      if (selectedTools.has('claude-code')) {
        parts.push('# rm -rf .claude/skills/')
      }
      if (selectedTools.has('codex')) {
        parts.push('# rm -rf .codex/skills/')
      }
    }
  }

  if (parts.length === 0) return ''

  // Prepend cd when local/project scope requires a project directory
  if (needsCd) {
    parts.unshift('cd /path/to/your/project')
  }

  return parts.join('\n')
}

/**
 * Get scope warnings for tools that don't support the selected scope.
 */
const CLI_TOOL_LABELS: Record<CliToolType, string> = {
  'claude-desktop': 'Claude Desktop',
  'claude-code': 'Claude Code',
  'codex': 'Codex',
}

function getMcpScopeWarnings(selectedTools: Set<CliToolType>, scope: McpScopeType): string[] {
  const warnings: string[] = []
  for (const tool of selectedTools) {
    if (!MCP_SCOPE_SUPPORT[tool].includes(scope)) {
      warnings.push(`${CLI_TOOL_LABELS[tool]} doesn't support "${scope}" scope and will be skipped`)
    }
  }
  return warnings
}

function getSkillsScopeWarnings(selectedTools: Set<CliToolType>, scope: SkillsScopeType): string[] {
  const warnings: string[] = []
  for (const tool of selectedTools) {
    if (!SKILLS_SCOPE_SUPPORT[tool].includes(scope)) {
      warnings.push(`${CLI_TOOL_LABELS[tool]} doesn't support "${scope}" scope and will be skipped`)
    }
  }
  return warnings
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

  // Scope
  const [mcpScope, setMcpScope] = useState<McpScopeType>('user')
  const [removeMcpScope, setRemoveMcpScope] = useState<McpScopeType>('user')
  const [skillsScope, setSkillsScope] = useState<SkillsScopeType>('global')

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
  const command = generateCLICommands(cliAction, selectedServers, installSkills, selectedTools, mcpScope, skillsScope, skillsTags, skillsTagMatch, deleteTokens, removeMcpScope)
  const hasAnything = hasSelections && command !== ''

  const activeMcpScope = isRemove ? removeMcpScope : mcpScope
  const mcpScopeWarnings = hasMcpServers ? getMcpScopeWarnings(selectedTools, activeMcpScope) : []
  const skillsScopeWarnings = installSkills ? getSkillsScopeWarnings(selectedTools, skillsScope) : []

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
  ]

  // Server options
  const serverOptions: PillOption<ServerType>[] = [
    { value: 'content', label: 'Bookmarks & Notes' },
    { value: 'prompts', label: 'Prompts' },
  ]

  // MCP scope options
  const mcpScopeOptions: PillOption<McpScopeType>[] = [
    { value: 'user', label: 'User (global)' },
    { value: 'local', label: 'Local' },
    { value: 'project', label: 'Project' },
  ]

  // Skills scope options
  const skillsScopeOptions: PillOption<SkillsScopeType>[] = [
    { value: 'global', label: 'Global' },
    { value: 'project', label: 'Project' },
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
      {isRemove && hasMcpServers && (
        <div className="mb-6">
          <SectionDivider label="Options" tooltip="Scope controls which config location to remove from. Delete Tokens revokes the PATs embedded in the tool configurations." />
          <div className="space-y-4">
            {hasMcpServers && (
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="text-sm font-medium text-gray-600 w-28 flex-shrink-0">MCP Scope</span>
                  <PillSelectGroup options={mcpScopeOptions} value={removeMcpScope} onChange={setRemoveMcpScope} />
                </div>
                {mcpScopeWarnings.length > 0 && (
                  <div className="mt-2 ml-0 sm:ml-28">
                    {mcpScopeWarnings.map((w) => (
                      <p key={w} className="text-xs text-amber-600">{w}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
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
          <SectionDivider label="Options" tooltip="Scope controls where configurations are stored. User/Global scope makes integrations available everywhere, while Local/Project scope limits them to a specific project directory." />
          <div className="space-y-4">
            {hasMcpServers && (
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="text-sm font-medium text-gray-600 w-28 flex-shrink-0">MCP Scope</span>
                  <PillSelectGroup options={mcpScopeOptions} value={mcpScope} onChange={setMcpScope} />
                </div>
                {mcpScopeWarnings.length > 0 && (
                  <div className="mt-2 ml-0 sm:ml-28">
                    {mcpScopeWarnings.map((w) => (
                      <p key={w} className="text-xs text-amber-600">{w}</p>
                    ))}
                  </div>
                )}
                {selectedTools.has('claude-code') && mcpScope !== 'local' && (
                  <div className="mt-2 ml-0 sm:ml-28">
                    <p className="text-xs text-amber-600">
                      Note: Claude Code defaults to local (per-project) scope. Using &quot;{mcpScope}&quot; scope
                      will make MCP servers available across all projects.
                      Use <span className="font-medium">Local</span> if you prefer per-project configuration.
                    </p>
                  </div>
                )}
              </div>
            )}
            {installSkills && (
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="text-sm font-medium text-gray-600 w-28 flex-shrink-0">Skills Scope</span>
                  <PillSelectGroup options={skillsScopeOptions} value={skillsScope} onChange={setSkillsScope} />
                </div>
                {skillsScopeWarnings.length > 0 && (
                  <div className="mt-2 ml-0 sm:ml-28">
                    {skillsScopeWarnings.map((w) => (
                      <p key={w} className="text-xs text-amber-600">{w}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
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
      ) : !hasAnything ? (
        <p className="text-sm text-gray-400 italic">No commands to run — the selected tools don&apos;t support the chosen scope.</p>
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

// =============================================================================
// Manual Setup Section (existing PyTorch-style selector, collapsed by default)
// =============================================================================

/**
 * Generate the Claude Desktop config JSON based on server selection.
 */
function generateClaudeDesktopConfig(
  server: ServerType,
  mcpUrl: string,
  promptMcpUrl: string
): string {
  const servers: Record<string, McpServerConfig> = {}

  if (server === 'content') {
    servers.tiddly_notes_bookmarks = {
      command: 'npx',
      args: [
        'mcp-remote',
        `${mcpUrl}/mcp`,
        '--header',
        'Authorization: Bearer YOUR_TOKEN_HERE',
      ],
    }
  } else {
    servers.tiddly_prompts = {
      command: 'npx',
      args: [
        'mcp-remote',
        `${promptMcpUrl}/mcp`,
        '--header',
        'Authorization: Bearer YOUR_TOKEN_HERE',
      ],
    }
  }

  const configObj = { mcpServers: servers }
  return JSON.stringify(configObj, null, 2)
}

/**
 * Generate the Claude Code commands based on server selection.
 */
function generateClaudeCodeCommand(
  server: ServerType,
  mcpUrl: string,
  promptMcpUrl: string
): string {
  if (server === 'content') {
    return `claude mcp add --transport http tiddly_notes_bookmarks ${mcpUrl}/mcp \\
  --header "Authorization: Bearer YOUR_TOKEN_HERE"`
  } else {
    return `claude mcp add --transport http tiddly_prompts ${promptMcpUrl}/mcp \\
  --header "Authorization: Bearer YOUR_TOKEN_HERE"`
  }
}

/**
 * Claude Desktop setup instructions component.
 */
interface ClaudeDesktopInstructionsProps {
  server: ServerType
  mcpUrl: string
  promptMcpUrl: string
}

function ClaudeDesktopInstructions({
  server,
  mcpUrl,
  promptMcpUrl,
}: ClaudeDesktopInstructionsProps): ReactNode {
  const [copiedConfig, setCopiedConfig] = useState(false)
  const [copiedPathMac, setCopiedPathMac] = useState(false)
  const [copiedPathWin, setCopiedPathWin] = useState(false)

  const exampleConfig = generateClaudeDesktopConfig(server, mcpUrl, promptMcpUrl)

  const handleCopyConfig = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(exampleConfig)
      setCopiedConfig(true)
      setTimeout(() => setCopiedConfig(false), 2000)
    } catch {
      // Silent fail
    }
  }

  const handleCopyPathMac = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(CONFIG_PATH_MAC)
      setCopiedPathMac(true)
      setTimeout(() => setCopiedPathMac(false), 2000)
    } catch {
      // Silent fail
    }
  }

  const handleCopyPathWin = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(CONFIG_PATH_WINDOWS)
      setCopiedPathWin(true)
      setTimeout(() => setCopiedPathWin(false), 2000)
    } catch {
      // Silent fail
    }
  }

  return (
    <div className="space-y-3">
      <StepCard number={1} title="Create a Personal Access Token" subtitle="Authenticate with the MCP server">
        <Link
          to="/app/settings/tokens"
          className="btn-primary inline-flex items-center gap-2 mt-2"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Create Token
        </Link>
      </StepCard>

      <StepCard number={2} title="Locate Config File" subtitle="Create or edit the Claude Desktop configuration file">
        <div className="space-y-3 mt-2">
          <div>
            <span className="text-xs font-medium text-gray-700">macOS:</span>
            <div className="relative mt-1">
              <code className="block bg-gray-50 text-gray-700 px-3 py-2 rounded text-xs font-mono pr-14">
                {CONFIG_PATH_MAC}
              </code>
              <button
                onClick={handleCopyPathMac}
                className={`absolute top-1.5 right-1.5 rounded px-1.5 py-0.5 text-xs transition-colors ${
                  copiedPathMac
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                }`}
              >
                {copiedPathMac ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
          <div>
            <span className="text-xs font-medium text-gray-700">Windows:</span>
            <div className="relative mt-1">
              <code className="block bg-gray-50 text-gray-700 px-3 py-2 rounded text-xs font-mono pr-14">
                {CONFIG_PATH_WINDOWS}
              </code>
              <button
                onClick={handleCopyPathWin}
                className={`absolute top-1.5 right-1.5 rounded px-1.5 py-0.5 text-xs transition-colors ${
                  copiedPathWin
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                }`}
              >
                {copiedPathWin ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      </StepCard>

      <StepCard number={3} title="Add Configuration" subtitle="Add the following to your config file">
        <div className="relative mt-2">
          <pre className="rounded bg-gray-50 px-3 py-2 text-xs text-gray-700 whitespace-pre-wrap break-all overflow-x-auto font-mono pr-14">
            <code>{exampleConfig}</code>
          </pre>
          <button
            onClick={handleCopyConfig}
            className={`absolute top-1.5 right-1.5 rounded px-1.5 py-0.5 text-xs transition-colors ${
              copiedConfig
                ? 'bg-green-600 text-white'
                : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
            }`}
          >
            {copiedConfig ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Replace <code className="bg-gray-100 px-1 rounded">YOUR_TOKEN_HERE</code> with
          your Personal Access Token from Step 1.
        </p>
      </StepCard>

      <StepCard number={4} title="Restart Claude Desktop" subtitle="Load the MCP server">
        <div className="mt-2 rounded-lg bg-blue-50 border border-blue-200 p-3">
          <p className="text-xs text-blue-800">
            <strong>Verify:</strong> Start a new conversation and try{' '}
            {server === 'content' ? (
              <em>&quot;Search my bookmarks&quot;</em>
            ) : (
              <em>&quot;List my prompts&quot;</em>
            )}{' '}
            to confirm the integration is working.
          </p>
        </div>
      </StepCard>

      <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Want to add both servers?</h3>
        <p className="text-sm text-gray-600">
          Switch between &quot;Content&quot; and &quot;Prompts&quot; in the selector above to see the configuration for each server.
          You can add both configurations to your <code className="bg-gray-200 px-1 rounded text-xs">mcpServers</code> object
          by combining them.
        </p>
      </div>
    </div>
  )
}

/**
 * Claude Code setup instructions component.
 */
interface ClaudeCodeInstructionsProps {
  server: ServerType
  mcpUrl: string
  promptMcpUrl: string
}

function ClaudeCodeInstructions({
  server,
  mcpUrl,
  promptMcpUrl,
}: ClaudeCodeInstructionsProps): ReactNode {
  const [copiedCommand, setCopiedCommand] = useState(false)
  const [copiedImport, setCopiedImport] = useState(false)

  const command = generateClaudeCodeCommand(server, mcpUrl, promptMcpUrl)
  const importCommand = 'claude mcp add-from-claude-desktop'

  const handleCopyCommand = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(command)
      setCopiedCommand(true)
      setTimeout(() => setCopiedCommand(false), 2000)
    } catch {
      // Silent fail
    }
  }

  const handleCopyImport = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(importCommand)
      setCopiedImport(true)
      setTimeout(() => setCopiedImport(false), 2000)
    } catch {
      // Silent fail
    }
  }

  return (
    <div className="space-y-3">
      <StepCard number={1} title="Create a Personal Access Token" subtitle="Authenticate with the MCP server">
        <Link
          to="/app/settings/tokens"
          className="btn-primary inline-flex items-center gap-2 mt-2"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Create Token
        </Link>
      </StepCard>

      <StepCard number={2} title="Add MCP Server" subtitle="Run this command in your project directory">
        <div className="relative mt-2">
          <pre className="rounded bg-gray-50 px-3 py-2 text-xs text-gray-700 whitespace-pre-wrap overflow-x-auto font-mono pr-14">
            <code>{command}</code>
          </pre>
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
        <p className="mt-2 text-xs text-gray-500">
          Replace <code className="bg-gray-100 px-1 rounded">YOUR_TOKEN_HERE</code> with
          your Personal Access Token from Step 1.
        </p>
      </StepCard>

      <StepCard number={3} title="Verify Installation">
        <p className="text-xs text-gray-500 mt-1">
          The server is now configured for this project. Try asking Claude Code to{' '}
          {server === 'content' ? (
            <em>&quot;search my bookmarks&quot;</em>
          ) : (
            <em>&quot;list my prompts&quot;</em>
          )}{' '}
          to verify it&apos;s working.
        </p>
        <div className="mt-2 rounded-lg bg-blue-50 border border-blue-200 p-3">
          <p className="text-xs text-blue-800">
            <strong>Note:</strong> Claude Code MCP servers are configured per project/directory.
            Run the command in each project where you want access.
          </p>
        </div>
      </StepCard>

      <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Alternative: Import from Claude Desktop</h3>
        <p className="text-sm text-gray-600 mb-3">
          If you&apos;ve already configured Claude Desktop, you can import those servers:
        </p>
        <div className="relative">
          <code className="block bg-gray-50 text-gray-700 px-3 py-2 rounded text-xs font-mono pr-14">
            {importCommand}
          </code>
          <button
            onClick={handleCopyImport}
            className={`absolute top-1.5 right-1.5 rounded px-1.5 py-0.5 text-xs transition-colors ${
              copiedImport
                ? 'bg-green-600 text-white'
                : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
            }`}
          >
            {copiedImport ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Want to add both servers?</h3>
        <p className="text-sm text-gray-600">
          Switch between &quot;Content&quot; and &quot;Prompts&quot; in the selector above to see the command for each server.
          Run both commands to add both MCP servers to your project.
        </p>
      </div>
    </div>
  )
}

/**
 * Generate the Codex config TOML based on server selection.
 */
function generateCodexConfig(
  server: ServerType,
  mcpUrl: string,
  promptMcpUrl: string
): string {
  if (server === 'content') {
    return `[mcp_servers.tiddly_notes_bookmarks]
url = "${mcpUrl}/mcp"
http_headers = { "Authorization" = "Bearer YOUR_TOKEN_HERE" }`
  } else {
    return `[mcp_servers.tiddly_prompts]
url = "${promptMcpUrl}/mcp"
http_headers = { "Authorization" = "Bearer YOUR_TOKEN_HERE" }`
  }
}

/**
 * Codex setup instructions component.
 */
interface CodexInstructionsProps {
  server: ServerType
  mcpUrl: string
  promptMcpUrl: string
}

function CodexInstructions({
  server,
  mcpUrl,
  promptMcpUrl,
}: CodexInstructionsProps): ReactNode {
  const [copiedConfig, setCopiedConfig] = useState(false)

  const configContent = generateCodexConfig(server, mcpUrl, promptMcpUrl)

  const handleCopyConfig = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(configContent)
      setCopiedConfig(true)
      setTimeout(() => setCopiedConfig(false), 2000)
    } catch {
      // Silent fail
    }
  }

  return (
    <div className="space-y-3">
      <StepCard number={1} title="Create a Personal Access Token" subtitle="Authenticate with the MCP server">
        <Link
          to="/app/settings/tokens"
          className="btn-primary inline-flex items-center gap-2 mt-2"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Create Token
        </Link>
      </StepCard>

      <StepCard number={2} title="Add to Config File" subtitle={`Open (or create) ~/.codex/config.toml and add:`}>
        <div className="relative mt-2">
          <pre className="rounded bg-gray-50 px-3 py-2 text-xs text-gray-700 whitespace-pre-wrap overflow-x-auto font-mono pr-14">
            <code>{configContent}</code>
          </pre>
          <button
            onClick={handleCopyConfig}
            className={`absolute top-1.5 right-1.5 rounded px-1.5 py-0.5 text-xs transition-colors ${
              copiedConfig
                ? 'bg-green-600 text-white'
                : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
            }`}
          >
            {copiedConfig ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Replace <code className="bg-gray-100 px-1 rounded">YOUR_TOKEN_HERE</code> with
          your Personal Access Token from Step 1.
        </p>
      </StepCard>

      <StepCard number={3} title="Restart Codex" subtitle="If Codex is running, quit and restart it." />

      <StepCard number={4} title="Verify Installation">
        <p className="text-xs text-gray-500 mt-1">
          In Codex, type <code className="bg-gray-100 px-1 rounded">/mcp</code> to confirm the server
          is connected and shows available tools.
        </p>
      </StepCard>

      {server === 'prompts' && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">Using Your Prompts</h3>
          <p className="text-sm text-blue-800 mb-3">
            <strong>Note:</strong> Codex does not support MCP Prompts directly (the{' '}
            <code className="bg-blue-100 px-1 rounded">/prompt-name</code> invocation style).
            Instead, it exposes your server&apos;s tools for managing and retrieving prompts.
          </p>
          <p className="text-sm text-blue-800 mb-2">
            To use a saved prompt, ask Codex to fetch and apply it:
          </p>
          <ul className="text-sm text-blue-800 list-disc list-inside space-y-1">
            <li>
              <em>&quot;Get my &apos;code-review&apos; prompt and use it to review the changes in this file&quot;</em>
            </li>
            <li>
              <em>&quot;Search my prompts for &apos;commit message&apos; and use the best match to write a commit for my staged changes&quot;</em>
            </li>
          </ul>
        </div>
      )}

      <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Want to add both servers?</h3>
        <p className="text-sm text-gray-600">
          Switch between &quot;Bookmarks &amp; Notes&quot; and &quot;Prompts&quot; in the selector above to see the configuration for each server.
          You can add both configurations to your <code className="bg-gray-200 px-1 rounded text-xs">config.toml</code> file.
        </p>
      </div>
    </div>
  )
}

/**
 * Coming soon placeholder component for various unsupported configurations.
 */
interface ComingSoonProps {
  title: string
  description: string
}

function ComingSoon({ title, description }: ComingSoonProps): ReactNode {
  return (
    <div className="rounded-lg bg-gray-50 border border-gray-200 p-6 text-center">
      <div className="mb-4">
        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-2">
        {title}
      </h3>
      <p className="text-sm text-gray-600">
        {description}
      </p>
    </div>
  )
}

/**
 * Available tools section component.
 */
interface AvailableToolsProps {
  server: ServerType
}

function AvailableTools({ server }: AvailableToolsProps): ReactNode {
  const contentTools = [
    { tool: 'get_context', category: 'Context', description: 'Get context summary of bookmarks and notes' },
    { tool: 'search_items', category: 'Search & Read', description: 'Search bookmarks and notes by text/tags' },
    { tool: 'get_item', category: 'Search & Read', description: 'Get full details by ID' },
    { tool: 'search_in_content', category: 'Search & Read', description: 'Search within content for editing' },
    { tool: 'list_filters', category: 'Search & Read', description: 'List content filters with IDs and tag rules' },
    { tool: 'list_tags', category: 'Search & Read', description: 'Get all tags with usage counts' },
    { tool: 'create_bookmark', category: 'Create & Edit', description: 'Save a new URL' },
    { tool: 'create_note', category: 'Create & Edit', description: 'Create a new note' },
    { tool: 'update_item', category: 'Create & Edit', description: 'Update metadata or fully replace content' },
    { tool: 'edit_content', category: 'Create & Edit', description: 'Edit content using string replacement' },
  ]

  const promptTools = [
    { tool: 'get_context', category: 'Context', description: 'Get context summary of prompts' },
    { tool: 'search_prompts', category: 'Search & Read', description: 'Search prompts by text/tags' },
    { tool: 'get_prompt_content', category: 'Search & Read', description: 'Get template and arguments for viewing/editing' },
    { tool: 'get_prompt_metadata', category: 'Search & Read', description: 'Get metadata without the template' },
    { tool: 'list_filters', category: 'Search & Read', description: 'List prompt filters with IDs and tag rules' },
    { tool: 'list_tags', category: 'Search & Read', description: 'Get all tags with usage counts' },
    { tool: 'create_prompt', category: 'Create & Edit', description: 'Create a new prompt template' },
    { tool: 'edit_prompt_content', category: 'Create & Edit', description: 'Edit template and arguments using string replacement' },
    { tool: 'update_prompt', category: 'Create & Edit', description: 'Update metadata, content, or arguments' },
  ]

  const tools = server === 'content' ? contentTools : promptTools

  // Group tools by category and calculate rowSpan
  const categoryGroups: { category: string; tools: typeof tools }[] = []
  let currentCategory = ''
  for (const tool of tools) {
    if (tool.category !== currentCategory) {
      categoryGroups.push({ category: tool.category, tools: [tool] })
      currentCategory = tool.category
    } else {
      categoryGroups[categoryGroups.length - 1].tools.push(tool)
    }
  }

  return (
    <div className="mb-8">
      <h2 className="text-base font-semibold text-gray-900 mb-2">Available MCP Tools</h2>
      <p className="text-gray-600 mb-4">
        Once connected, AI agents can use these tools:
      </p>

      {/* Mobile: Section/bullet format */}
      <div className="md:hidden space-y-4">
        {categoryGroups.map((group) => (
          <div key={group.category}>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              {group.category}
            </h4>
            <ul className="space-y-2 text-sm text-gray-600">
              {group.tools.map((item) => (
                <li key={item.tool} className="flex items-start gap-2">
                  <code className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800 text-xs flex-shrink-0">
                    {item.tool}
                  </code>
                  <span className="text-xs">{item.description}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Desktop: Table format */}
      <div className="hidden md:block overflow-hidden rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Category
              </th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Tool
              </th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Description
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {categoryGroups.map((group) =>
              group.tools.map((item, index) => (
                <tr key={item.tool}>
                  {index === 0 && (
                    <td
                      rowSpan={group.tools.length}
                      className="px-3 py-2 text-sm text-gray-500 whitespace-nowrap align-top border-r border-gray-200 bg-gray-50"
                    >
                      {group.category}
                    </td>
                  )}
                  <td className="px-3 py-2 text-sm">
                    <code className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">{item.tool}</code>
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-600">
                    {item.description}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// =============================================================================
// Skills Export Components
// =============================================================================

// Client type for skills export (subset that supports skills)
type SkillsClientType = 'claude-code' | 'claude-desktop' | 'codex'

/**
 * Multi-select tag dropdown for filtering which prompts to export as skills.
 */
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
 * Build the export URL for skills API endpoint.
 */
function buildSkillsExportUrl(client: SkillsClientType, selectedTags: string[]): string {
  const params = new URLSearchParams()
  params.append('client', client)
  selectedTags.forEach((tag) => params.append('tags', tag))
  return `${config.apiUrl}/prompts/export/skills?${params.toString()}`
}

/**
 * Claude Code skills configure instructions.
 */
interface ClaudeCodeSkillsInstructionsProps {
  exportUrl: string
}

function ClaudeCodeSkillsInstructions({ exportUrl }: ClaudeCodeSkillsInstructionsProps): ReactNode {
  const [copiedCommand, setCopiedCommand] = useState(false)

  const syncCommand = `mkdir -p ~/.claude/skills && curl -sH "Authorization: Bearer $PROMPTS_TOKEN" "${exportUrl}" | tar -xzf - -C ~/.claude/skills/`

  const handleCopyCommand = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(syncCommand)
      setCopiedCommand(true)
      setTimeout(() => setCopiedCommand(false), 2000)
    } catch {
      // Silent fail
    }
  }

  return (
    <div className="space-y-3">
      <StepCard number={3} title="Install Skills" subtitle="Run this command to install your skills">
        <div className="relative mt-2">
          <pre className="rounded bg-gray-50 px-3 py-2 text-xs text-gray-700 whitespace-pre-wrap overflow-x-auto font-mono pr-14">
            <code>{syncCommand}</code>
          </pre>
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
      </StepCard>

      <StepCard number={4} title="Use Your Skills">
        <p className="text-xs text-gray-500 mt-1">
          After syncing, Claude auto-invokes skills when relevant to your task.
          You can also trigger them manually with <code className="bg-gray-100 px-1 rounded">/skill-name</code>.
        </p>
        <p className="text-xs text-gray-400 mt-1">
          Tip: Add this command to a cron job or shell alias for regular syncing.
        </p>
      </StepCard>

      <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Sync Behavior</h3>
        <p className="text-sm text-gray-600">
          Syncing is <strong>additive</strong>: new skills are added and existing skills are updated,
          but skills are not deleted. To remove a skill, manually delete its folder from{' '}
          <code className="bg-gray-200 px-1 rounded text-xs">~/.claude/skills/</code>.
        </p>
      </div>
    </div>
  )
}

/**
 * Codex skills configure instructions.
 */
interface CodexSkillsInstructionsProps {
  exportUrl: string
}

function CodexSkillsInstructions({ exportUrl }: CodexSkillsInstructionsProps): ReactNode {
  const [copiedCommand, setCopiedCommand] = useState(false)

  const syncCommand = `mkdir -p ~/.codex/skills && curl -sH "Authorization: Bearer $PROMPTS_TOKEN" "${exportUrl}" | tar -xzf - -C ~/.codex/skills/`

  const handleCopyCommand = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(syncCommand)
      setCopiedCommand(true)
      setTimeout(() => setCopiedCommand(false), 2000)
    } catch {
      // Silent fail
    }
  }

  return (
    <div className="space-y-3">
      <StepCard number={3} title="Install Skills" subtitle="Run this command to install your skills">
        <div className="relative mt-2">
          <pre className="rounded bg-gray-50 px-3 py-2 text-xs text-gray-700 whitespace-pre-wrap overflow-x-auto font-mono pr-14">
            <code>{syncCommand}</code>
          </pre>
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
      </StepCard>

      <StepCard number={4} title="Use Your Skills">
        <p className="text-xs text-gray-500 mt-1">
          After syncing, invoke skills by typing <code className="bg-gray-100 px-1 rounded">$skill-name</code> in your prompt.
          Codex will also auto-select skills based on your task context.
        </p>
      </StepCard>

      <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Sync Behavior</h3>
        <p className="text-sm text-gray-600">
          Syncing is <strong>additive</strong>: new skills are added and existing skills are updated,
          but skills are not deleted. To remove a skill, manually delete its folder from{' '}
          <code className="bg-gray-200 px-1 rounded text-xs">~/.codex/skills/</code>.
        </p>
      </div>
    </div>
  )
}

/**
 * Claude Desktop skills configure instructions.
 */
interface ClaudeDesktopSkillsInstructionsProps {
  exportUrl: string
}

function ClaudeDesktopSkillsInstructions({ exportUrl }: ClaudeDesktopSkillsInstructionsProps): ReactNode {
  const [copiedCommand, setCopiedCommand] = useState(false)

  const downloadCommand = `curl -sH "Authorization: Bearer YOUR_PAT" "${exportUrl}" -o skills.zip`

  const handleCopyCommand = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(downloadCommand)
      setCopiedCommand(true)
      setTimeout(() => setCopiedCommand(false), 2000)
    } catch {
      // Silent fail
    }
  }

  return (
    <div className="space-y-3">
      <StepCard number={3} title="Download Zip File" subtitle="Run this command to download your skills">
        <div className="relative mt-2">
          <pre className="rounded bg-gray-50 px-3 py-2 text-xs text-gray-700 whitespace-pre-wrap overflow-x-auto font-mono pr-14">
            <code>{downloadCommand}</code>
          </pre>
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
        <p className="mt-2 text-xs text-gray-500">
          Replace <code className="bg-gray-100 px-1 rounded">YOUR_PAT</code> with your Personal Access Token from Step 1.
        </p>
      </StepCard>

      <StepCard number={4} title="Upload to Claude Desktop">
        <ol className="list-decimal list-inside text-xs text-gray-500 space-y-2 mt-1">
          <li>Unzip the downloaded <code className="bg-gray-100 px-1 rounded">skills.zip</code> file</li>
          <li>Open Claude Desktop and go to <strong>Settings → Capabilities</strong></li>
          <li>Drag and drop <strong>individual</strong> <code className="bg-gray-100 px-1 rounded">.md</code> files from the unzipped folder onto the Capabilities screen, or click <strong>+ Add</strong> to select them one at a time</li>
        </ol>
        <p className="mt-2 text-xs text-gray-400">
          Claude Desktop only accepts one skill per upload — repeat for each <code className="bg-gray-100 px-1 rounded">.md</code> file.
        </p>
      </StepCard>

      <StepCard number={5} title="Use Your Skills">
        <p className="text-xs text-gray-500 mt-1">
          Skills are invoked via natural language (e.g., &quot;use my code review skill&quot;).
          Claude will also auto-invoke them when relevant to your conversation.
        </p>
      </StepCard>
    </div>
  )
}

/**
 * Main skills export section component.
 */
interface SkillsExportSectionProps {
  client: SkillsClientType
}

/**
 * Compute default tags based on available tags.
 * Returns ['skill'] if 'skill' tag exists, ['skills'] if 'skills' tag exists, otherwise [].
 */
function getDefaultSkillTags(availableTags: TagCount[]): string[] {
  const tagNames = availableTags.map((t) => t.name)
  if (tagNames.includes('skill')) return ['skill']
  if (tagNames.includes('skills')) return ['skills']
  return []
}

function SkillsExportSection({ client }: SkillsExportSectionProps): ReactNode {
  const { isAuthenticated } = useAuthStatus()

  // Local state for prompt-only tags (don't use global store which has all tags)
  const [promptTags, setPromptTags] = useState<TagCount[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  // Fetch prompt tags on mount and apply default selection (only when authenticated to avoid 401 redirect)
  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false

    const fetchPromptTags = async (): Promise<void> => {
      try {
        const response = await api.get<TagListResponse>('/tags/?content_types=prompt')
        if (!cancelled) {
          const tags = response.data.tags
          setPromptTags(tags)
          // Apply default tag selection
          const defaultTags = getDefaultSkillTags(tags)
          if (defaultTags.length > 0) {
            setSelectedTags(defaultTags)
          }
        }
      } catch {
        // Silent fail - tags are optional
      }
    }
    fetchPromptTags()

    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  const exportUrl = buildSkillsExportUrl(client, selectedTags)

  return (
    <>
      {/* CLI tip */}
      <div className="mb-6 rounded-lg bg-blue-50 border border-blue-200 p-4">
        <p className="text-sm text-blue-800">
          <strong>Tip:</strong> If you have the Tiddly CLI installed, run{' '}
          <code className="bg-blue-100 px-1 rounded">tiddly skills configure {client}</code> instead.
          See <Link to="/docs/cli/skills" className="text-[#d97b3d] hover:underline">CLI docs</Link>.
        </p>
      </div>

      {/* Client-specific notes */}
      {(client === 'claude-code' || client === 'claude-desktop') && (
        <div className="mb-6 rounded-lg bg-amber-50 border border-amber-200 p-4">
          <p className="text-sm text-amber-800">
            <strong>Note:</strong> Prompt names longer than 64 characters will be truncated for {client === 'claude-code' ? 'Claude Code' : 'Claude Desktop'}.
          </p>
        </div>
      )}
      {client === 'codex' && (
        <div className="mb-6 rounded-lg bg-amber-50 border border-amber-200 p-4">
          <p className="text-sm text-amber-800">
            <strong>Note:</strong> Multi-line descriptions will be collapsed to a single line for Codex compatibility.
          </p>
        </div>
      )}

      <div className="space-y-3">
        <StepCard number={1} title="Create a Personal Access Token" subtitle={`Set it as the PROMPTS_TOKEN environment variable`}>
          <Link
            to="/app/settings/tokens"
            className="btn-primary inline-flex items-center gap-2 mt-2"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Create Token
          </Link>
        </StepCard>

        <StepCard number={2} title="Filter by Tags (Optional)" subtitle="Select which prompts to export. Leave empty to export all.">
          <div className="mt-2">
            <SkillsTagSelector
              availableTags={promptTags}
              selectedTags={selectedTags}
              onChange={setSelectedTags}
            />
          </div>
        </StepCard>

        {/* Client-specific instructions (steps 3+) */}
        {client === 'claude-code' && <ClaudeCodeSkillsInstructions exportUrl={exportUrl} />}
        {client === 'codex' && <CodexSkillsInstructions exportUrl={exportUrl} />}
        {client === 'claude-desktop' && <ClaudeDesktopSkillsInstructions exportUrl={exportUrl} />}
      </div>
    </>
  )
}

/**
 * Manual setup section — the existing PyTorch-style selector and step-by-step
 * instructions using Personal Access Tokens and curl commands.
 */
function ManualSetupSection(): ReactNode {
  // Selector state
  const [server, setServer] = useState<ServerType>('content')
  const [client, setClient] = useState<ClientType>('claude-desktop')
  const [auth, setAuth] = useState<AuthType>('bearer')
  const [integration, setIntegration] = useState<IntegrationType>('mcp')

  // Helper flags
  const isSkills = integration === 'skills'
  const isSkillsClient = client === 'claude-desktop' || client === 'claude-code' || client === 'codex'
  const isMcpSupported = auth === 'bearer' && integration === 'mcp' && isSkillsClient
  const isSkillsSupported = isSkills && isSkillsClient && server === 'prompts'

  const getComingSoonContent = (): { title: string; description: string } | null => {
    if (integration === 'mcp') {
      if (client === 'chatgpt') {
        return {
          title: 'ChatGPT Integration Coming Soon',
          description: 'ChatGPT requires OAuth authentication. OAuth implementation is coming soon.',
        }
      }
      if (client === 'gemini-cli') {
        return {
          title: 'Gemini CLI Integration Coming Soon',
          description: 'Gemini CLI MCP integration instructions are coming soon.',
        }
      }
      if (auth === 'oauth') {
        return {
          title: 'OAuth Coming Soon',
          description: 'OAuth authentication will allow secure browser-based login without needing to manage tokens manually. Coming soon.',
        }
      }
    }
    if (isSkills && server === 'content') {
      return {
        title: 'Skills Only Apply to Prompts',
        description: 'Skills are exported from your prompt templates. Select "Prompts" to export your prompt templates as skills.',
      }
    }
    if (isSkills && !isSkillsClient) {
      return {
        title: `${client === 'chatgpt' ? 'ChatGPT' : 'Gemini CLI'} Skills Coming Soon`,
        description: `Skills export for ${client === 'chatgpt' ? 'ChatGPT' : 'Gemini CLI'} is not yet supported.`,
      }
    }
    return null
  }

  const comingSoonContent = getComingSoonContent()

  const manualServerOptions: SelectorOption<ServerType>[] = [
    { value: 'content', label: 'Bookmarks & Notes', comingSoon: isSkills },
    { value: 'prompts', label: 'Prompts' },
  ]

  const handleIntegrationChange = (newIntegration: IntegrationType): void => {
    setIntegration(newIntegration)
    if (newIntegration === 'skills') {
      setServer('prompts')
    }
  }

  const clientOptions: SelectorOption<ClientType>[] = [
    { value: 'claude-desktop', label: 'Claude Desktop' },
    { value: 'claude-code', label: 'Claude Code' },
    { value: 'chatgpt', label: 'ChatGPT', comingSoon: true },
    { value: 'codex', label: 'Codex' },
    { value: 'gemini-cli', label: 'Gemini CLI', comingSoon: true },
  ]

  const authOptions: SelectorOption<AuthType>[] = [
    { value: 'bearer', label: 'Bearer Token', comingSoon: client === 'chatgpt' },
    { value: 'oauth', label: 'OAuth', comingSoon: true },
  ]

  const integrationOptions: SelectorOption<IntegrationType>[] = [
    { value: 'mcp', label: 'MCP Server' },
    { value: 'skills', label: 'Skills' },
  ]

  return (
    <div data-testid="manual-setup-section">
      <p className="text-sm text-gray-500 mb-6">
        Step-by-step instructions for configuring MCP servers and skills using Personal Access Tokens and curl commands.
        Note: this approach requires manually creating PATs and setting up each server/tool individually.
        For a faster setup, use the CLI tab above.
      </p>

      {/* Config Selector */}
      <div className="mb-8">
        <h3 className="text-base font-bold text-gray-900 mb-4">Select Integration</h3>
        <div className="md:border-l-4 md:border-l-[#f09040] bg-white py-1.5 flex flex-col gap-4 md:gap-1.5">
          <SelectorRow
            label="Integration"
            options={integrationOptions}
            value={integration}
            onChange={handleIntegrationChange}
          />
          <SelectorRow
            label="Content"
            options={manualServerOptions}
            value={server}
            onChange={setServer}
          />
          <SelectorRow
            label="Client"
            options={clientOptions}
            value={client}
            onChange={setClient}
          />
          {!isSkills && (
            <SelectorRow
              label="Auth"
              options={authOptions}
              value={auth}
              onChange={setAuth}
            />
          )}
        </div>
      </div>

      {/* Integration explanation */}
      {integration === 'mcp' && (
        <div className="mb-8 rounded-lg bg-gray-50 border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">What is MCP?</h3>
          <p className="text-sm text-gray-600">
            The <a href="https://modelcontextprotocol.io/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Model Context Protocol (MCP)</a> is
            an open standard that allows AI assistants to securely access external tools and data.
            By connecting your bookmarks, notes, and prompts via MCP, AI agents can search your content,
            create new items, and use your prompt templates directly.
          </p>
        </div>
      )}
      {integration === 'skills' && (
        <div className="mb-8 rounded-lg bg-gray-50 border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">What are Skills?</h3>
          <p className="text-sm text-gray-600">
            Skills are reusable instruction files that AI agents auto-invoke based on context
            or that you trigger manually. Export your prompts as skills and sync them to your AI client.
            Skills follow the <a href="https://agentskills.io/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Agent Skills Standard</a>.
          </p>
        </div>
      )}

      {/* Setup Instructions */}
      <div className="mb-6">
        <h3 className="text-base font-bold text-gray-900 mb-4">Setup Instructions</h3>
      </div>

      {comingSoonContent && (
        <ComingSoon title={comingSoonContent.title} description={comingSoonContent.description} />
      )}

      {isMcpSupported && client === 'claude-desktop' && (
        <ClaudeDesktopInstructions server={server} mcpUrl={config.mcpUrl} promptMcpUrl={config.promptMcpUrl} />
      )}
      {isMcpSupported && client === 'claude-code' && (
        <ClaudeCodeInstructions server={server} mcpUrl={config.mcpUrl} promptMcpUrl={config.promptMcpUrl} />
      )}
      {isMcpSupported && client === 'codex' && (
        <CodexInstructions server={server} mcpUrl={config.mcpUrl} promptMcpUrl={config.promptMcpUrl} />
      )}

      {isSkillsSupported && (
        <SkillsExportSection client={client as SkillsClientType} />
      )}

      {isMcpSupported && <div className="mt-8"><AvailableTools server={server} /></div>}
    </div>
  )
}

/**
 * Reusable AI setup widget with CLI and manual (Curl/PAT) tabs.
 * Renders the full interactive setup experience without page title or heading.
 */
export function AISetupWidget(): ReactNode {
  const [activeTab, setActiveTab] = useState<SetupTab>('cli')

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

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 mb-6">
        <button
          type="button"
          onClick={() => setActiveTab('cli')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'cli'
              ? 'border-[#f09040] text-[#d97b3d]'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          Setup via CLI (Recommended)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('manual')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'manual'
              ? 'border-[#f09040] text-[#d97b3d]'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          Setup via Curl/PAT
        </button>
      </div>

      {activeTab === 'cli' && <CLISetupSection />}
      {activeTab === 'manual' && <ManualSetupSection />}
    </div>
  )
}

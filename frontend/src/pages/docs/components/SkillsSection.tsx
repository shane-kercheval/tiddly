import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useAuthStatus } from '../../../hooks/useAuthStatus'
import { api } from '../../../services/api'
import type { TagCount, TagListResponse } from '../../../types'
import { config } from '../../../config'
import { SkillsTagSelector } from './SkillsTagSelector'
import { CopyableCodeBlock } from './CopyableCodeBlock'
import { InfoCallout } from './InfoCallout'

type SkillsClientType = 'claude-code' | 'codex' | 'claude-desktop'

interface SkillsSectionProps {
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

/**
 * Build the export URL for skills API endpoint.
 */
function buildSkillsExportUrl(client: SkillsClientType, selectedTags: string[]): string {
  const params = new URLSearchParams()
  params.append('client', client)
  selectedTags.forEach((tag) => params.append('tags', tag))
  return `${config.apiUrl}/prompts/export/skills?${params.toString()}`
}

const CLIENT_LABELS: Record<SkillsClientType, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'claude-desktop': 'Claude Desktop',
}

const SKILLS_DIR: Record<SkillsClientType, string> = {
  'claude-code': '~/.claude/skills/',
  codex: '~/.codex/skills/',
  'claude-desktop': '',
}

const INVOKE_SYNTAX: Record<SkillsClientType, string> = {
  'claude-code': '/skill-name',
  codex: '$skill-name',
  'claude-desktop': '"use my skill-name skill"',
}

/**
 * Skills section for client pages. Handles auth check for tag filtering.
 * When not authenticated, skips API calls and shows default export URL.
 */
export function SkillsSection({ client }: SkillsSectionProps): ReactNode {
  const { isAuthenticated } = useAuthStatus()
  const [promptTags, setPromptTags] = useState<TagCount[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  useEffect(() => {
    // Skip API calls when not authenticated to avoid triggering auth interceptor
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
  const clientLabel = CLIENT_LABELS[client]

  return (
    <div className="mt-12 border-t border-gray-200 pt-8">
      <h2 className="text-xl font-bold text-gray-900 mb-4">Agent Skills</h2>
      <p className="text-gray-600 mb-6">
        Skills are reusable instruction files exported from your prompt templates.
        {client === 'claude-code'
          ? ' Claude Code can auto-invoke them or you can use them as slash commands.'
          : client === 'codex'
            ? ' Codex auto-selects them based on task context.'
            : ' Claude Desktop invokes them via natural language.'}
      </p>

      {/* Client-specific notes */}
      {(client === 'claude-code' || client === 'claude-desktop') && (
        <InfoCallout variant="warning">
          <strong>Note:</strong> Prompt names longer than 64 characters will be truncated for {clientLabel}.
        </InfoCallout>
      )}
      {client === 'codex' && (
        <InfoCallout variant="warning">
          <strong>Note:</strong> Multi-line descriptions will be collapsed to a single line for Codex compatibility.
        </InfoCallout>
      )}

      {/* Filter by Tags */}
      <div className="mt-6 mb-6">
        <h3 className="text-base font-semibold text-gray-900 mb-2">
          Filter by Tags (Optional)
        </h3>
        {isAuthenticated ? (
          <>
            <p className="text-gray-600 mb-3">
              Select which prompts to export. If no tags are selected, all prompts will be exported.
            </p>
            <SkillsTagSelector
              availableTags={promptTags}
              selectedTags={selectedTags}
              onChange={setSelectedTags}
            />
          </>
        ) : (
          <p className="text-gray-500 text-sm">
            <a href="/app/settings/tokens" className="text-[#d97b3d] hover:underline">Log in</a> to filter by tags. All prompts will be exported by default.
          </p>
        )}
      </div>

      {/* Sync/Download Command */}
      <div className="mb-6">
        <h3 className="text-base font-semibold text-gray-900 mb-2">
          {client === 'claude-desktop' ? 'Download Skills' : 'Sync Skills'}
        </h3>
        <p className="text-gray-600 mb-3">
          {client === 'claude-desktop'
            ? 'Run this command to download your skills:'
            : 'Run this command to download and install your skills:'}
        </p>
        {client === 'claude-desktop' ? (
          <CopyableCodeBlock
            code={`curl -sH "Authorization: Bearer YOUR_PAT" "${exportUrl}" -o skills.zip`}
          />
        ) : (
          <CopyableCodeBlock
            code={`mkdir -p ${SKILLS_DIR[client]} && curl -sH "Authorization: Bearer $PROMPTS_TOKEN" "${exportUrl}" | tar -xzf - -C ${SKILLS_DIR[client]}`}
          />
        )}
        {client === 'claude-desktop' && (
          <p className="mt-2 text-sm text-gray-500">
            Replace <code className="bg-gray-100 px-1 rounded">YOUR_PAT</code> with your Personal Access Token.
          </p>
        )}
      </div>

      {/* Usage */}
      <div className="mb-6">
        <h3 className="text-base font-semibold text-gray-900 mb-2">Usage</h3>
        {client === 'claude-desktop' ? (
          <>
            <ol className="list-decimal list-inside text-gray-600 space-y-2 mb-3">
              <li>Unzip the downloaded <code className="bg-gray-100 px-1 rounded">skills.zip</code> file</li>
              <li>Open Claude Desktop and go to <strong>Settings &rarr; Capabilities</strong></li>
              <li>Drag and drop individual <code className="bg-gray-100 px-1 rounded">.md</code> files onto the Capabilities screen</li>
            </ol>
            <p className="text-sm text-gray-500">
              Claude Desktop only accepts one skill per upload — repeat for each file.
            </p>
          </>
        ) : (
          <p className="text-gray-600">
            After syncing, invoke skills with <code className="bg-gray-100 px-1 rounded">{INVOKE_SYNTAX[client]}</code>.
            {clientLabel} will also auto-invoke them when relevant to your task.
          </p>
        )}
      </div>

      {/* Sync behavior note */}
      {client !== 'claude-desktop' && (
        <InfoCallout variant="tip" title="Sync Behavior">
          Syncing is <strong>additive</strong>: new skills are added and existing skills are updated,
          but skills are not deleted. To remove a skill, manually delete its folder from{' '}
          <code className="bg-gray-200 px-1 rounded text-xs">{SKILLS_DIR[client]}</code>.
        </InfoCallout>
      )}
    </div>
  )
}

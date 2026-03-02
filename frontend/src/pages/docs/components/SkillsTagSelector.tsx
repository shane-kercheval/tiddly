import { useState, useEffect, useRef } from 'react'
import type { ReactNode, KeyboardEvent } from 'react'
import type { TagCount } from '../../../types'

interface SkillsTagSelectorProps {
  availableTags: TagCount[]
  selectedTags: string[]
  onChange: (tags: string[]) => void
}

/**
 * Multi-select tag dropdown for filtering which prompts to export as skills.
 * Migrated from SettingsMCP.tsx.
 */
export function SkillsTagSelector({
  availableTags,
  selectedTags,
  onChange,
}: SkillsTagSelectorProps): ReactNode {
  const [isOpen, setIsOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filteredTags = availableTags.filter(
    (tag) => tag.name.toLowerCase().includes(inputValue.toLowerCase())
  )

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

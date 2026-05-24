import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Pricing } from './Pricing'
import tiersData from '../content/data/tiers.json'

/**
 * The Pricing page renders tier numbers sourced from tiers.json (KAN-154 single
 * source). These assertions pin the *displayed* values to the JSON, so a
 * re-hardcoded number that diverges from the canonical file fails here.
 */
describe('Pricing — values sourced from tiers.json', () => {
  const renderPricing = (): void => {
    render(
      <MemoryRouter>
        <Pricing />
      </MemoryRouter>,
    )
  }

  it('renders item caps from the file, with Pro shown as Unlimited', () => {
    renderPricing()
    const { free, standard, pro } = tiersData
    // Free/Standard show the real numbers (appear in both card and table).
    expect(screen.getAllByText(String(standard.max_bookmarks)).length).toBeGreaterThan(0) // 250
    expect(screen.getAllByText(String(free.max_prompts)).length).toBeGreaterThan(0) // 5
    // Pro is flagged unlimited_items → "Unlimited", not the enforced 10000.
    expect(pro.unlimited_items).toBe(true)
    expect(screen.getAllByText('Unlimited').length).toBeGreaterThan(0)
    expect(screen.queryByText(pro.max_bookmarks.toLocaleString())).toBeNull() // never shows "10,000"
  })

  it('renders content/PAT/AI/retention values from the file', () => {
    renderPricing()
    const { free, pro } = tiersData
    expect(screen.getByText(free.max_bookmark_content_length.toLocaleString())).toBeInTheDocument() // 25,000
    expect(screen.getByText(pro.max_bookmark_content_length.toLocaleString())).toBeInTheDocument() // 100,000
    expect(screen.getByText(`${pro.rate_ai_per_day.toLocaleString()} calls/day`)).toBeInTheDocument() // 500 calls/day
    expect(screen.getByText(`${pro.rate_ai_byok_per_day.toLocaleString()} calls/day`)).toBeInTheDocument() // 2,000 calls/day
    expect(screen.getByText(`${pro.history_retention_days} days`)).toBeInTheDocument() // 15 days
    expect(screen.getByText(`${free.max_pats} API tokens`)).toBeInTheDocument() // 3 API tokens
  })
})

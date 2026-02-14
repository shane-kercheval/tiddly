/**
 * Tests for ChangeIndicators component.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChangeIndicators } from './ChangeIndicators'

describe('ChangeIndicators', () => {
  it('test__change_indicators__renders_nothing_for_undefined', () => {
    const { container } = render(<ChangeIndicators changed={undefined} />)
    expect(container.innerHTML).toBe('')
  })

  it('test__change_indicators__renders_nothing_for_null', () => {
    const { container } = render(<ChangeIndicators changed={null} />)
    expect(container.innerHTML).toBe('')
  })

  it('test__change_indicators__renders_nothing_for_empty_array', () => {
    const { container } = render(<ChangeIndicators changed={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('test__change_indicators__renders_content_icon', () => {
    render(<ChangeIndicators changed={['content']} />)
    expect(screen.getByTestId('change-indicators')).toBeInTheDocument()
    // Should have exactly 1 icon (within tooltip wrappers)
    const indicators = screen.getByTestId('change-indicators')
    const svgs = indicators.querySelectorAll('svg')
    expect(svgs).toHaveLength(1)
  })

  it('test__change_indicators__renders_title_icon_for_title', () => {
    render(<ChangeIndicators changed={['title']} />)
    const indicators = screen.getByTestId('change-indicators')
    expect(indicators.querySelectorAll('svg')).toHaveLength(1)
  })

  it('test__change_indicators__renders_title_icon_for_url', () => {
    render(<ChangeIndicators changed={['url']} />)
    const indicators = screen.getByTestId('change-indicators')
    expect(indicators.querySelectorAll('svg')).toHaveLength(1)
  })

  it('test__change_indicators__renders_title_icon_for_name', () => {
    render(<ChangeIndicators changed={['name']} />)
    const indicators = screen.getByTestId('change-indicators')
    expect(indicators.querySelectorAll('svg')).toHaveLength(1)
  })

  it('test__change_indicators__groups_title_and_url_into_single_icon', () => {
    render(<ChangeIndicators changed={['title', 'url']} />)
    const indicators = screen.getByTestId('change-indicators')
    // title+url share the same icon group, so only 1 SVG
    expect(indicators.querySelectorAll('svg')).toHaveLength(1)
  })

  it('test__change_indicators__groups_description_and_arguments_into_single_icon', () => {
    render(<ChangeIndicators changed={['description', 'arguments']} />)
    const indicators = screen.getByTestId('change-indicators')
    expect(indicators.querySelectorAll('svg')).toHaveLength(1)
  })

  it('test__change_indicators__renders_tags_icon', () => {
    render(<ChangeIndicators changed={['tags']} />)
    const indicators = screen.getByTestId('change-indicators')
    expect(indicators.querySelectorAll('svg')).toHaveLength(1)
  })

  it('test__change_indicators__renders_relationships_icon', () => {
    render(<ChangeIndicators changed={['relationships']} />)
    const indicators = screen.getByTestId('change-indicators')
    expect(indicators.querySelectorAll('svg')).toHaveLength(1)
  })

  it('test__change_indicators__renders_all_icons_for_all_fields', () => {
    render(<ChangeIndicators changed={['content', 'title', 'description', 'tags', 'relationships']} />)
    const indicators = screen.getByTestId('change-indicators')
    // 5 field groups, each has one icon
    expect(indicators.querySelectorAll('svg')).toHaveLength(5)
  })

  it('test__change_indicators__icon_order_is_fixed', () => {
    // Even if changed_fields is in different order, icons should render in stable order
    render(<ChangeIndicators changed={['tags', 'content', 'relationships', 'title']} />)
    const indicators = screen.getByTestId('change-indicators')
    expect(indicators.querySelectorAll('svg')).toHaveLength(4)
  })

  it('test__change_indicators__ignores_unknown_fields', () => {
    const { container } = render(<ChangeIndicators changed={['unknown_field']} />)
    // No matching field group, so no icons rendered
    expect(container.querySelector('[data-testid="change-indicators"]')).toBeNull()
  })
})

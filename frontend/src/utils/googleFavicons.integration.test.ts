/**
 * Integration tests for Google favicon URLs.
 *
 * These tests verify that the Google favicon URLs are still accessible.
 * If Google changes their favicon URLs, these tests will fail, alerting us
 * to update GOOGLE_FAVICON_URLS in utils.ts.
 *
 * Run with: npm run test:run -- src/utils/googleFavicons.integration.test.ts
 */
import { describe, it, expect } from 'vitest'
import { GOOGLE_FAVICON_URLS, type GoogleProduct } from '../utils'

describe('Google favicon URL validation', () => {
  // These tests make real HTTP requests to verify URLs are accessible
  // They are tagged to allow selective running in CI

  const testCases: Array<{ product: GoogleProduct; description: string }> = [
    { product: 'docs', description: 'Google Docs favicon' },
    { product: 'sheets', description: 'Google Sheets favicon' },
    { product: 'slides', description: 'Google Slides favicon' },
    { product: 'gmail', description: 'Gmail favicon' },
  ]

  testCases.forEach(({ product, description }) => {
    it(`test__google_favicon_url__${product}_is_accessible`, async () => {
      const url = GOOGLE_FAVICON_URLS[product]

      // Use fetch with HEAD request to check URL accessibility
      const response = await fetch(url, { method: 'HEAD' })

      expect(
        response.ok,
        `${description} URL returned ${response.status}: ${url}\n` +
        'If this test fails, Google may have changed their favicon URLs. ' +
        'Update GOOGLE_FAVICON_URLS in utils.ts with the new URLs.'
      ).toBe(true)
    })
  })

  it('test__google_favicon_urls__all_return_image_content_type', async () => {
    for (const [product, url] of Object.entries(GOOGLE_FAVICON_URLS)) {
      const response = await fetch(url, { method: 'HEAD' })
      const contentType = response.headers.get('content-type') || ''

      // Should return an image type (ico, png, or x-icon)
      expect(
        contentType.includes('image') || contentType.includes('icon'),
        `${product} favicon should return image content-type, got: ${contentType}`
      ).toBe(true)
    }
  })
})

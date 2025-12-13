import { describe, it, expect } from 'vitest'
import { config, isDevMode } from './config'

describe('config', () => {
  it('should have apiUrl defined', () => {
    expect(config.apiUrl).toBeDefined()
    expect(typeof config.apiUrl).toBe('string')
  })

  it('should have auth0 config object', () => {
    expect(config.auth0).toBeDefined()
    expect(config.auth0).toHaveProperty('domain')
    expect(config.auth0).toHaveProperty('clientId')
    expect(config.auth0).toHaveProperty('audience')
  })
})

describe('isDevMode', () => {
  it('should be true when auth0 domain is not configured', () => {
    // In test environment, VITE_AUTH0_DOMAIN is not set, so isDevMode should be true
    expect(isDevMode).toBe(true)
  })
})

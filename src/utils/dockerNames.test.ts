import { describe, it, expect } from 'vitest'
import { generateDockerStyleName } from './dockerNames'

describe('generateDockerStyleName', () => {
  it('returns a lowercase adjective_noun format', () => {
    const name = generateDockerStyleName()
    expect(typeof name).toBe('string')
    expect(name).toMatch(/^[a-z]+_[a-z]+$/)
  })

  it('generates plausible variety across multiple calls', () => {
    const results = new Set<string>()
    for (let i = 0; i < 10; i++) {
      results.add(generateDockerStyleName())
    }
    // We don't assume uniqueness, but expect at least a few variants
    expect(results.size).toBeGreaterThan(1)
  })
})

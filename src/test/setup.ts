import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'

// Setup global test environment
beforeEach(() => {
  localStorage.clear()
})
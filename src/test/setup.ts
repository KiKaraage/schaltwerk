import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'

// Setup global test environment
beforeEach(() => {
  localStorage.clear()
})
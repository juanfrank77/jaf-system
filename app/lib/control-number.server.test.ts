import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the db module before importing the function
vi.mock('./db.server', () => ({
  db: {
    jafControlDoc: {
      count: vi.fn(),
    },
  },
}))

import { generateControlNumber } from './control-number.server'
import { db } from './db.server'

describe('generateControlNumber', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns MAINT-YYMMDD-001 for first doc of the day', async () => {
    vi.mocked(db.jafControlDoc.count).mockResolvedValue(0)
    const result = await generateControlNumber('2026-06-15')
    expect(result).toBe('MAINT-260615-001')
  })

  it('increments sequence when docs already exist today', async () => {
    vi.mocked(db.jafControlDoc.count).mockResolvedValue(4)
    const result = await generateControlNumber('2026-06-15')
    expect(result).toBe('MAINT-260615-005')
  })

  it('pads sequence to 3 digits', async () => {
    vi.mocked(db.jafControlDoc.count).mockResolvedValue(99)
    const result = await generateControlNumber('2026-06-15')
    expect(result).toBe('MAINT-260615-100')
  })
})


import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ScraperPanel from '../ScraperPanel'
import type { ScraperStatus } from '../../../types/api'

vi.mock('../../../services/api', () => ({
  fetchScraperStatus: vi.fn(),
  fetchScraperCandidates: vi.fn(),
  fetchScraperRuns: vi.fn(),
  triggerScraperRun: vi.fn(),
  stopScraperRun: vi.fn(),
  approveScraperCandidate: vi.fn(),
  rejectScraperCandidate: vi.fn(),
}))

import {
  fetchScraperStatus,
  fetchScraperRuns,
  triggerScraperRun,
} from '../../../services/api'

const mockFetchStatus = vi.mocked(fetchScraperStatus)
const mockFetchRuns = vi.mocked(fetchScraperRuns)
const mockTriggerRun = vi.mocked(triggerScraperRun)

// Minimal valid ScraperStatus — all required fields present
const fakeStatus: ScraperStatus = {
  scheduler: { running: false, jobs: [] },
  enabled_sources: ['openAlex'],
  candidates: { pending: 0, approved: 0, rejected: 0 },
  last_run: null,
  current_run: null,
  current_log_tail: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchRuns.mockResolvedValue({ count: 0, runs: [] })
})

describe('ScraperPanel', () => {
  it('shows a loading spinner before status resolves', () => {
    mockFetchStatus.mockReturnValue(new Promise(() => {})) // never resolves
    render(<ScraperPanel />)
    expect(screen.getByText('Loading scraper status…')).toBeInTheDocument()
  })

  it('shows "Run Now" button once status has loaded', async () => {
    const statusPromise = Promise.resolve(fakeStatus)
    mockFetchStatus.mockReturnValue(statusPromise)
    render(<ScraperPanel />)
    await act(async () => { await statusPromise })
    expect(screen.getByRole('button', { name: /run now/i })).toBeInTheDocument()
  })

  it('calls triggerScraperRun through the cookie-authenticated API when Run Now is clicked', async () => {
    const statusPromise = Promise.resolve(fakeStatus)
    mockFetchStatus.mockReturnValue(statusPromise)
    mockTriggerRun.mockResolvedValue({ status: 'started', message: 'Run started' })
    render(<ScraperPanel />)
    await act(async () => { await statusPromise })
    await userEvent.click(screen.getByRole('button', { name: /run now/i }))
    expect(mockTriggerRun).toHaveBeenCalledWith()
  })

  it('displays an error message when status fetch fails', async () => {
    mockFetchStatus.mockRejectedValue(new Error('Failed to load scraper status.'))
    render(<ScraperPanel />)
    await waitFor(() => {
      expect(screen.getByText('Failed to load scraper status.')).toBeInTheDocument()
    })
  })
})

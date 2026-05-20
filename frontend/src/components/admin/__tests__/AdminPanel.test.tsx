import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminPanel from '../AdminPanel'
import type { SubmissionRecord } from '../../../types/api'

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../../../services/api', () => ({
  fetchAdminSubmissions: vi.fn(),
  actOnSubmission: vi.fn(),
  fetchAdminCatalogueTechnologies: vi.fn(),
  adminEditTechnology: vi.fn(),
  adminDeleteTechnology: vi.fn(),
  fetchAdminProfileSubmissions: vi.fn(),
  actOnProfileSubmission: vi.fn(),
  fetchAdminProfileSubmissionData: vi.fn(),
}))

vi.mock('../../../services/timeseries', () => ({
  deleteTimeSeriesProfile: vi.fn(),
  invalidateTimeSeriesCatalogue: vi.fn(),
}))

vi.mock('echarts', () => ({
  init: vi.fn(() => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() })),
}))

vi.mock('../ScraperPanel', () => ({
  default: () => <div data-testid="scraper-panel" />,
}))

import { useAuth } from '../../../context/AuthContext'
import { fetchAdminSubmissions, fetchAdminProfileSubmissions } from '../../../services/api'

const mockUseAuth = vi.mocked(useAuth)
const mockFetchSubmissions = vi.mocked(fetchAdminSubmissions)
const mockFetchProfileSubmissions = vi.mocked(fetchAdminProfileSubmissions)

const adminAuth = {
  user: { id: 'u1', username: 'admin', email: 'admin@test.com', auth_provider: 'admin', is_contributor: false, is_admin: true },
  token: 'test-token',
  isAdmin: true,
  isLoading: false,
  signIn: vi.fn(),
  signOut: vi.fn(),
}

function makeSubmission(overrides: Partial<SubmissionRecord> = {}): SubmissionRecord {
  return {
    submission_id: 'sub-1',
    technology_name: 'Solar PV',
    submitted_at: '2024-01-01T00:00:00Z',
    status: 'pending_review',
    domain: 'generation',
    oeo_class: null,
    description: null,
    submitter_email: null,
    rejection_reason: null,
    pr_url: null,
    filename: '',
    payload: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchSubmissions.mockResolvedValue([])
  mockFetchProfileSubmissions.mockResolvedValue([])
})

describe('AdminPanel', () => {
  it('shows "Sign in to access this page" when not logged in', () => {
    mockUseAuth.mockReturnValue({ ...adminAuth, isAdmin: false, user: null, token: null })
    render(<AdminPanel />)
    expect(screen.getByText('Sign in to access this page')).toBeInTheDocument()
  })

  it('shows "Admin access required" when logged in but not admin', () => {
    mockUseAuth.mockReturnValue({
      ...adminAuth,
      isAdmin: false,
      user: { id: 'u2', username: 'user', email: 'user@test.com', auth_provider: 'email', is_contributor: false, is_admin: false },
    })
    render(<AdminPanel />)
    expect(screen.getByText('Admin access required')).toBeInTheDocument()
  })

  it('shows Approve and Reject buttons for a pending submission', async () => {
    mockUseAuth.mockReturnValue(adminAuth)
    mockFetchSubmissions.mockResolvedValue([makeSubmission()])
    render(<AdminPanel />)
    await screen.findByText('Solar PV')
    expect(screen.getAllByRole('button', { name: /approve$/i })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /reject$/i })).toHaveLength(1)
  })

  it('shows a GitHub PR link in the expanded view for an approved submission', async () => {
    mockUseAuth.mockReturnValue(adminAuth)
    mockFetchSubmissions.mockResolvedValue([
      makeSubmission({ status: 'approved', pr_url: 'https://github.com/org/repo/pull/42' }),
    ])
    render(<AdminPanel />)
    await screen.findByText('Solar PV')
    // The pr_url link lives inside the expanded card — click "Expand details" first
    await userEvent.click(screen.getByRole('button', { name: /expand details/i }))
    const link = screen.getByRole('link', { name: /view github pr/i })
    expect(link).toHaveAttribute('href', 'https://github.com/org/repo/pull/42')
  })

  it('displays an error message when submissions fail to load', async () => {
    mockUseAuth.mockReturnValue(adminAuth)
    mockFetchSubmissions.mockRejectedValue(new Error('Network error'))
    render(<AdminPanel />)
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })
})

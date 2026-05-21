import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import OAuthCallback from '../OAuthCallback'

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '../../../context/AuthContext'

const mockUseAuth = vi.mocked(useAuth)

const stableSignIn = vi.fn()
const stableOnAuthError = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockUseAuth.mockReturnValue({
    user: null,
    token: null,
    isLoading: false,
    isAdmin: false,
    signIn: stableSignIn,
    signOut: vi.fn(),
  })
})

afterEach(() => {
  // Restore clean URL after each test
  window.history.replaceState(null, '', '/')
})

describe('OAuthCallback', () => {
  it('calls signIn and strips ?token= from the URL on mount', () => {
    window.history.replaceState(null, '', '/?token=abc123')
    render(<OAuthCallback />)
    expect(stableSignIn).toHaveBeenCalledOnce()
    expect(stableSignIn).toHaveBeenCalledWith('abc123')
    expect(window.location.search).toBe('')
  })

  it('calls onAuthError and strips ?auth_error= from the URL on mount', () => {
    window.history.replaceState(null, '', '/?auth_error=orcid_denied')
    render(<OAuthCallback onAuthError={stableOnAuthError} />)
    expect(stableOnAuthError).toHaveBeenCalledOnce()
    expect(stableOnAuthError).toHaveBeenCalledWith(
      'ORCID login was cancelled. Please try again.'
    )
    expect(window.location.search).toBe('')
  })

  it('uses a generic message for unknown auth_error codes', () => {
    window.history.replaceState(null, '', '/?auth_error=something_weird')
    render(<OAuthCallback onAuthError={stableOnAuthError} />)
    expect(stableOnAuthError).toHaveBeenCalledWith(
      'Authentication failed. Please try again.'
    )
  })

  it('does nothing when URL has no relevant params', () => {
    window.history.replaceState(null, '', '/?unrelated=1')
    render(<OAuthCallback />)
    expect(stableSignIn).not.toHaveBeenCalled()
    expect(window.location.search).toBe('?unrelated=1')
  })

  it('preserves unrelated query params after stripping token', () => {
    window.history.replaceState(null, '', '/?token=abc&other=1')
    render(<OAuthCallback />)
    expect(window.location.search).toBe('?other=1')
  })

  it('only runs once — does not re-fire on parent re-render', () => {
    window.history.replaceState(null, '', '/?token=abc123')
    const { rerender } = render(<OAuthCallback />)
    rerender(<OAuthCallback />)
    rerender(<OAuthCallback />)
    // signIn should only be called once despite multiple renders
    expect(stableSignIn).toHaveBeenCalledOnce()
  })
})

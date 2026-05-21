import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ErrorBoundary from '../ErrorBoundary'

// A child that throws on demand
function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('boom')
  return <div>safe content</div>
}

// Silence the React error boundary console.error noise in test output
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>
    )
    expect(screen.getByText('safe content')).toBeInTheDocument()
  })

  it('renders the error fallback when a child throws', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>
    )
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('includes the context label in the error message', () => {
    render(
      <ErrorBoundary context="generation">
        <Bomb shouldThrow />
      </ErrorBoundary>
    )
    expect(screen.getByText(/failed to load generation/i)).toBeInTheDocument()
  })

  it('calls onRetry before resetting when Try Again is clicked', async () => {
    const onRetry = vi.fn()
    render(
      <ErrorBoundary onRetry={onRetry}>
        <Bomb shouldThrow />
      </ErrorBoundary>
    )
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { Suspense } from 'react'
import TechGrid from '../TechGrid'
import type { FilterState } from '../SideNavBar'
import type { TechnologySummary } from '../../types/api'

vi.mock('../../services/api', () => ({
  fetchCategoryTechnologies: vi.fn(),
}))

vi.mock('../TechCard', () => ({
  default: ({ tech }: { tech: TechnologySummary }) => (
    <div data-testid="tech-card">{tech.name}</div>
  ),
}))

import { fetchCategoryTechnologies } from '../../services/api'

const mockFetch = vi.mocked(fetchCategoryTechnologies)

const emptyFilters: FilterState = {
  oeoCoverage: new Set(),
  instanceScale: new Set(),
}

function makeTech(overrides: Partial<TechnologySummary> = {}): TechnologySummary {
  return {
    id: 'tech-1',
    slug: null,
    name: 'Solar PV',
    category: 'generation',
    oeo_class: 'OEO_00000165',
    oeo_uri: 'http://example.org/OEO_00000165',
    n_instances: 3,
    input_carriers: [],
    output_carriers: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TechGrid', () => {
  it('renders a card for each returned technology', async () => {
    const promise = Promise.resolve({
      technologies: [makeTech({ id: '1', name: 'Solar PV' }), makeTech({ id: '2', name: 'Wind' })],
      total: 2,
    })
    mockFetch.mockReturnValue(promise)
    await act(async () => {
      render(
        <Suspense fallback={<div>loading</div>}>
          <TechGrid category="generation" searchQuery="" filters={emptyFilters} onOpenTech={vi.fn()} />
        </Suspense>
      )
      await promise
    })
    expect(screen.getAllByTestId('tech-card')).toHaveLength(2)
  })

  it('shows filtered / total count in summary', async () => {
    const promise = Promise.resolve({
      technologies: [makeTech({ id: '1' }), makeTech({ id: '2' })],
      total: 5,
    })
    mockFetch.mockReturnValue(promise)
    await act(async () => {
      render(
        <Suspense fallback={<div>loading</div>}>
          <TechGrid category="generation" searchQuery="" filters={emptyFilters} onOpenTech={vi.fn()} />
        </Suspense>
      )
      await promise
    })
    expect(screen.getByText('2 / 5 Technologies')).toBeInTheDocument()
  })

  it('filters by technology name', async () => {
    const promise = Promise.resolve({
      technologies: [
        makeTech({ id: '1', name: 'Solar PV' }),
        makeTech({ id: '2', name: 'Wind Turbine' }),
      ],
      total: 2,
    })
    mockFetch.mockReturnValue(promise)
    await act(async () => {
      render(
        <Suspense fallback={<div>loading</div>}>
          <TechGrid category="generation" searchQuery="solar" filters={emptyFilters} onOpenTech={vi.fn()} />
        </Suspense>
      )
      await promise
    })
    const cards = screen.getAllByTestId('tech-card')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveTextContent('Solar PV')
  })

  it('shows empty state when no technologies match the search', async () => {
    const promise = Promise.resolve({
      technologies: [makeTech({ id: '1', name: 'Solar PV' })],
      total: 1,
    })
    mockFetch.mockReturnValue(promise)
    await act(async () => {
      render(
        <Suspense fallback={<div>loading</div>}>
          <TechGrid category="generation" searchQuery="xyz-no-match" filters={emptyFilters} onOpenTech={vi.fn()} />
        </Suspense>
      )
      await promise
    })
    expect(screen.getByText('No technologies found')).toBeInTheDocument()
  })

  it('OEO coverage filter "full" shows only techs with both oeo_class and oeo_uri', async () => {
    const promise = Promise.resolve({
      technologies: [
        makeTech({ id: '1', name: 'Full OEO', oeo_class: 'OEO_1', oeo_uri: 'http://example.org/1' }),
        makeTech({ id: '2', name: 'Partial OEO', oeo_class: 'OEO_2', oeo_uri: null }),
        makeTech({ id: '3', name: 'No OEO', oeo_class: null, oeo_uri: null }),
      ],
      total: 3,
    })
    mockFetch.mockReturnValue(promise)
    await act(async () => {
      render(
        <Suspense fallback={<div>loading</div>}>
          <TechGrid
            category="generation"
            searchQuery=""
            filters={{ oeoCoverage: new Set(['full']), instanceScale: new Set() }}
            onOpenTech={vi.fn()}
          />
        </Suspense>
      )
      await promise
    })
    const cards = screen.getAllByTestId('tech-card')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveTextContent('Full OEO')
  })

  it('OEO coverage filter "none" shows only techs without oeo_class', async () => {
    const promise = Promise.resolve({
      technologies: [
        makeTech({ id: '1', name: 'Full OEO', oeo_class: 'OEO_1', oeo_uri: 'http://example.org/1' }),
        makeTech({ id: '2', name: 'No OEO', oeo_class: null, oeo_uri: null }),
      ],
      total: 2,
    })
    mockFetch.mockReturnValue(promise)
    await act(async () => {
      render(
        <Suspense fallback={<div>loading</div>}>
          <TechGrid
            category="generation"
            searchQuery=""
            filters={{ oeoCoverage: new Set(['none']), instanceScale: new Set() }}
            onOpenTech={vi.fn()}
          />
        </Suspense>
      )
      await promise
    })
    const cards = screen.getAllByTestId('tech-card')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveTextContent('No OEO')
  })

  it('instance scale filter "single" shows only techs with exactly 1 instance', async () => {
    const promise = Promise.resolve({
      technologies: [
        makeTech({ id: '1', name: 'One Instance', n_instances: 1 }),
        makeTech({ id: '2', name: 'Few Instances', n_instances: 4 }),
        makeTech({ id: '3', name: 'Many Instances', n_instances: 10 }),
      ],
      total: 3,
    })
    mockFetch.mockReturnValue(promise)
    await act(async () => {
      render(
        <Suspense fallback={<div>loading</div>}>
          <TechGrid
            category="generation"
            searchQuery=""
            filters={{ oeoCoverage: new Set(), instanceScale: new Set(['single']) }}
            onOpenTech={vi.fn()}
          />
        </Suspense>
      )
      await promise
    })
    const cards = screen.getAllByTestId('tech-card')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveTextContent('One Instance')
  })

  it('instance scale filter "many" shows only techs with more than 5 instances', async () => {
    const promise = Promise.resolve({
      technologies: [
        makeTech({ id: '1', name: 'One', n_instances: 1 }),
        makeTech({ id: '2', name: 'Few', n_instances: 5 }),
        makeTech({ id: '3', name: 'Many', n_instances: 6 }),
      ],
      total: 3,
    })
    mockFetch.mockReturnValue(promise)
    await act(async () => {
      render(
        <Suspense fallback={<div>loading</div>}>
          <TechGrid
            category="generation"
            searchQuery=""
            filters={{ oeoCoverage: new Set(), instanceScale: new Set(['many']) }}
            onOpenTech={vi.fn()}
          />
        </Suspense>
      )
      await promise
    })
    const cards = screen.getAllByTestId('tech-card')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveTextContent('Many')
  })
})

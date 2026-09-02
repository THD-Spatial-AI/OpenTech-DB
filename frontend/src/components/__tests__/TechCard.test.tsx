import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TechCard from '../TechCard'
import type { TechnologySummary } from '../../types/api'

function makeTech(overrides: Partial<TechnologySummary> = {}): TechnologySummary {
  return {
    id: 'tech-1',
    slug: 'solar_pv_utility',
    name: 'Solar PV Utility',
    category: 'generation',
    oeo_class: 'OEO_00000165',
    oeo_uri: 'http://openenergy-platform.org/ontology/oeo/OEO_00000165',
    n_instances: 3,
    input_carriers: [],
    output_carriers: [],
    is_renewable: false,
    ...overrides,
  }
}

describe('TechCard', () => {
  it('renders the technology name', () => {
    render(<TechCard tech={makeTech()} onOpen={vi.fn()} />)
    expect(screen.getByText('Solar PV Utility')).toBeInTheDocument()
  })

  it('renders the correct category chip label', () => {
    render(<TechCard tech={makeTech({ category: 'storage' })} onOpen={vi.fn()} />)
    expect(screen.getByText('Storage')).toBeInTheDocument()
  })

  it('renders instance count', () => {
    render(<TechCard tech={makeTech({ n_instances: 7 })} onOpen={vi.fn()} />)
    expect(screen.getByText('7 instances')).toBeInTheDocument()
  })

  it('calls onOpen with the tech when "View Parameters" is clicked', async () => {
    const tech = makeTech()
    const onOpen = vi.fn()
    render(<TechCard tech={tech} onOpen={onOpen} />)
    await userEvent.click(screen.getByRole('button', { name: /view parameters/i }))
    expect(onOpen).toHaveBeenCalledOnce()
    expect(onOpen).toHaveBeenCalledWith(tech)
  })

  it('renders hero image with lazy loading', () => {
    render(<TechCard tech={makeTech()} onOpen={vi.fn()} />)
    const img = screen.getByRole('img', { name: 'Solar PV Utility' })
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it('renders OEO link when oeo_uri is present', () => {
    const tech = makeTech({ oeo_uri: 'http://example.org/OEO_1' })
    render(<TechCard tech={tech} onOpen={vi.fn()} />)
    const link = screen.getByRole('link', { name: /oeo ontology link/i })
    expect(link).toHaveAttribute('href', 'http://example.org/OEO_1')
  })

  it('does not render OEO link when oeo_uri is null', () => {
    render(<TechCard tech={makeTech({ oeo_uri: null })} onOpen={vi.fn()} />)
    expect(screen.queryByRole('link', { name: /oeo ontology link/i })).not.toBeInTheDocument()
  })

  it('does not call onOpen when a different element is clicked', async () => {
    const onOpen = vi.fn()
    render(<TechCard tech={makeTech()} onOpen={onOpen} />)
    // click the card body (not the button)
    await userEvent.click(screen.getByText('Solar PV Utility'))
    expect(onOpen).not.toHaveBeenCalled()
  })
})

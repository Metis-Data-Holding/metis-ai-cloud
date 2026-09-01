/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import {
  getUserGroups,
  getUserModels,
  getVideoContent,
  getVideoGeneration,
  submitVideoGeneration,
} from '../../../api'
import { VideoPlayground } from '../video-playground'

vi.mock('../../../api', () => ({
  getUserGroups: vi.fn(),
  getUserModels: vi.fn(),
  getVideoContent: vi.fn(),
  getVideoGeneration: vi.fn(),
  submitVideoGeneration: vi.fn(),
}))

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper(props: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        {props.children}
      </QueryClientProvider>
    )
  }
}

describe('VideoPlayground', () => {
  beforeEach(() => {
    vi.mocked(getUserGroups).mockResolvedValue([
      { label: 'default', value: 'default', ratio: 1 },
    ])
    vi.mocked(getUserModels).mockResolvedValue([
      {
        label: 'dreamina-seedance-2-0-fast-260128',
        value: 'dreamina-seedance-2-0-fast-260128',
      },
    ])
    vi.mocked(submitVideoGeneration).mockResolvedValue({
      id: 'task-video-1',
      object: 'video',
      model: 'dreamina-seedance-2-0-fast-260128',
      status: 'queued',
      progress: 0,
      created_at: 1,
    })
    vi.mocked(getVideoGeneration).mockImplementation(
      () => new Promise(() => undefined)
    )
    vi.mocked(getVideoContent).mockImplementation(
      () => new Promise(() => undefined)
    )
  })

  test('shows only the supported resolution choices for Seedance Fast', async () => {
    render(<VideoPlayground />, { wrapper: createWrapper() })

    expect(await screen.findByRole('button', { name: '480p' })).toBeVisible()
    expect(screen.getByRole('button', { name: '720p' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: '1080p' })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '4k' })).not.toBeInTheDocument()
  })

  test('offers every duration from 5 through 15 seconds in a scrollable segmented control', async () => {
    const user = userEvent.setup()
    const scrollBy = vi.fn()
    const originalScrollBy = HTMLElement.prototype.scrollBy
    Object.defineProperty(HTMLElement.prototype, 'scrollBy', {
      configurable: true,
      value: scrollBy,
    })
    render(<VideoPlayground />, { wrapper: createWrapper() })

    const firstDuration = await screen.findByRole('button', { name: '5s' })
    for (let seconds = 5; seconds <= 15; seconds += 1) {
      expect(
        screen.getByRole('button', { name: `${seconds}s` })
      ).toBeInTheDocument()
    }
    expect(firstDuration.closest('fieldset')).toHaveClass('min-w-0')
    expect(
      screen.getByRole('button', { name: 'Scroll duration backward' })
    ).toBeInTheDocument()
    const forwardButton = screen.getByRole('button', {
      name: 'Scroll duration forward',
    })
    await user.click(forwardButton)
    expect(scrollBy).toHaveBeenCalledWith({
      left: 180,
      behavior: 'smooth',
    })
    expect(
      document.querySelectorAll('[data-slot="video-segmented-control"]')
    ).toHaveLength(4)

    Object.defineProperty(HTMLElement.prototype, 'scrollBy', {
      configurable: true,
      value: originalScrollBy,
    })
  })

  test('submits the selected duration', async () => {
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await user.type(
      await screen.findByLabelText('Prompt'),
      'A paper boat crossing a neon river'
    )
    await user.click(screen.getByRole('button', { name: '15s' }))
    await user.click(screen.getByRole('button', { name: 'Generate video' }))

    await waitFor(() =>
      expect(submitVideoGeneration).toHaveBeenCalledWith(
        'default',
        expect.objectContaining({ seconds: 15 })
      )
    )
  })

  test('submits a text-to-video task with the selected settings', async () => {
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    const prompt = await screen.findByLabelText('Prompt')
    await user.type(prompt, 'A paper boat crossing a neon river')
    await user.click(screen.getByRole('button', { name: 'Generate video' }))

    await waitFor(() =>
      expect(submitVideoGeneration).toHaveBeenCalledWith('default', {
        model: 'dreamina-seedance-2-0-fast-260128',
        prompt: 'A paper boat crossing a neon river',
        seconds: 5,
        metadata: {
          resolution: '720p',
          ratio: '16:9',
          generate_audio: false,
        },
      })
    )
    expect(await screen.findByText('Task submitted')).toBeVisible()
  })

  test('submits generate_audio only after output audio is turned on', async () => {
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    const audioOff = await screen.findByRole('button', { name: 'Off' })
    expect(audioOff).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.queryByText(
        'Adds synchronized sound. Keep this off for a silent video and fewer audio copyright checks.'
      )
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'On' }))
    await user.type(
      screen.getByLabelText('Prompt'),
      'A paper boat crossing a neon river'
    )
    await user.click(screen.getByRole('button', { name: 'Generate video' }))

    await waitFor(() =>
      expect(submitVideoGeneration).toHaveBeenCalledWith(
        'default',
        expect.objectContaining({
          metadata: expect.objectContaining({ generate_audio: true }),
        })
      )
    )
  })

  test('disables submission and explains when no video model is available', async () => {
    vi.mocked(getUserModels).mockResolvedValue([])
    render(<VideoPlayground />, { wrapper: createWrapper() })

    expect(await screen.findByText('No video models available')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Generate video' })
    ).toBeDisabled()
  })
})

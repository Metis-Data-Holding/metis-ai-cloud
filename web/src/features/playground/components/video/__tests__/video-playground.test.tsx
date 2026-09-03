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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import {
  getUserGroups,
  getUserModels,
  getVideoContent,
  getVideoGeneration,
  submitVideoGeneration,
  uploadVideoReference,
} from '../../../api'
import { readReferenceVideoDuration } from '../../../lib/video/video-reference-upload'
import { VideoPlayground } from '../video-playground'

vi.mock('../../../api', () => ({
  getUserGroups: vi.fn(),
  getUserModels: vi.fn(),
  getVideoContent: vi.fn(),
  getVideoGeneration: vi.fn(),
  submitVideoGeneration: vi.fn(),
  uploadVideoReference: vi.fn(),
}))

vi.mock(
  '../../../lib/video/video-reference-upload',
  async (importOriginal) => ({
    ...(await importOriginal()),
    readReferenceVideoDuration: vi.fn(),
  })
)

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

async function openVideoSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole('button', { name: /^Video settings:/ })
  )
}

async function selectGenerationMode(
  user: ReturnType<typeof userEvent.setup>,
  mode: 'Reference generation' | 'First and last frames'
) {
  await user.click(
    await screen.findByRole('button', { name: /^Generation mode:/ })
  )
  await user.click(screen.getByRole('menuitemradio', { name: mode }))
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
    vi.mocked(readReferenceVideoDuration).mockResolvedValue(5)
    vi.mocked(uploadVideoReference).mockResolvedValue({
      id: 'abcdefghijklmnopqrstuvwx.mp4',
      url: 'https://many-models.example/v1/video-reference-files/abcdefghijklmnopqrstuvwx.mp4/content?expires=1&access=signed',
      name: 'motion.mp4',
      content_type: 'video/mp4',
      size: 5,
    })
  })

  test('starts with one unified composer centered in the available area', async () => {
    render(<VideoPlayground />, { wrapper: createWrapper() })

    expect(
      await screen.findByTestId('video-playground-layout')
    ).toHaveAttribute('data-layout', 'centered')
    const prompt = screen.getByRole('textbox', { name: 'Prompt' })
    expect(prompt).toBeVisible()
    expect(prompt.closest('[data-slot="input-group"]')).toHaveClass(
      'bg-card',
      'has-disabled:opacity-100'
    )
    expect(prompt.closest('[data-slot="video-prompt-area"]')).toHaveClass(
      'min-h-28'
    )
    const referenceInput = screen.getByLabelText('Add reference content')
    expect(referenceInput).toBeInstanceOf(HTMLInputElement)
    if (!(referenceInput instanceof HTMLInputElement)) return
    expect(referenceInput.labels?.[0]).toHaveAttribute(
      'data-slot',
      'video-reference-picker'
    )
    expect(referenceInput.labels?.[0]).toHaveClass(
      'h-full',
      'min-h-28',
      'w-28'
    )
    expect(
      referenceInput.closest('[data-slot="video-reference-input"]')
    ).toHaveClass('items-start')
    expect(
      screen.getByRole('button', {
        name: 'Video settings: 16:9, 720p, 5s, audio off, 1 video',
      })
    ).toBeVisible()
    expect(
      screen.queryByRole('group', { name: 'Aspect ratio' })
    ).not.toBeInTheDocument()
  })

  test('opens video settings and changes every disclosed parameter', async () => {
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await user.click(
      await screen.findByRole('button', {
        name: 'Video settings: 16:9, 720p, 5s, audio off, 1 video',
      })
    )
    await user.click(screen.getByRole('button', { name: '9:16' }))
    await user.click(screen.getByRole('button', { name: '480p' }))
    await user.click(screen.getByRole('button', { name: '8s' }))
    await user.click(screen.getByRole('button', { name: 'On' }))
    await user.click(screen.getByRole('button', { name: '3' }))

    expect(
      screen.getByRole('button', {
        name: 'Video settings: 9:16, 480p, 8s, audio on, 3 videos',
      })
    ).toBeVisible()
  })

  test('uses a dropdown for generation mode and toggles the prompt height', async () => {
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await user.click(
      await screen.findByRole('button', {
        name: 'Generation mode: Reference generation',
      })
    )
    const menuLabel = screen.getByText('Generation mode', {
      selector: '[data-slot="dropdown-menu-label"]',
    })
    expect(menuLabel).toBeVisible()
    expect(menuLabel.closest('[data-slot="dropdown-menu-content"]')).toHaveClass(
      'w-64',
      'rounded-2xl'
    )
    expect(
      screen.getByRole('menuitemradio', { name: 'Reference generation' })
    ).toHaveClass('data-checked:bg-accent')
    await user.click(
      screen.getByRole('menuitemradio', { name: 'First and last frames' })
    )
    expect(screen.getByLabelText('First frame')).toBeVisible()
    expect(screen.getByLabelText('Last frame')).toBeVisible()
    expect(
      screen.queryByLabelText('Last frame (optional)')
    ).not.toBeInTheDocument()
    expect(
      screen.getByLabelText('First frame').closest(
        '[data-slot="video-keyframe-inputs"]'
      )
    ).toHaveClass('items-center')

    const expand = screen.getByRole('button', { name: 'Expand prompt input' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    await user.click(expand)
    expect(
      screen.getByRole('button', { name: 'Collapse prompt input' })
    ).toHaveAttribute('aria-expanded', 'true')
  })

  test('submits the selected quantity and moves the composer below results', async () => {
    const user = userEvent.setup()
    vi.mocked(submitVideoGeneration)
      .mockResolvedValueOnce({
        id: 'task-video-1',
        object: 'video',
        model: 'dreamina-seedance-2-0-fast-260128',
        status: 'queued',
        progress: 0,
        created_at: 1,
      })
      .mockResolvedValueOnce({
        id: 'task-video-2',
        object: 'video',
        model: 'dreamina-seedance-2-0-fast-260128',
        status: 'queued',
        progress: 0,
        created_at: 1,
      })
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await user.type(
      await screen.findByRole('textbox', { name: 'Prompt' }),
      'A paper boat crossing a neon river'
    )
    await user.click(
      screen.getByRole('button', {
        name: 'Video settings: 16:9, 720p, 5s, audio off, 1 video',
      })
    )
    await user.click(screen.getByRole('button', { name: '2' }))
    await user.keyboard('{Escape}')
    const submit = screen.getByRole('button', { name: 'Generate video' })
    expect(submit).toHaveTextContent('')
    expect(submit).toBeEnabled()
    fireEvent.click(submit)

    await waitFor(() => expect(submitVideoGeneration).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('video-playground-layout')).toHaveAttribute(
      'data-layout',
      'results'
    )
    expect(await screen.findByText('task-video-1')).toBeVisible()
    expect(await screen.findByText('task-video-2')).toBeVisible()
  })

  test('shows only the supported resolution choices for Seedance Fast', async () => {
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await openVideoSettings(user)
    expect(screen.getByRole('button', { name: '480p' })).toBeVisible()
    expect(
      screen.queryByText('Text-to-video only in this first version.')
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '720p' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: '1080p' })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '4k' })).not.toBeInTheDocument()
  })

  test('shows a pointer cursor for the reference content picker', async () => {
    render(<VideoPlayground />, { wrapper: createWrapper() })

    const input = await screen.findByLabelText('Add reference content')

    expect(input).toBeInstanceOf(HTMLInputElement)
    if (!(input instanceof HTMLInputElement)) return
    expect(input.labels?.[0]).toHaveClass('cursor-pointer')
  })

  test('removes 1080p when a Seedance 2.0 task includes image input', async () => {
    vi.mocked(getUserModels).mockResolvedValue([
      {
        label: 'dreamina-seedance-2-0-260128',
        value: 'dreamina-seedance-2-0-260128',
      },
    ])
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await openVideoSettings(user)
    const resolution1080 = screen.getByRole('button', { name: '1080p' })
    await user.click(resolution1080)
    await user.upload(
      screen.getByLabelText('Add reference content'),
      new File(['image'], 'reference.png', { type: 'image/png' })
    )

    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: 'Video settings: 16:9, 720p, 5s, audio off, 1 video',
        })
      ).toBeVisible()
    )
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

    await openVideoSettings(user)
    const firstDuration = screen.getByRole('button', { name: '5s' })
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
    ).toHaveLength(5)

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
    await openVideoSettings(user)
    await user.click(screen.getByRole('button', { name: '15s' }))
    await user.keyboard('{Escape}')
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

  test('selects mixed local media through one reference content control', async () => {
    const user = userEvent.setup()
    vi.mocked(uploadVideoReference)
      .mockResolvedValueOnce({
        id: 'first-video-reference.mp4',
        url: 'https://many-models.example/first-video.mp4',
        name: 'first.mp4',
        content_type: 'video/mp4',
        size: 5,
      })
      .mockResolvedValueOnce({
        id: 'second-video-reference.mov',
        url: 'https://many-models.example/second-video.mov',
        name: 'second.mov',
        content_type: 'video/quicktime',
        size: 6,
      })
    render(<VideoPlayground />, { wrapper: createWrapper() })

    expect(
      await screen.findByRole('button', {
        name: 'Generation mode: Reference generation',
      })
    ).toBeVisible()
    const image = new File(['image'], 'subject.png', { type: 'image/png' })
    const firstVideo = new File(['first'], 'first.mp4', { type: 'video/mp4' })
    const secondVideo = new File(['second'], 'second.mov', {
      type: 'video/quicktime',
    })
    await user.upload(screen.getByLabelText('Add reference content'), [
      image,
      firstVideo,
      secondVideo,
    ])
    expect(await screen.findByAltText('Reference image 1')).toBeVisible()
    expect(await screen.findByText('first.mp4')).toBeVisible()
    expect(await screen.findByText('second.mov')).toBeVisible()
    expect(uploadVideoReference).toHaveBeenCalledWith(
      firstVideo,
      expect.any(Function)
    )
    expect(uploadVideoReference).toHaveBeenCalledWith(
      secondVideo,
      expect.any(Function)
    )
    await user.type(
      screen.getByLabelText('Prompt'),
      'Use image 1 as the subject and video 1 for motion'
    )
    await user.click(screen.getByRole('button', { name: 'Generate video' }))

    await waitFor(() =>
      expect(submitVideoGeneration).toHaveBeenCalledWith(
        'default',
        expect.objectContaining({
          metadata: expect.objectContaining({
            content: [
              expect.objectContaining({
                type: 'image_url',
                role: 'reference_image',
              }),
              {
                type: 'video_url',
                video_url: {
                  url: 'https://many-models.example/first-video.mp4',
                },
                role: 'reference_video',
              },
              {
                type: 'video_url',
                video_url: {
                  url: 'https://many-models.example/second-video.mov',
                },
                role: 'reference_video',
              },
            ],
          }),
        })
      )
    )
  })

  test('uploads a local reference video and submits its signed URL', async () => {
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await screen.findByRole('button', {
      name: 'Generation mode: Reference generation',
    })
    const file = new File(['video'], 'motion.mp4', { type: 'video/mp4' })
    await user.upload(screen.getByLabelText('Add reference content'), file)

    expect(await screen.findByText('motion.mp4')).toBeVisible()
    expect(uploadVideoReference).toHaveBeenCalledWith(
      file,
      expect.any(Function)
    )
    await user.type(screen.getByLabelText('Prompt'), 'Follow this movement')
    await user.click(screen.getByRole('button', { name: 'Generate video' }))

    await waitFor(() =>
      expect(submitVideoGeneration).toHaveBeenCalledWith(
        'default',
        expect.objectContaining({
          metadata: expect.objectContaining({
            content: [
              {
                type: 'video_url',
                video_url: {
                  url: 'https://many-models.example/v1/video-reference-files/abcdefghijklmnopqrstuvwx.mp4/content?expires=1&access=signed',
                },
                role: 'reference_video',
              },
            ],
          }),
        })
      )
    )
  })

  test('rejects a local video larger than 80 MB before upload', async () => {
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await screen.findByRole('button', {
      name: 'Generation mode: Reference generation',
    })
    const file = new File(['video'], 'large.mp4', { type: 'video/mp4' })
    Object.defineProperty(file, 'size', { value: 80 * 1024 * 1024 + 1 })
    await user.upload(screen.getByLabelText('Add reference content'), file)

    expect(
      await screen.findByText('Each reference video must not exceed 80 MB.')
    ).toBeVisible()
    expect(uploadVideoReference).not.toHaveBeenCalled()
  })

  test('rejects local reference videos whose combined duration exceeds 15 seconds', async () => {
    const user = userEvent.setup()
    vi.mocked(readReferenceVideoDuration)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(8)
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await screen.findByRole('button', {
      name: 'Generation mode: Reference generation',
    })
    const input = screen.getByLabelText('Add reference content')
    await user.upload(
      input,
      new File(['first'], 'first.mp4', { type: 'video/mp4' })
    )
    expect(await screen.findByText('motion.mp4')).toBeVisible()
    await user.upload(
      input,
      new File(['second'], 'second.mp4', { type: 'video/mp4' })
    )

    expect(
      await screen.findByText(
        'Reference videos must total no more than 15 seconds.'
      )
    ).toBeVisible()
    expect(uploadVideoReference).toHaveBeenCalledTimes(1)
  })

  test('does not expose reference video URL controls', async () => {
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await screen.findByRole('button', {
      name: 'Generation mode: Reference generation',
    })
    expect(screen.getByLabelText('Add reference content')).toHaveAttribute(
      'multiple'
    )
    expect(
      screen.queryByRole('button', { name: 'Add reference video' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText('Reference video URL 1')
    ).not.toBeInTheDocument()
  })

  test('requires a first frame and clears reference content when modes change', async () => {
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await user.upload(
      await screen.findByLabelText('Add reference content'),
      new File(['reference'], 'reference.png', { type: 'image/png' })
    )
    expect(await screen.findByAltText('Reference image 1')).toBeVisible()

    await selectGenerationMode(user, 'First and last frames')
    expect(screen.queryByAltText('Reference image 1')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Generate video' })
    ).toBeDisabled()

    await user.upload(
      screen.getByLabelText('First frame'),
      new File(['first'], 'first.png', { type: 'image/png' })
    )
    expect(await screen.findByAltText('First frame')).toBeVisible()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Generate video' })
      ).toBeEnabled()
    )
    await user.click(screen.getByRole('button', { name: 'Generate video' }))

    await waitFor(() =>
      expect(submitVideoGeneration).toHaveBeenCalledWith(
        'default',
        expect.objectContaining({
          metadata: expect.objectContaining({
            content: [
              expect.objectContaining({
                type: 'image_url',
                role: 'first_frame',
              }),
            ],
          }),
        })
      )
    )
  })

  test('swaps the first and last frames before submission', async () => {
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await selectGenerationMode(user, 'First and last frames')
    expect(screen.getByLabelText('First frame')).toBeVisible()
    expect(screen.getByLabelText('Last frame')).toBeVisible()
    const swapButton = screen.getByRole('button', {
      name: 'Swap first and last frames',
    })
    expect(swapButton).toBeDisabled()

    await user.upload(
      screen.getByLabelText('First frame'),
      new File(['first'], 'first.png', { type: 'image/png' })
    )
    await user.upload(
      screen.getByLabelText('Last frame'),
      new File(['last'], 'last.png', { type: 'image/png' })
    )
    await waitFor(() => expect(swapButton).toBeEnabled())
    await user.click(swapButton)
    await user.type(screen.getByLabelText('Prompt'), 'Transition between them')
    await user.click(screen.getByRole('button', { name: 'Generate video' }))

    await waitFor(() =>
      expect(submitVideoGeneration).toHaveBeenCalledWith(
        'default',
        expect.objectContaining({
          metadata: expect.objectContaining({
            content: [
              {
                type: 'image_url',
                image_url: { url: 'data:image/png;base64,bGFzdA==' },
                role: 'first_frame',
              },
              {
                type: 'image_url',
                image_url: { url: 'data:image/png;base64,Zmlyc3Q=' },
                role: 'last_frame',
              },
            ],
          }),
        })
      )
    )
  })

  test('rejects excessive reference images', async () => {
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await screen.findByRole('button', {
      name: 'Generation mode: Reference generation',
    })
    await user.upload(
      screen.getByLabelText('Add reference content'),
      [...Array(10).keys()].map(
        (index) =>
          new File(['image'], `reference-${index}.png`, { type: 'image/png' })
      )
    )
    expect(
      await screen.findByText('You can add up to 9 reference images.')
    ).toBeVisible()
  })

  test('rejects image formats that BytePlus does not support', async () => {
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await screen.findByRole('button', {
      name: 'Generation mode: Reference generation',
    })
    fireEvent.change(screen.getByLabelText('Add reference content'), {
      target: {
        files: [
          new File(['<svg />'], 'reference.svg', { type: 'image/svg+xml' }),
        ],
      },
    })

    expect(
      await screen.findByText('Choose a supported image file.')
    ).toBeVisible()
    expect(screen.queryByAltText('Reference image 1')).not.toBeInTheDocument()
  })

  test('submits generate_audio only after output audio is turned on', async () => {
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await openVideoSettings(user)
    const audioOff = screen.getByRole('button', { name: 'Off' })
    expect(audioOff).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.queryByText(
        'Adds synchronized sound. Keep this off for a silent video and fewer audio copyright checks.'
      )
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'On' }))
    await user.keyboard('{Escape}')
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

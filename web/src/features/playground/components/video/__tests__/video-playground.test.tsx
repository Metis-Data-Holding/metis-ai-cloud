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
  mode: 'Reference generation' | 'First and last frames' | 'First frame'
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
    expect(prompt).toHaveAttribute(
      'placeholder',
      'Use @ to quickly reference uploaded files, for example: use the motion from @Video 1 to generate a video in which the characters from @Image 2 and @Image 3 fight.'
    )
    expect(
      screen.queryByText(
        'Submit an asynchronous Seedance video generation task.'
      )
    ).not.toBeInTheDocument()
    expect(prompt.closest('[data-slot="input-group"]')).toHaveClass(
      'bg-card',
      'has-disabled:opacity-100',
      'items-stretch'
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
    expect(referenceInput.labels?.[0]).toHaveClass('aspect-square', 'size-28')
    expect(
      referenceInput.closest('[data-slot="video-reference-input"]')
    ).toHaveClass('items-start')
    const settingsTrigger = screen.getByRole('button', {
      name: 'Video settings: 16:9, 720p, 5s, audio off, 1 video',
    })
    expect(settingsTrigger).toBeVisible()
    expect(
      settingsTrigger.querySelector('[data-slot="video-aspect-ratio-icon"]')
    ).toHaveAttribute('data-ratio', '16:9')
    expect(
      document.querySelector('[data-slot="video-composer-footer"]')
    ).not.toHaveClass('border-t')
    expect(
      screen.queryByRole('group', { name: 'Aspect ratio' })
    ).not.toBeInTheDocument()
  })

  test('gives the video model selector more room without overflowing narrow viewports', async () => {
    render(<VideoPlayground />, { wrapper: createWrapper() })

    expect(await screen.findByRole('combobox')).toHaveClass(
      'w-64',
      'max-w-[calc(100vw-6rem)]'
    )
  })

  test('sizes the keyframe controls to their content instead of reserving a fixed column', async () => {
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await selectGenerationMode(user, 'First and last frames')

    const firstFrameInput = screen.getByLabelText('First frame')
    const keyframeInputs = firstFrameInput.closest(
      '[data-slot="video-keyframe-inputs"]'
    )
    expect(keyframeInputs).toHaveClass('sm:w-fit')
    expect(keyframeInputs).not.toHaveClass('sm:w-full')
    expect(
      keyframeInputs?.closest('[data-slot="video-reference-area"]')
    ).toHaveClass('sm:w-fit')
    expect(
      keyframeInputs?.closest('[data-slot="video-reference-area"]')
    ).not.toHaveClass('sm:max-w-[46%]')
    expect(
      keyframeInputs?.closest('[data-slot="video-reference-area"]')
    ).not.toHaveClass('sm:w-[22rem]')
  })

  test('uses a keyframe-specific prompt instead of advertising reference mentions', async () => {
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await selectGenerationMode(user, 'First and last frames')

    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveAttribute(
      'placeholder',
      'Describe how the scene should change between the first and last frames.'
    )
  })

  test('opens video settings and changes every disclosed parameter', async () => {
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await user.click(
      await screen.findByRole('button', {
        name: 'Video settings: 16:9, 720p, 5s, audio off, 1 video',
      })
    )
    for (const ratio of ['16:9', '9:16', '1:1', '4:3', '3:4']) {
      expect(
        screen
          .getByRole('button', { name: ratio })
          .querySelector('[data-slot="video-aspect-ratio-icon"]')
      ).toHaveAttribute('data-ratio', ratio)
    }
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
    expect(
      menuLabel.closest('[data-slot="dropdown-menu-content"]')
    ).toHaveClass('w-64', 'rounded-2xl')
    expect(
      screen.getByRole('menuitemradio', { name: 'Reference generation' })
    ).toHaveClass('data-checked:bg-accent')
    await user.click(
      screen.getByRole('menuitemradio', { name: 'First and last frames' })
    )
    await waitFor(() => expect(menuLabel).not.toBeInTheDocument())
    expect(
      screen.getByLabelText('First frame', { selector: 'input' })
    ).toBeVisible()
    expect(screen.getByLabelText('Last frame')).toBeVisible()
    expect(
      screen.queryByLabelText('Last frame (optional)')
    ).not.toBeInTheDocument()
    const firstFrameInput = screen.getByLabelText('First frame')
    const lastFrameInput = screen.getByLabelText('Last frame')
    expect(firstFrameInput).toBeInstanceOf(HTMLInputElement)
    expect(lastFrameInput).toBeInstanceOf(HTMLInputElement)
    if (
      !(firstFrameInput instanceof HTMLInputElement) ||
      !(lastFrameInput instanceof HTMLInputElement)
    ) {
      return
    }
    expect(
      firstFrameInput.closest('[data-slot="video-keyframe-inputs"]')
    ).toHaveClass('items-center', 'justify-start')
    expect(firstFrameInput.labels?.[0]).toHaveClass('size-full')
    expect(lastFrameInput.labels?.[0]).toHaveClass('size-full')
    expect(firstFrameInput.labels?.[0]?.parentElement).toHaveClass(
      'aspect-square',
      'sm:size-28'
    )
    expect(lastFrameInput.labels?.[0]?.parentElement).toHaveClass(
      'aspect-square',
      'sm:size-28'
    )

    const expand = screen.getByRole('button', { name: 'Expand prompt input' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    expect(
      expand.querySelector('[data-slot="video-expand-icon"]')
    ).toHaveAttribute('data-icon', 'expand')
    await user.click(expand)
    const collapse = screen.getByRole('button', {
      name: 'Collapse prompt input',
    })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    expect(
      collapse.querySelector('[data-slot="video-expand-icon"]')
    ).toHaveAttribute('data-icon', 'collapse')
  })

  test('closes the generation mode menu after keyboard selection', async () => {
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await user.click(
      await screen.findByRole('button', {
        name: 'Generation mode: Reference generation',
      })
    )
    const keyframes = screen.getByRole('menuitemradio', {
      name: 'First and last frames',
    })
    keyframes.focus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(keyframes).not.toBeInTheDocument())
    expect(
      screen.getByRole('button', {
        name: 'Generation mode: First and last frames',
      })
    ).toBeVisible()
  })

  test('keeps the collapsed content row at the reference control height', async () => {
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    const prompt = await screen.findByRole('textbox', { name: 'Prompt' })
    const inputGroup = prompt.closest('[data-slot="input-group"]')
    const contentRow = prompt.closest('[data-slot="video-composer-content"]')

    expect(inputGroup).toHaveClass('min-h-0')
    expect(inputGroup).not.toHaveClass('min-h-72')
    expect(contentRow).toHaveClass('flex-none')

    await user.click(
      screen.getByRole('button', { name: 'Expand prompt input' })
    )

    expect(inputGroup).toHaveClass('min-h-[min(36rem,calc(100dvh-14rem))]')
    expect(inputGroup).not.toHaveClass('min-h-[54rem]')
    expect(prompt).not.toHaveClass('min-h-[44rem]')
    expect(contentRow).toHaveClass('flex-1')
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
    const firstTaskId = await screen.findByText('task-video-1')
    expect(firstTaskId).toBeVisible()
    expect(await screen.findByText('task-video-2')).toBeVisible()
    expect(firstTaskId).toHaveClass('min-w-0', 'break-all')
    expect(firstTaskId.closest('[data-slot="card"]')).toHaveClass(
      'min-w-0',
      'w-full'
    )
  })

  test('shows reference submission feedback before the provider returns a task', async () => {
    const user = userEvent.setup()
    let resolveSubmission:
      | ((task: Awaited<ReturnType<typeof submitVideoGeneration>>) => void)
      | undefined
    vi.mocked(submitVideoGeneration).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSubmission = resolve
        })
    )
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await user.upload(
      await screen.findByLabelText('Add reference content'),
      new File(['image'], 'subject.png', { type: 'image/png' })
    )
    await screen.findByText('Image 1')
    const prompt = screen.getByRole('textbox', { name: 'Prompt' })
    await user.type(prompt, 'Let the subject turn toward the camera')
    await user.click(screen.getByRole('button', { name: 'Generate video' }))

    expect(screen.getByTestId('video-playground-layout')).toHaveAttribute(
      'data-layout',
      'results'
    )
    expect(
      screen.getByRole('status', {
        name: 'Uploading reference content and submitting the task...',
      })
    ).toBeVisible()
    expect(prompt).toHaveValue('Let the subject turn toward the camera')
    expect(screen.queryByText('Task progress')).not.toBeInTheDocument()

    resolveSubmission?.({
      id: 'task-video-delayed',
      object: 'video',
      model: 'dreamina-seedance-2-0-fast-260128',
      status: 'queued',
      progress: 0,
      created_at: 1,
    })

    expect(await screen.findByText('task-video-delayed')).toBeVisible()
    await waitFor(() =>
      expect(
        screen.queryByRole('status', {
          name: 'Uploading reference content and submitting the task...',
        })
      ).not.toBeInTheDocument()
    )
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

  test('uses the existing first-and-last-frame UI for MiniMax H3', async () => {
    vi.mocked(getUserModels).mockResolvedValue([
      { label: 'MiniMax H3', value: 'minimax-h3-fl2va' },
    ])
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    const prompt = await screen.findByRole('textbox', { name: 'Prompt' })
    await waitFor(() =>
      expect(prompt).toHaveAttribute(
        'placeholder',
        'Use @ to quickly reference uploaded files, for example: use the motion from @Video 1 to generate a video in which the characters from @Image 2 and @Image 3 fight.'
      )
    )
    expect(screen.getByLabelText('Add reference content')).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Generation mode: Reference generation',
      })
    ).toBeVisible()

    await user.click(
      await screen.findByRole('button', {
        name: 'Video settings: 16:9, 768p, 5s, audio off, 1 video',
      })
    )
    expect(screen.getByRole('button', { name: '768p' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: '720p' })
    ).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    await selectGenerationMode(user, 'First and last frames')
    expect(prompt).toHaveAttribute(
      'placeholder',
      'Describe how the scene should change between the first and last frames.'
    )
    const firstFrameInput = screen.getByLabelText('First frame', {
      selector: 'input',
    })
    expect(firstFrameInput).toBeVisible()
    expect(screen.getByLabelText('Last frame')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Swap first and last frames' })
    ).toBeDisabled()
    await user.upload(
      screen.getByLabelText('First frame', { selector: 'input' }),
      new File(['image'], 'first.png', { type: 'image/png' })
    )
    await user.upload(
      screen.getByLabelText('Last frame', { selector: 'input' }),
      new File(['last'], 'last.webp', { type: 'image/webp' })
    )
    expect(
      screen.getByRole('button', { name: 'Generate video' })
    ).toBeDisabled()
    await user.type(prompt, 'City traffic in cinematic rain')
    await user.click(screen.getByRole('button', { name: 'Generate video' }))

    await waitFor(() =>
      expect(submitVideoGeneration).toHaveBeenCalledWith('default', {
        model: 'minimax-h3-fl2va',
        prompt: 'City traffic in cinematic rain',
        seconds: 5,
        metadata: {
          resolution: '768p',
          ratio: '16:9',
          generate_audio: false,
          content: [
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,aW1hZ2U=' },
              role: 'first_frame',
            },
            {
              type: 'image_url',
              image_url: { url: 'data:image/webp;base64,bGFzdA==' },
              role: 'last_frame',
            },
          ],
        },
      })
    )
  })

  test('allows MiniMax H3 reference images and one reference video', async () => {
    vi.mocked(getUserModels).mockResolvedValue([
      { label: 'MiniMax H3', value: 'minimax-h3-fl2va' },
    ])
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    const input = await screen.findByLabelText('Add reference content')
    const imageOne = new File(['one'], 'one.png', { type: 'image/png' })
    const video = new File(['video'], 'motion.mp4', { type: 'video/mp4' })
    const imageTwo = new File(['two'], 'two.webp', { type: 'image/webp' })
    await user.upload(input, [imageOne, video, imageTwo])

    expect(await screen.findByText('Image 1')).toBeVisible()
    expect(await screen.findByText('Video 1')).toBeVisible()
    expect(await screen.findByText('Image 2')).toBeVisible()
    await user.upload(
      input,
      new File(['three'], 'three.png', { type: 'image/png' })
    )
    expect(
      await screen.findByText('You can add up to 2 reference images.')
    ).toBeVisible()
    await user.type(
      screen.getByRole('textbox', { name: 'Prompt' }),
      'Use @Video 1 motion with @Image 1 and @Image 2'
    )
    await user.click(screen.getByRole('button', { name: 'Generate video' }))

    await waitFor(() =>
      expect(submitVideoGeneration).toHaveBeenCalledWith(
        'default',
        expect.objectContaining({
          model: 'minimax-h3-fl2va',
          metadata: expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({ role: 'reference_image' }),
              expect.objectContaining({ role: 'reference_video' }),
            ]),
          }),
        })
      )
    )
  })

  test('rejects MiniMax H3 reference videos above the gateway limit', async () => {
    vi.mocked(getUserModels).mockResolvedValue([
      { label: 'MiniMax H3', value: 'minimax-h3-fl2va' },
    ])
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    const file = new File(['video'], 'large.mp4', { type: 'video/mp4' })
    Object.defineProperty(file, 'size', { value: 64 * 1024 * 1024 + 1 })
    await user.upload(
      await screen.findByLabelText('Add reference content'),
      file
    )

    expect(
      await screen.findByText('Each reference video must not exceed 64 MB.')
    ).toBeVisible()
    expect(uploadVideoReference).not.toHaveBeenCalled()
  })

  test('clears reference content when switching to MiniMax H3', async () => {
    vi.mocked(getUserModels).mockResolvedValue([
      {
        label: 'dreamina-seedance-2-0-fast-260128',
        value: 'dreamina-seedance-2-0-fast-260128',
      },
      { label: 'MiniMax H3', value: 'minimax-h3-fl2va' },
    ])
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await user.upload(
      await screen.findByLabelText('Add reference content'),
      new File(['image'], 'subject.png', { type: 'image/png' })
    )
    expect(await screen.findByText('Image 1')).toBeVisible()

    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByText('MiniMax H3'))

    const prompt = screen.getByRole('textbox', { name: 'Prompt' })
    await waitFor(() =>
      expect(prompt).toHaveAttribute(
        'placeholder',
        'Use @ to quickly reference uploaded files, for example: use the motion from @Video 1 to generate a video in which the characters from @Image 2 and @Image 3 fight.'
      )
    )
    await user.type(prompt, 'A quiet city at night')
    await user.click(screen.getByRole('button', { name: 'Generate video' }))

    await waitFor(() =>
      expect(submitVideoGeneration).toHaveBeenCalledWith('default', {
        model: 'minimax-h3-fl2va',
        prompt: 'A quiet city at night',
        seconds: 5,
        metadata: {
          resolution: '768p',
          ratio: '16:9',
          generate_audio: false,
        },
      })
    )
  })

  test('clears the hidden video count when switching models', async () => {
    vi.mocked(getUserModels).mockResolvedValue([
      {
        label: 'dreamina-seedance-2-0-fast-260128',
        value: 'dreamina-seedance-2-0-fast-260128',
      },
      { label: 'MiniMax H3', value: 'minimax-h3-fl2va' },
    ])
    vi.mocked(uploadVideoReference)
      .mockResolvedValueOnce({
        id: 'first-reference.mp4',
        url: 'https://many-models.example/v1/video-reference-files/first-reference.mp4/content?access=signed',
        name: 'first.mp4',
        content_type: 'video/mp4',
        size: 5,
      })
      .mockResolvedValueOnce({
        id: 'second-reference.mp4',
        url: 'https://many-models.example/v1/video-reference-files/second-reference.mp4/content?access=signed',
        name: 'second.mp4',
        content_type: 'video/mp4',
        size: 6,
      })
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await user.upload(
      await screen.findByLabelText('Add reference content'),
      new File(['first'], 'first.mp4', { type: 'video/mp4' })
    )
    expect(await screen.findByText('Video 1')).toBeVisible()

    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByText('MiniMax H3'))
    await user.upload(
      screen.getByLabelText('Add reference content'),
      new File(['second'], 'second.mp4', { type: 'video/mp4' })
    )

    await waitFor(() => expect(uploadVideoReference).toHaveBeenCalledTimes(2))
    expect(
      screen.queryByText('You can add up to 1 reference video.')
    ).not.toBeInTheDocument()
  })

  test('clears unsupported keyframes when switching to MiniMax H3', async () => {
    vi.mocked(getUserModels).mockResolvedValue([
      {
        label: 'dreamina-seedance-2-0-fast-260128',
        value: 'dreamina-seedance-2-0-fast-260128',
      },
      { label: 'MiniMax H3', value: 'minimax-h3-fl2va' },
    ])
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await selectGenerationMode(user, 'First and last frames')
    await user.upload(
      screen.getByLabelText('First frame', { selector: 'input' }),
      new File(['gif'], 'first.gif', { type: 'image/gif' })
    )
    expect(await screen.findByAltText('First frame')).toBeVisible()

    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByText('MiniMax H3'))

    await waitFor(() =>
      expect(screen.queryByAltText('First frame')).not.toBeInTheDocument()
    )
    expect(
      screen.getByRole('button', { name: 'Generate video' })
    ).toBeDisabled()
  })

  test('shows a pointer cursor for the reference content picker', async () => {
    render(<VideoPlayground />, { wrapper: createWrapper() })

    const input = await screen.findByLabelText('Add reference content')

    expect(input).toBeInstanceOf(HTMLInputElement)
    if (!(input instanceof HTMLInputElement)) return
    expect(input.labels?.[0]).toHaveClass('cursor-pointer')
  })

  test('disables 1080p with a tooltip when Seedance 2.0 includes image input', async () => {
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

    await openVideoSettings(user)
    const disabledResolution = screen.getByRole('button', { name: '1080p' })
    expect(disabledResolution).toBeDisabled()

    const reason = '1080p is unavailable when reference images are included.'
    const tooltipTrigger = screen.getByLabelText(reason)
    expect(tooltipTrigger).toHaveAttribute('title', reason)

    expect(
      screen.getByRole('button', {
        name: '720p',
      })
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('button', {
        name: 'Video settings: 16:9, 720p, 5s, audio off, 1 video',
      })
    ).toBeVisible()
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

  test('keeps the reference tray collapsed after the first upload until the pointer leaves', async () => {
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    const input = await screen.findByLabelText('Add reference content')
    await user.upload(
      input,
      new File(['first-image'], 'subject.png', { type: 'image/png' })
    )

    expect(await screen.findByText('Image 1')).toBeVisible()
    const tray = input.closest('[data-slot="video-reference-tray"]')
    expect(tray).not.toBeNull()
    if (!tray) {
      throw new Error('Reference tray not found')
    }
    expect(tray).toHaveAttribute('data-expanded', 'false')

    fireEvent.pointerLeave(tray)
    fireEvent.pointerEnter(tray)

    expect(tray).toHaveAttribute('data-expanded', 'true')
  })

  test('expands multiple reference assets within the composer layout and uses stable card rotations', async () => {
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    const input = await screen.findByLabelText('Add reference content')
    await user.upload(input, [
      new File(['first-image'], 'subject.png', { type: 'image/png' }),
      new File(['second-image'], 'setting.png', { type: 'image/png' }),
    ])

    expect(await screen.findByText('Image 2')).toBeVisible()
    const tray = input.closest('[data-slot="video-reference-tray"]')
    expect(tray).not.toBeNull()
    if (!tray) {
      throw new Error('Reference tray not found')
    }
    const cards = tray.querySelectorAll('[data-slot="video-reference-asset"]')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveStyle('--collapsed-reference-rotation: -5deg')
    expect(cards[1]).toHaveStyle('--collapsed-reference-rotation: 4deg')

    fireEvent.pointerLeave(tray)
    fireEvent.pointerEnter(tray)

    expect(cards[0]).toHaveClass('sm:rotate-0')
    expect(cards[1]).toHaveClass('sm:rotate-0')
    expect(tray).toHaveClass('sm:overflow-x-auto')
    expect(tray.closest('[data-slot="video-reference-area"]')).toHaveClass(
      'sm:w-[min(46%,var(--expanded-reference-width))]',
      'sm:overflow-hidden'
    )
  })

  test('preserves mixed upload order and inserts stable media mentions', async () => {
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
    const firstImage = new File(['first-image'], 'subject.png', {
      type: 'image/png',
    })
    const firstVideo = new File(['first'], 'first.mp4', { type: 'video/mp4' })
    const secondImage = new File(['second-image'], 'setting.png', {
      type: 'image/png',
    })
    await user.upload(screen.getByLabelText('Add reference content'), [
      firstImage,
      firstVideo,
      secondImage,
    ])
    expect(await screen.findByAltText('Reference image 1')).toBeVisible()
    expect(await screen.findByText('Image 1')).toBeVisible()
    expect(await screen.findByText('Video 1')).toBeVisible()
    expect(await screen.findByText('Image 2')).toBeVisible()
    expect(uploadVideoReference).toHaveBeenCalledWith(
      firstVideo,
      expect.any(Function)
    )
    const prompt = screen.getByLabelText('Prompt')
    await user.type(prompt, 'Use @')
    await user.click(await screen.findByRole('option', { name: '@Video 1' }))
    expect(prompt).toHaveValue('Use @Video 1 ')
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
              expect.objectContaining({
                type: 'image_url',
                role: 'reference_image',
              }),
            ],
          }),
        })
      )
    )
  })

  test('selects reference mentions with arrow keys and Enter', async () => {
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await user.upload(await screen.findByLabelText('Add reference content'), [
      new File(['first-image'], 'subject.png', { type: 'image/png' }),
      new File(['second-image'], 'setting.png', { type: 'image/png' }),
    ])
    const prompt = screen.getByRole('textbox', { name: 'Prompt' })
    await user.type(prompt, 'Use @')
    const firstOption = await screen.findByRole('option', { name: '@Image 1' })
    const secondOption = screen.getByRole('option', { name: '@Image 2' })

    expect(firstOption).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowDown}')
    expect(secondOption).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowUp}')
    expect(firstOption).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowUp}{Enter}')

    expect(prompt).toHaveValue('Use @Image 2 ')
    expect(
      screen.queryByRole('listbox', { name: 'Reference content' })
    ).not.toBeInTheDocument()
    expect(prompt).toHaveFocus()
  })

  test('closes reference mentions with Escape without changing the prompt', async () => {
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await user.upload(
      await screen.findByLabelText('Add reference content'),
      new File(['image'], 'subject.png', { type: 'image/png' })
    )
    const prompt = screen.getByRole('textbox', { name: 'Prompt' })
    await user.type(prompt, 'Use @')
    expect(
      await screen.findByRole('listbox', { name: 'Reference content' })
    ).toBeVisible()

    await user.keyboard('{Escape}')

    expect(prompt).toHaveValue('Use @')
    expect(
      screen.queryByRole('listbox', { name: 'Reference content' })
    ).not.toBeInTheDocument()
  })

  test('keeps 1080p enabled for video-only references and disables it after adding an image', async () => {
    const user = userEvent.setup()
    vi.mocked(getUserModels).mockResolvedValue([
      {
        label: 'dreamina-seedance-2-0-260128',
        value: 'dreamina-seedance-2-0-260128',
      },
    ])
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await user.upload(
      await screen.findByLabelText('Add reference content'),
      new File(['video'], 'motion.mp4', { type: 'video/mp4' })
    )
    await openVideoSettings(user)
    expect(screen.getByRole('button', { name: '1080p' })).toBeVisible()
    await user.keyboard('{Escape}')

    await user.upload(
      screen.getByLabelText('Add reference content'),
      new File(['image'], 'subject.png', { type: 'image/png' })
    )
    await openVideoSettings(user)
    expect(screen.getByRole('button', { name: '1080p' })).toBeDisabled()
  })

  test('uploads a local reference video and submits its signed URL', async () => {
    const user = userEvent.setup()
    render(<VideoPlayground />, { wrapper: createWrapper() })

    await screen.findByRole('button', {
      name: 'Generation mode: Reference generation',
    })
    const file = new File(['video'], 'motion.mp4', { type: 'video/mp4' })
    await user.upload(screen.getByLabelText('Add reference content'), file)

    expect(await screen.findByText('Video 1')).toBeVisible()
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
    expect(await screen.findByText('Video 1')).toBeVisible()
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

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
import { act, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  getVideoContent,
  getVideoGeneration,
  submitVideoGeneration,
} from '../../api'
import type { VideoGenerationRequest, VideoTask } from '../../types'
import { useVideoGeneration } from '../use-video-generation'

vi.mock('../../api', () => ({
  getVideoContent: vi.fn(),
  getVideoGeneration: vi.fn(),
  submitVideoGeneration: vi.fn(),
}))

const request: VideoGenerationRequest = {
  model: 'dreamina-seedance-2-0-fast-260128',
  prompt: 'A paper boat crossing a neon river',
  seconds: 5,
  metadata: {
    resolution: '480p',
    ratio: '16:9',
    generate_audio: false,
  },
}

const queuedTask: VideoTask = {
  id: 'task-video-1',
  object: 'video',
  model: request.model,
  status: 'queued',
  progress: 0,
  created_at: 1,
}

const completedTask: VideoTask = {
  ...queuedTask,
  status: 'completed',
  progress: 100,
  completed_at: 2,
}

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

describe('useVideoGeneration', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(submitVideoGeneration).mockResolvedValue(queuedTask)
    vi.mocked(getVideoGeneration).mockResolvedValue(completedTask)
    vi.mocked(getVideoContent).mockResolvedValue(
      new Blob(['video'], { type: 'video/mp4' })
    )
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:video-preview')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('submits, polls to completion, and loads an authenticated preview blob', async () => {
    const { result } = renderHook(() => useVideoGeneration(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.submit('default', request)
    })

    expect(submitVideoGeneration).toHaveBeenCalledWith('default', request)
    expect(result.current.task).toEqual(queuedTask)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })

    await waitFor(() => expect(result.current.task).toEqual(completedTask))
    await waitFor(() =>
      expect(result.current.videoUrl).toBe('blob:video-preview')
    )
    expect(getVideoContent).toHaveBeenCalledWith('task-video-1')
  })

  test('keeps a completed failure terminal and exposes the upstream message', async () => {
    const failedTask: VideoTask = {
      ...queuedTask,
      status: 'failed',
      error: { code: 'provider_failed', message: 'Provider rejected prompt' },
    }
    vi.mocked(submitVideoGeneration).mockResolvedValue(failedTask)

    const { result } = renderHook(() => useVideoGeneration(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.submit('default', request)
    })

    expect(result.current.task).toEqual(failedTask)
    expect(result.current.taskError).toBe('Provider rejected prompt')
    expect(getVideoGeneration).not.toHaveBeenCalled()
    expect(getVideoContent).not.toHaveBeenCalled()
  })
})

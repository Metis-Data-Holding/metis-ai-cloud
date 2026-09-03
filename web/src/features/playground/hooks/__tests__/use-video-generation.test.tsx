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
import { useVideoGeneration, useVideoTask } from '../use-video-generation'

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

describe('video generation hooks', () => {
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

  test('submits the requested number of independent tasks in order', async () => {
    vi.mocked(submitVideoGeneration)
      .mockResolvedValueOnce(queuedTask)
      .mockResolvedValueOnce({ ...queuedTask, id: 'task-video-2' })
      .mockResolvedValueOnce({ ...queuedTask, id: 'task-video-3' })
    const { result } = renderHook(() => useVideoGeneration(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.submit('default', request, 3)
    })

    expect(submitVideoGeneration).toHaveBeenCalledTimes(3)
    expect(result.current.tasks.map((task) => task.id)).toEqual([
      'task-video-1',
      'task-video-2',
      'task-video-3',
    ])
  })

  test('keeps submitted tasks when a later task fails', async () => {
    vi.mocked(submitVideoGeneration)
      .mockResolvedValueOnce(queuedTask)
      .mockRejectedValueOnce(new Error('Quota is not enough'))
    const { result } = renderHook(() => useVideoGeneration(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await expect(
        result.current.submit('default', request, 4)
      ).rejects.toThrow('Quota is not enough')
    })

    expect(submitVideoGeneration).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(result.current.tasks).toEqual([queuedTask]))
    await waitFor(() =>
      expect(result.current.submitError).toBe('Quota is not enough')
    )
  })

  test('polls one task to completion and loads an authenticated preview blob', async () => {
    const { result } = renderHook(() => useVideoTask(queuedTask), {
      wrapper: createWrapper(),
    })

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

  test('keeps a completed failure terminal and exposes the upstream message', () => {
    const failedTask: VideoTask = {
      ...queuedTask,
      status: 'failed',
      error: { code: 'provider_failed', message: 'Provider rejected prompt' },
    }
    const { result } = renderHook(() => useVideoTask(failedTask), {
      wrapper: createWrapper(),
    })

    expect(result.current.task).toEqual(failedTask)
    expect(result.current.taskError).toBe('Provider rejected prompt')
    expect(getVideoGeneration).not.toHaveBeenCalled()
    expect(getVideoContent).not.toHaveBeenCalled()
  })
})

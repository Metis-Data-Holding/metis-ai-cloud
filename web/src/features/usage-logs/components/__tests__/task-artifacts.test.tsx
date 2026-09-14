/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, test, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import { api } from '@/lib/api'

import type { TaskLog } from '../../types'
import { TaskArtifactsCell } from '../task-artifacts'

const artifactAccessToken = `${'A'.repeat(41)}-_`
const finalVideoUrl = `https://media.example.com/v1/tasks/task_sr/artifacts/video-main/content?access=${artifactAccessToken}`

const i18n = createInstance()
await i18n.init({
  lng: 'en',
  resources: { en },
  interpolation: { escapeValue: false },
})

function taskFixture(overrides: Partial<TaskLog> = {}): TaskLog {
  return {
    id: 1,
    user_id: 7,
    platform: 'doubao-video',
    task_id: 'task_sr',
    action: 'GENERATE',
    channel_id: 3,
    group: 'default',
    quota: 100,
    submit_time: 1,
    status: 'SUCCESS',
    admin_info: {
      super_resolution: {
        phase: 'completed',
        original_available: true,
      },
    },
    ...overrides,
  }
}

function renderCell(log: TaskLog, isAdmin = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <TaskArtifactsCell log={log} isAdmin={isAdmin} />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('super-resolution task artifacts', () => {
  test('switches video tabs, shares the current download URL, and revokes original URL on close', async () => {
    const originalBlob = new Blob(['original'], { type: 'video/mp4' })
    const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
      if (url === '/api/task/task_sr/original') return { data: originalBlob }
      return {
        data: {
          success: true,
          data: {
            artifacts: [
              {
                key: 'video-main',
                type: 'video',
                mime_type: 'video/mp4',
                content_url: finalVideoUrl,
              },
            ],
          },
        },
      }
    })
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:original')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL')
    const user = userEvent.setup()
    const view = renderCell(taskFixture())

    await user.click(screen.getByRole('button', { name: 'Artifacts' }))
    await screen.findByRole('tab', { name: 'Original video' })
    expect(
      screen.getByRole('tab', { name: 'Super-resolution video' })
    ).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => {
      const videos = document.querySelectorAll('video')
      expect(videos).toHaveLength(1)
      expect(videos[0]).toHaveAttribute('src', finalVideoUrl)
    })
    expect(get).not.toHaveBeenCalledWith(
      '/api/task/task_sr/original',
      expect.anything()
    )
    expect(
      screen.getByRole('button', { name: 'Download video' })
    ).toHaveAttribute('href', finalVideoUrl)

    await user.click(screen.getByRole('tab', { name: 'Original video' }))
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        '/api/task/task_sr/original',
        expect.anything()
      )
    )
    expect(createObjectURL).toHaveBeenCalledWith(originalBlob)
    expect(
      screen.getByRole('button', { name: 'Download video' })
    ).toHaveAttribute('href', 'blob:original')
    await waitFor(() => {
      const videos = document.querySelectorAll('video')
      expect(videos).toHaveLength(1)
      expect(videos[0]).toHaveAttribute('src', 'blob:original')
    })

    await user.click(
      screen.getByRole('tab', { name: 'Super-resolution video' })
    )
    await waitFor(() => {
      const videos = document.querySelectorAll('video')
      expect(videos).toHaveLength(1)
      expect(videos[0]).toHaveAttribute('src', finalVideoUrl)
    })
    expect(
      screen.getByRole('button', { name: 'Download video' })
    ).toHaveAttribute('href', finalVideoUrl)

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:original')
    view.unmount()
  })

  test('opens a failed task with a retained original without requesting public artifacts', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      data: new Blob(['original'], { type: 'video/mp4' }),
    })
    const user = userEvent.setup()
    renderCell(taskFixture({ status: 'FAILURE' }))

    await user.click(screen.getByRole('button', { name: 'Artifacts' }))
    expect(screen.getByRole('tab', { name: 'Original video' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        '/api/task/task_sr/original',
        expect.anything()
      )
    )
    expect(get).not.toHaveBeenCalledWith(
      '/api/task/task_sr/artifacts',
      expect.anything()
    )
    expect(
      screen.getByRole('tab', { name: 'Super-resolution video' })
    ).toHaveAttribute('aria-disabled', 'true')
  })

  test('does not expose or request the original video for regular users', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          artifacts: [
            { key: 'video-main', type: 'video', content_url: finalVideoUrl },
          ],
        },
      },
    })
    const user = userEvent.setup()
    renderCell(taskFixture(), false)

    await user.click(screen.getByRole('button', { name: 'Artifacts' }))
    await waitFor(() => {
      const videos = document.querySelectorAll('video')
      expect(videos).toHaveLength(1)
      expect(videos[0]).toHaveAttribute('src', finalVideoUrl)
    })
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(get).not.toHaveBeenCalledWith(
      '/api/task/task_sr/original',
      expect.anything()
    )
  })

  test('does not resurrect a late original response after the dialog closes', async () => {
    let resolveOriginal: ((response: { data: Blob }) => void) | undefined
    const originalResponse = new Promise<{ data: Blob }>((resolve) => {
      resolveOriginal = resolve
    })
    let originalCalls = 0
    const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
      if (url === '/api/task/task_sr/original') {
        originalCalls += 1
        if (originalCalls === 1) return originalResponse
        return { data: new Blob(['second'], { type: 'video/mp4' }) }
      }
      return {
        data: {
          success: true,
          data: {
            artifacts: [
              { key: 'video-main', type: 'video', content_url: finalVideoUrl },
            ],
          },
        },
      }
    })
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:late-original')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL')
    const user = userEvent.setup()
    renderCell(taskFixture())

    await user.click(screen.getByRole('button', { name: 'Artifacts' }))
    await user.click(screen.getByRole('tab', { name: 'Original video' }))
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        '/api/task/task_sr/original',
        expect.anything()
      )
    )
    await user.click(screen.getByRole('button', { name: 'Close' }))

    resolveOriginal?.({ data: new Blob(['late'], { type: 'video/mp4' }) })
    await waitFor(() =>
      expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    )
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:late-original')
    expect(
      screen.queryByRole('button', { name: 'Download video' })
    ).not.toBeInTheDocument()
  })

  test('disables the original tab when the source was not retained', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          artifacts: [
            { key: 'video-main', type: 'video', content_url: finalVideoUrl },
          ],
        },
      },
    })
    const user = userEvent.setup()
    renderCell(
      taskFixture({
        admin_info: { super_resolution: { original_available: false } },
      })
    )

    await user.click(screen.getByRole('button', { name: 'Artifacts' }))
    expect(screen.getByRole('tab', { name: 'Original video' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(get).not.toHaveBeenCalledWith(
      '/api/task/task_sr/original',
      expect.anything()
    )
  })
})

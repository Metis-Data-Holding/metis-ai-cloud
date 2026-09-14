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
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { TaskLog } from '../../types'
import { TaskDetailsDialog } from '../dialogs/task-details-dialog'

const task: TaskLog = {
  id: 1,
  user_id: 7,
  username: 'admin',
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
      source_resolution: '720p',
      target_resolution: '4K',
      preserve_original: true,
      original_available: true,
      output_duration: 8,
      output_width: 3840,
      output_height: 2160,
      output_fps: 30,
      estimate_usd: 0.12,
      cleanup_status: 'retained',
    },
  },
}

afterEach(() => {
  vi.restoreAllMocks()
})

function renderDetails(isAdmin: boolean) {
  render(
    <TaskDetailsDialog
      log={task}
      isAdmin={isAdmin}
      isRoot={false}
      open
      onOpenChange={() => undefined}
    />
  )
}

describe('task details super-resolution section', () => {
  test('shows administrator details without an original download action', () => {
    renderDetails(true)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Super-resolution')
    expect(dialog).toHaveTextContent('720p')
    expect(dialog).toHaveTextContent('4K')
    expect(dialog).toHaveTextContent('0.12 USD')
    expect(
      screen.queryByRole('button', { name: 'Download original video' })
    ).not.toBeInTheDocument()
  })

  test('does not expose administrator details to a regular user', () => {
    renderDetails(false)

    expect(screen.getByRole('dialog')).not.toHaveTextContent('Super-resolution')
    expect(
      screen.queryByRole('button', { name: 'Download original video' })
    ).not.toBeInTheDocument()
  })
})

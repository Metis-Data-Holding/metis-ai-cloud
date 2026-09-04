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
import { describe, expect, test } from 'vitest'

import {
  getSystemTaskDetail,
  getSystemTaskTypeLabel,
} from '../system-task-display'

describe('system task display', () => {
  test('maps the reference cleanup task to its localized source key', () => {
    expect(getSystemTaskTypeLabel('video_reference_cleanup')).toBe(
      'Reference content cleanup'
    )
  })

  test('summarizes cleaned reference video files and released storage', () => {
    expect(
      getSystemTaskDetail({
        id: 1,
        task_id: 'system_task_1',
        type: 'video_reference_cleanup',
        status: 'succeeded',
        created_at: 1,
        updated_at: 2,
        result: {
          scanned: 7,
          deleted: 3,
          failed: 1,
          freed_bytes: 1536,
        },
      })
    ).toEqual({
      key: 'Scanned {{scanned}} reference video files; cleaned {{deleted}}, failed {{failed}}, freed {{size}}.',
      values: { scanned: 7, deleted: 3, failed: 1, size: '1.5 KB' },
      destructive: false,
    })
  })

  test('keeps task errors as the highest-priority detail', () => {
    expect(
      getSystemTaskDetail({
        id: 1,
        task_id: 'system_task_1',
        type: 'video_reference_cleanup',
        status: 'failed',
        error: 'permission denied',
        created_at: 1,
        updated_at: 2,
        result: { scanned: 2, deleted: 0, failed: 1, freed_bytes: 0 },
      })
    ).toEqual({ text: 'permission denied', destructive: true })
  })
})

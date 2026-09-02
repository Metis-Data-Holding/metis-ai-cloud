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

import { getUsageLogTypeLabelKey } from '../utils'

describe('async task usage log labels', () => {
  test('labels the initial async task charge as pre-consumed', () => {
    expect(
      getUsageLogTypeLabelKey(2, {
        is_task: true,
        task_id: 'task_1',
      })
    ).toBe('Pre-consumed')
  })

  test('labels a positive task settlement as an additional charge', () => {
    expect(
      getUsageLogTypeLabelKey(2, {
        task_id: 'task_1',
        pre_consumed_quota: 100,
        actual_quota: 120,
      })
    ).toBe('Additional charge')
  })

  test('keeps a task refund labeled as a refund', () => {
    expect(
      getUsageLogTypeLabelKey(6, {
        task_id: 'task_1',
        pre_consumed_quota: 120,
        actual_quota: 100,
      })
    ).toBe('Refund')
  })

  test('keeps a regular consumption log labeled as consume', () => {
    expect(getUsageLogTypeLabelKey(2, {})).toBe('Consume')
  })
})

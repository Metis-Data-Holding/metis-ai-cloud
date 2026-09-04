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

import { getTaskLogModelLabel } from '../task-log-display'

describe('task log model label', () => {
  test('prefers the display-name snapshot', () => {
    expect(
      getTaskLogModelLabel({
        display_model_name: ' Seedance 2.0 ',
        origin_model_name: 'dreamina-seedance-2-0-260128',
        upstream_model_name: 'ep-20260904',
      })
    ).toBe('Seedance 2.0')
  })

  test('falls back to the public model id for historical tasks', () => {
    expect(
      getTaskLogModelLabel({
        origin_model_name: 'dreamina-seedance-2-0-260128',
        upstream_model_name: 'ep-20260904',
      })
    ).toBe('dreamina-seedance-2-0-260128')
  })

  test('uses the upstream model only when public metadata is absent', () => {
    expect(getTaskLogModelLabel({ upstream_model_name: 'ep-20260904' })).toBe(
      'ep-20260904'
    )
    expect(getTaskLogModelLabel(undefined)).toBeNull()
  })
})

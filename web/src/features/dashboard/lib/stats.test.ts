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

import { calculateDashboardStats } from './stats'

describe('calculateDashboardStats', () => {
  test('aggregates cache tokens while ignoring missing, negative and non-finite values', () => {
    expect(
      calculateDashboardStats([
        {
          created_at: 1,
          quota: 10,
          count: 2,
          token_used: 30,
          cache_read_tokens: 40,
          cache_creation_tokens: 50,
        },
        { created_at: 2 },
        {
          created_at: 3,
          cache_read_tokens: -1,
          cache_creation_tokens: Number.POSITIVE_INFINITY,
        },
      ])
    ).toEqual({
      totalQuota: 10,
      totalCount: 2,
      totalTokens: 30,
      totalCacheReadTokens: 40,
      totalCacheCreationTokens: 50,
    })
  })
})

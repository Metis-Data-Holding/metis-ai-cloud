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
import { renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { getUserGroups, getUserModels } from '../../api'
import { usePlaygroundOptions } from '../use-playground-options'

vi.mock('../../api', () => ({
  getUserGroups: vi.fn(),
  getUserModels: vi.fn(),
}))

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper(props: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        {props.children}
      </QueryClientProvider>
    )
  }
}

describe('usePlaygroundOptions', () => {
  beforeEach(() => {
    vi.mocked(getUserModels).mockResolvedValue([])
    vi.mocked(getUserGroups).mockResolvedValue([])
  })

  test('loads only chat-completions models for the chat playground', async () => {
    renderHook(
      () =>
        usePlaygroundOptions({
          currentGroup: 'default',
          currentModel: '',
          setGroups: vi.fn(),
          setModels: vi.fn(),
          updateConfig: vi.fn(),
        }),
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(getUserModels).toHaveBeenCalledWith('default', 'openai')
    )
  })
})

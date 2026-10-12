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
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'

import { ImagePlayground } from '../image-playground'

const originalAdapter = api.defaults.adapter
const requests: { url?: string; data: unknown }[] = []
let client: QueryClient
let status = 'SUCCESS'
let statusError = false
let contentError = false
let submitError = false
let groupName = 'default'
let models: string[] = []
beforeEach(() => {
  requests.length = 0
  status = 'SUCCESS'
  statusError = false
  contentError = false
  submitError = false
  groupName = 'default'
  models = ['qwen-image-2.1']
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  api.defaults.adapter = async (config) => {
    requests.push({ url: config.url, data: config.data })
    let data: unknown = { success: true, data: models }
    if (config.url?.includes('self/groups')) {
      data = {
        success: true,
        data: { [groupName]: { desc: 'Default', ratio: 1 } },
      }
    }
    if (config.method === 'post' && submitError) {
      throw new Error('Submission failed')
    }
    if (config.method === 'post') {
      data = { task_id: 'image-1', status: 'queued' }
    }
    if (config.url === '/pg/tasks/image-1') {
      if (statusError) throw new Error('Status unavailable')
      data = { task_id: 'image-1', status, fail_reason: 'GPU failed' }
    }
    if (config.url?.includes('/artifacts/')) {
      if (contentError) throw new Error('Image unavailable')
      data = new Blob(['image'], { type: 'image/png' })
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config }
  }
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:image')
      static revokeObjectURL = vi.fn()
    }
  )
})
afterEach(() => {
  client.clear()
  api.defaults.adapter = originalAdapter
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

test('submits seed zero and previews and downloads the completed image', async () => {
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <ImagePlayground />
    </QueryClientProvider>
  )
  await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'A cat')
  const seed = screen.getByRole('textbox', { name: 'Seed' })
  await user.clear(seed)
  await user.type(seed, '0')
  const submit = screen.getByRole('button', { name: 'Generate image' })
  await waitFor(() => expect(submit).toBeEnabled())
  await user.click(submit)
  await screen.findByRole('img', { name: 'Generated image' })
  expect(
    screen.getByRole('button', { name: 'Download image' })
  ).toHaveAttribute('href', 'blob:image')
  expect(
    JSON.parse(
      String(requests.find((r) => r.url === '/pg/tasks/qwen-image-21')?.data)
    )
  ).toEqual({
    model: 'qwen-image-2.1',
    prompt: 'A cat',
    n: 1,
    size: '1024x1024',
    seed: 0,
  })
})

test.each(['-1', '1.5', '9007199254740992', 'abc'])(
  'rejects invalid seed %s before submission',
  async (seed) => {
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={client}>
        <ImagePlayground />
      </QueryClientProvider>
    )
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Cat')
    await user.clear(screen.getByRole('textbox', { name: 'Seed' }))
    await user.type(screen.getByRole('textbox', { name: 'Seed' }), seed)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Seed must be a non-negative safe integer'
    )
    expect(
      screen.getByRole('button', { name: 'Generate image' })
    ).toBeDisabled()
    expect(
      requests.filter((r) => r.url === '/pg/tasks/qwen-image-21')
    ).toHaveLength(0)
  }
)

test('keeps group selection available when the group has no supported model', async () => {
  models = ['unsupported']
  render(
    <QueryClientProvider client={client}>
      <ImagePlayground />
    </QueryClientProvider>
  )
  await screen.findByText('No image models available in this group')
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeDisabled()
  expect(screen.getByRole('combobox')).toBeEnabled()
})

test('blocks duplicate generation while the task is running', async () => {
  status = 'IN_PROGRESS'
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <ImagePlayground />
    </QueryClientProvider>
  )
  await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Cat')
  await user.dblClick(screen.getByRole('button', { name: 'Generate image' }))
  await screen.findByText('Generating image')
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeDisabled()
  expect(
    requests.filter((r) => r.url === '/pg/tasks/qwen-image-21')
  ).toHaveLength(1)
})

test('shows a failed task reason and allows a new generation', async () => {
  status = 'FAILURE'
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <ImagePlayground />
    </QueryClientProvider>
  )
  await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Cat')
  await user.click(screen.getByRole('button', { name: 'Generate image' }))
  await screen.findByText('GPU failed')
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Generate image' })).toBeEnabled()
  )
})

test.each(['status', 'content'])(
  'retries a failed %s request without submitting another task',
  async (boundary) => {
    statusError = boundary === 'status'
    contentError = boundary === 'content'
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={client}>
        <ImagePlayground />
      </QueryClientProvider>
    )
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Cat')
    await user.click(screen.getByRole('button', { name: 'Generate image' }))
    await screen.findByText(
      boundary === 'status' ? 'Status unavailable' : 'Image unavailable'
    )
    statusError = false
    contentError = false
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('img', { name: 'Generated image' })
    expect(
      requests.filter((r) => r.url === '/pg/tasks/qwen-image-21')
    ).toHaveLength(1)
  }
)

test('retains the image form and result when switching tabs', async () => {
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <Tabs defaultValue='image'>
        <TabsList>
          <TabsTrigger value='image'>Image</TabsTrigger>
          <TabsTrigger value='other'>Other</TabsTrigger>
        </TabsList>
        <TabsContent value='image' keepMounted>
          <ImagePlayground />
        </TabsContent>
        <TabsContent value='other'>Other panel</TabsContent>
      </Tabs>
    </QueryClientProvider>
  )
  await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Cat')
  await user.click(screen.getByRole('button', { name: 'Generate image' }))
  await screen.findByRole('img', { name: 'Generated image' })
  await user.click(screen.getByRole('tab', { name: 'Other' }))
  await user.click(screen.getByRole('tab', { name: 'Image' }))
  expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Cat')
  expect(screen.getByRole('img', { name: 'Generated image' })).toBeVisible()
})

test('Enter submission preserves prompt and seed after a server rejection', async () => {
  submitError = true
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <ImagePlayground />
    </QueryClientProvider>
  )
  const prompt = screen.getByRole('textbox', { name: 'Prompt' })
  const seed = screen.getByRole('textbox', { name: 'Seed' })
  await user.clear(seed)
  await user.type(seed, '0')
  await user.type(prompt, 'Keep this prompt{Enter}')
  await screen.findByText('Submission failed')
  expect(prompt).toHaveValue('Keep this prompt')
  expect(seed).toHaveValue('0')
  submitError = false
  await user.type(prompt, ' again{Enter}')
  await screen.findByRole('img', { name: 'Generated image' })
  const submitted = requests.filter((r) => r.url === '/pg/tasks/qwen-image-21')
  expect(JSON.parse(String(submitted[1]?.data))).toMatchObject({
    prompt: 'Keep this prompt again',
    seed: 0,
  })
})

test('uses an available group when default is not permitted', async () => {
  groupName = 'team'
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <ImagePlayground />
    </QueryClientProvider>
  )
  await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Cat')
  await user.click(screen.getByRole('button', { name: 'Generate image' }))
  await screen.findByRole('img', { name: 'Generated image' })
  expect(screen.getByRole('combobox')).toHaveTextContent('team')
})

test('polls a running task and stops polling when it completes', async () => {
  status = 'IN_PROGRESS'
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <ImagePlayground />
    </QueryClientProvider>
  )
  await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Cat')
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Generate image' })).toBeEnabled()
  )
  vi.useFakeTimers()
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100)
  })
  expect(
    requests.filter((request) => request.url === '/pg/tasks/image-1')
  ).toHaveLength(1)
  status = 'SUCCESS'
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3100)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100)
  })
  expect(
    screen.getByRole('img', { name: 'Generated image' })
  ).toBeInTheDocument()
  const polls = requests.filter(
    (request) => request.url === '/pg/tasks/image-1'
  ).length
  await act(async () => {
    await vi.advanceTimersByTimeAsync(9000)
  })
  expect(
    requests.filter((request) => request.url === '/pg/tasks/image-1')
  ).toHaveLength(polls)
})

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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import { Playground } from '..'

vi.mock('../components/chat/playground-chat', () => ({
  PlaygroundChat: () => <div>chat playground</div>,
}))
vi.mock('../components/input/playground-input', () => ({
  PlaygroundInput: () => <div>chat input</div>,
}))
vi.mock('../components/video/video-playground', () => ({
  VideoPlayground: () => <div>video playground</div>,
}))
vi.mock('../hooks', () => ({
  usePlaygroundState: () => ({
    config: { group: 'default', model: '' },
    parameterEnabled: {},
    messages: [],
    isLoadingMessages: false,
    models: [],
    groups: [],
    updateMessages: vi.fn(),
    setModels: vi.fn(),
    setGroups: vi.fn(),
    updateConfig: vi.fn(),
    updateParameterEnabled: vi.fn(),
    clearMessages: vi.fn(),
  }),
  useChatHandler: () => ({
    sendChat: vi.fn(),
    stopGeneration: vi.fn(),
    isGenerating: false,
  }),
  usePlaygroundConversation: () => ({
    editingMessageKey: null,
    handleSendMessage: vi.fn(),
    handleRegenerateMessage: vi.fn(),
    handleEditMessage: vi.fn(),
    handleEditOpenChange: vi.fn(),
    applyEdit: vi.fn(),
    handleDeleteMessage: vi.fn(),
  }),
  usePlaygroundOptions: () => ({ isLoadingModels: false }),
}))

describe('Playground mode navigation', () => {
  test('switches from chat to video generation', async () => {
    const user = userEvent.setup()
    render(<Playground />)

    const chatTab = screen.getByRole('tab', { name: 'Chat' })
    const videoTab = screen.getByRole('tab', { name: 'Video generation' })

    expect(chatTab).toHaveAttribute('aria-selected', 'true')
    await user.click(videoTab)
    expect(videoTab).toHaveAttribute('aria-selected', 'true')
  })

  test('keeps the video panel in the constrained flex height chain', async () => {
    const user = userEvent.setup()
    render(<Playground />)

    await user.click(screen.getByRole('tab', { name: 'Video generation' }))

    expect(screen.getByText('video playground').parentElement).toHaveClass(
      'flex',
      'min-h-0',
      'overflow-hidden'
    )
  })
})

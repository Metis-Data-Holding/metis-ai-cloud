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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import { ModelGroupSelector } from '../../model-group-selector'

const modelId = 'dreamina-seedance-2-0-260128'

const renderSelector = (onModelChange = vi.fn()) => {
  render(
    <ModelGroupSelector
      groups={[{ label: 'default', value: 'default' }]}
      models={[{ label: 'Seedance 2.0', value: modelId }]}
      onGroupChange={vi.fn()}
      onModelChange={onModelChange}
      selectedGroup='default'
      selectedModel={modelId}
    />
  )

  return onModelChange
}

describe('ModelGroupSelector display names', () => {
  test('shows the display name in the trigger and the model ID below it in the menu', async () => {
    const user = userEvent.setup()
    renderSelector()

    const trigger = screen.getByRole('combobox')
    expect(within(trigger).getByText('Seedance 2.0')).toBeInTheDocument()
    expect(within(trigger).queryByText(modelId)).not.toBeInTheDocument()

    await user.click(trigger)

    expect(screen.getByText(modelId)).toBeInTheDocument()
  })

  test('can find a display-named model by ID and returns the original ID', async () => {
    const user = userEvent.setup()
    const onModelChange = renderSelector()

    await user.click(screen.getByRole('combobox'))
    await user.type(screen.getByPlaceholderText('Search models...'), modelId)
    await user.click(screen.getAllByText('Seedance 2.0')[1])

    expect(onModelChange).toHaveBeenCalledWith(modelId)
  })
})

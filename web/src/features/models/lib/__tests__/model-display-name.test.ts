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
  transformFormDataToModelPayload,
  transformModelToFormDefaults,
} from '../model-form'

describe('model display name form mapping', () => {
  test('loads and saves the optional display name independently of model id', () => {
    const defaults = transformModelToFormDefaults({
      id: 1,
      model_name: 'dreamina-seedance-2-0-260128',
      display_name: 'Seedance 2.0',
      status: 1,
      sync_official: 0,
      created_time: 1,
      updated_time: 1,
      name_rule: 0,
    })

    expect(defaults.display_name).toBe('Seedance 2.0')
    expect(transformFormDataToModelPayload(defaults)).toMatchObject({
      model_name: 'dreamina-seedance-2-0-260128',
      display_name: 'Seedance 2.0',
    })
  })
})

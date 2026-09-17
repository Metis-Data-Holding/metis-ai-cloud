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
  channelSchema,
  type AdvancedCustomConfig,
  type AdvancedCustomConverter,
} from '../../types'
import {
  isAdvancedCustomPassThroughAllowed,
  validateAdvancedCustomConfig,
} from '../advanced-custom'
import {
  transformChannelToFormDefaults,
  transformFormDataToUpdatePayload,
} from '../channel-form'

const sglangRerankConverter = 'jina_rerank_to_sglang' as AdvancedCustomConverter

describe('Advanced Custom pass-through compatibility', () => {
  test('accepts pass-through for the SGLang rerank converter', () => {
    const config = {
      advanced_routes: [
        {
          incoming_path: '/v1/rerank',
          upstream_path: '/v1/rerank',
          converter: sglangRerankConverter,
          pass_through_body_enabled: true,
        },
      ],
    } satisfies AdvancedCustomConfig

    expect(isAdvancedCustomPassThroughAllowed(sglangRerankConverter)).toBe(true)
    expect(validateAdvancedCustomConfig(config)).toBeNull()
  })

  test('migrates legacy channel pass-through to supported routes on save', () => {
    const channel = channelSchema.parse({
      id: 1,
      name: 'Legacy Advanced Custom channel',
      key: '',
      type: 58,
      status: 1,
      created_time: 0,
      test_time: 0,
      response_time: 0,
      balance_updated_time: 0,
      setting: JSON.stringify({ pass_through_body_enabled: true }),
      settings: JSON.stringify({
        advanced_custom: {
          advanced_routes: [
            {
              incoming_path: '/v1/chat/completions',
              upstream_path: '/v1/chat/completions',
              converter: 'none',
            },
            {
              incoming_path: '/v1/rerank',
              upstream_path: '/v1/rerank',
              converter: 'jina_rerank_to_sglang',
            },
            {
              incoming_path: '/v1/messages',
              upstream_path: '/v1/chat/completions',
              converter: 'anthropic_messages_to_openai_chat_completions',
            },
            {
              incoming_path: '/v1/models',
              upstream_path: '/v1/models',
              converter: 'none',
            },
          ],
        },
      }),
    })

    const defaults = transformChannelToFormDefaults(channel)
    const payload = transformFormDataToUpdatePayload(defaults, channel.id)
    const savedSetting = JSON.parse(payload.setting || '{}')
    const savedSettings = JSON.parse(payload.settings || '{}')
    const routes = savedSettings.advanced_custom.advanced_routes

    expect(savedSetting.pass_through_body_enabled).toBe(false)
    expect(routes[0].pass_through_body_enabled).toBe(true)
    expect(routes[1].pass_through_body_enabled).toBe(true)
    expect(routes[2].pass_through_body_enabled).toBeUndefined()
    expect(routes[3].pass_through_body_enabled).toBeUndefined()
  })

  test('keeps legacy channel pass-through when no route can be migrated', () => {
    const channel = channelSchema.parse({
      id: 2,
      name: 'Legacy converter-only channel',
      key: '',
      type: 58,
      status: 1,
      created_time: 0,
      test_time: 0,
      response_time: 0,
      balance_updated_time: 0,
      setting: JSON.stringify({ pass_through_body_enabled: true }),
      settings: JSON.stringify({
        advanced_custom: {
          advanced_routes: [
            {
              incoming_path: '/v1/messages',
              upstream_path: '/v1/chat/completions',
              converter: 'anthropic_messages_to_openai_chat_completions',
            },
          ],
        },
      }),
    })

    const defaults = transformChannelToFormDefaults(channel)
    const payload = transformFormDataToUpdatePayload(defaults, channel.id)
    const savedSetting = JSON.parse(payload.setting || '{}')
    const savedSettings = JSON.parse(payload.settings || '{}')
    const route = savedSettings.advanced_custom.advanced_routes[0]

    expect(savedSetting.pass_through_body_enabled).toBe(true)
    expect(route.pass_through_body_enabled).toBeUndefined()
  })
})

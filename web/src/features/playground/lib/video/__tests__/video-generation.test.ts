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

import { videoFormSchema } from '../video-form-schema'
import {
  buildVideoGenerationRequest,
  getVideoResolutionOptions,
  isSupportedVideoPlaygroundModel,
  isTerminalVideoStatus,
  normalizeVideoResolution,
} from '../video-generation'

describe('video generation request', () => {
  test('builds the OpenAI video payload expected by the Doubao plugin', () => {
    expect(
      buildVideoGenerationRequest({
        model: 'dreamina-seedance-2-0-fast-260128',
        prompt: '  A paper boat crossing a neon river  ',
        seconds: 15,
        resolution: '480p',
        ratio: '16:9',
        generateAudio: false,
      })
    ).toEqual({
      model: 'dreamina-seedance-2-0-fast-260128',
      prompt: 'A paper boat crossing a neon river',
      seconds: 15,
      metadata: {
        resolution: '480p',
        ratio: '16:9',
        generate_audio: false,
      },
    })
  })

  test.each([5, 15])('accepts a duration of %s seconds', (seconds) => {
    expect(
      videoFormSchema.safeParse({
        group: 'default',
        model: 'dreamina-seedance-2-0-fast-260128',
        prompt: 'A paper boat crossing a neon river',
        seconds,
        resolution: '480p',
        ratio: '16:9',
        generateAudio: false,
      }).success
    ).toBe(true)
  })

  test.each([4, 16])('rejects a duration of %s seconds', (seconds) => {
    expect(
      videoFormSchema.safeParse({
        group: 'default',
        model: 'dreamina-seedance-2-0-fast-260128',
        prompt: 'A paper boat crossing a neon river',
        seconds,
        resolution: '480p',
        ratio: '16:9',
        generateAudio: false,
      }).success
    ).toBe(false)
  })
})

describe('video model constraints', () => {
  test('only enables the two Dreamina Seedance 2.0 model ids supported by the MVP', () => {
    expect(
      isSupportedVideoPlaygroundModel('dreamina-seedance-2-0-260128')
    ).toBe(true)
    expect(
      isSupportedVideoPlaygroundModel('dreamina-seedance-2-0-fast-260128')
    ).toBe(true)
    expect(isSupportedVideoPlaygroundModel('sora-2')).toBe(false)
    expect(isSupportedVideoPlaygroundModel('doubao-seedance-2-5-260628')).toBe(
      false
    )
  })

  test('limits Seedance 2.0 Fast to its supported resolutions', () => {
    expect(
      getVideoResolutionOptions('dreamina-seedance-2-0-fast-260128')
    ).toEqual(['480p', '720p'])
  })

  test('keeps the full Seedance 2.0 resolution set', () => {
    expect(getVideoResolutionOptions('dreamina-seedance-2-0-260128')).toEqual([
      '480p',
      '720p',
      '1080p',
      '4k',
    ])
  })

  test('falls back to 720p when a model change invalidates the resolution', () => {
    expect(
      normalizeVideoResolution('dreamina-seedance-2-0-fast-260128', '1080p')
    ).toBe('720p')
  })
})

describe('video task lifecycle', () => {
  test.each([
    ['queued', false],
    ['in_progress', false],
    ['completed', true],
    ['failed', true],
  ] as const)('treats %s terminal state as %s', (status, expected) => {
    expect(isTerminalVideoStatus(status)).toBe(expected)
  })
})

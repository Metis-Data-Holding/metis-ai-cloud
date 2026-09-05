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
  isTextOnlyVideoPlaygroundModel,
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
        mode: 'reference',
        content: [],
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

  test('adds multimodal reference content to the provider metadata', () => {
    expect(
      buildVideoGenerationRequest({
        model: 'dreamina-seedance-2-0-260128',
        prompt: 'Use the subject from image 1 and motion from video 1',
        seconds: 5,
        resolution: '720p',
        ratio: '16:9',
        generateAudio: false,
        mode: 'reference',
        content: [
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,AAAA' },
            role: 'reference_image',
          },
          {
            type: 'video_url',
            video_url: { url: 'https://example.com/motion.mp4' },
            role: 'reference_video',
          },
        ],
      })
    ).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          content: [
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,AAAA' },
              role: 'reference_image',
            },
            {
              type: 'video_url',
              video_url: { url: 'https://example.com/motion.mp4' },
              role: 'reference_video',
            },
          ],
        }),
      })
    )
  })

  test('preserves cross-media order used by ModelArk mention numbering', () => {
    const content = [
      {
        type: 'video_url' as const,
        video_url: { url: 'https://example.com/motion.mp4' },
        role: 'reference_video' as const,
      },
      {
        type: 'image_url' as const,
        image_url: { url: 'data:image/png;base64,AAAA' },
        role: 'reference_image' as const,
      },
    ]

    expect(
      buildVideoGenerationRequest({
        model: 'dreamina-seedance-2-0-260128',
        prompt: 'Use @Video 1 with @Image 1',
        seconds: 5,
        resolution: '720p',
        ratio: '16:9',
        generateAudio: true,
        mode: 'reference',
        content,
      }).metadata.content
    ).toEqual(content)
  })

  test('adds first and optional last frame roles in order', () => {
    const request = buildVideoGenerationRequest({
      model: 'dreamina-seedance-2-0-fast-260128',
      prompt: 'A natural transition',
      seconds: 5,
      resolution: '720p',
      ratio: '16:9',
      generateAudio: false,
      mode: 'keyframes',
      content: [
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,FIRST' },
          role: 'first_frame',
        },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,LAST' },
          role: 'last_frame',
        },
      ],
    })

    expect(request.metadata.content?.map((item) => item.role)).toEqual([
      'first_frame',
      'last_frame',
    ])
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
        mode: 'reference',
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
        mode: 'reference',
      }).success
    ).toBe(false)
  })

  test('allows an empty prompt for media-led generation', () => {
    expect(
      videoFormSchema.safeParse({
        group: 'default',
        model: 'dreamina-seedance-2-0-fast-260128',
        prompt: '',
        seconds: 5,
        resolution: '720p',
        ratio: '16:9',
        generateAudio: false,
        mode: 'keyframes',
      }).success
    ).toBe(true)
  })
})

describe('video model constraints', () => {
  test('enables the supported Dreamina Seedance and MiniMax H3 model ids', () => {
    expect(
      isSupportedVideoPlaygroundModel('dreamina-seedance-2-0-260128')
    ).toBe(true)
    expect(
      isSupportedVideoPlaygroundModel('dreamina-seedance-2-0-fast-260128')
    ).toBe(true)
    expect(isSupportedVideoPlaygroundModel('minimax-h3-fl2va')).toBe(true)
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

  test('keeps 1080p visible but normalizes it to 720p when an image is provided', () => {
    expect(
      getVideoResolutionOptions('dreamina-seedance-2-0-260128', true)
    ).toEqual(['480p', '720p', '1080p', '4k'])
    expect(
      normalizeVideoResolution('dreamina-seedance-2-0-260128', '1080p', true)
    ).toBe('720p')
  })

  test('falls back to 720p when a model change invalidates the resolution', () => {
    expect(
      normalizeVideoResolution('dreamina-seedance-2-0-fast-260128', '1080p')
    ).toBe('720p')
  })

  test('limits MiniMax H3 to its 768p text-to-video capability', () => {
    expect(getVideoResolutionOptions('minimax-h3-fl2va')).toEqual(['768p'])
    expect(
      normalizeVideoResolution('minimax-h3-fl2va', '720p')
    ).toBe('768p')
    expect(isTextOnlyVideoPlaygroundModel('minimax-h3-fl2va')).toBe(true)
    expect(
      isTextOnlyVideoPlaygroundModel('dreamina-seedance-2-0-260128')
    ).toBe(false)
  })

  test('accepts 768p in the shared video form schema', () => {
    expect(
      videoFormSchema.safeParse({
        group: 'default',
        model: 'minimax-h3-fl2va',
        prompt: 'City at night',
        seconds: 5,
        resolution: '768p',
        ratio: '16:9',
        generateAudio: false,
        mode: 'reference',
      }).success
    ).toBe(true)
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

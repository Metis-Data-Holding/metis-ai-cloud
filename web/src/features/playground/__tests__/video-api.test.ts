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
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { submitVideoGeneration } from '../api'
import type { VideoGenerationRequest } from '../types'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))

vi.mock('@/lib/api', () => ({ api: { post } }))

const task = {
  id: 'task-video-1',
  object: 'video',
  model: 'minimax-h3-fl2va',
  status: 'queued',
  progress: 0,
  created_at: 1,
}

function h3Request(
  content?: VideoGenerationRequest['metadata']['content']
): VideoGenerationRequest {
  return {
    model: 'minimax-h3-fl2va',
    prompt: 'Cat by the window',
    seconds: 5,
    metadata: {
      resolution: '768p',
      ratio: '16:9',
      generate_audio: false,
      ...(content ? { content } : {}),
    },
  }
}

describe('video submission transport', () => {
  beforeEach(() => {
    post.mockReset()
    post.mockResolvedValue({ data: task })
  })

  test('submits a MiniMax H3 first frame as multipart', async () => {
    await submitVideoGeneration(
      'default',
      h3Request([
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,aW1hZ2U=' },
          role: 'first_frame',
        },
      ])
    )

    expect(post).toHaveBeenCalledTimes(1)
    const body = post.mock.calls[0]?.[1]
    expect(body).toBeInstanceOf(FormData)
    if (!(body instanceof FormData)) return
    expect(body.get('model')).toBe('minimax-h3-fl2va')
    expect(body.get('prompt')).toBe('Cat by the window')
    expect(body.get('seconds')).toBe('5')
    expect(JSON.parse(String(body.get('metadata')))).toEqual({
      resolution: '768p',
      ratio: '16:9',
      generate_audio: false,
    })
    const image = body.get('input_reference')
    expect(image).toBeInstanceOf(File)
    if (!(image instanceof File)) return
    expect(image.type).toBe('image/png')
    expect(await image.text()).toBe('image')
  })

  test('keeps MiniMax H3 text-to-video and Seedance requests as JSON', async () => {
    const textRequest = h3Request()
    await submitVideoGeneration('default', textRequest)

    const seedanceRequest: VideoGenerationRequest = {
      ...textRequest,
      model: 'dreamina-seedance-2-0-260128',
      metadata: {
        ...textRequest.metadata,
        content: [
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,aW1hZ2U=' },
            role: 'reference_image',
          },
        ],
      },
    }
    await submitVideoGeneration('default', seedanceRequest)

    expect(post.mock.calls[0]?.[1]).toBe(textRequest)
    expect(post.mock.calls[1]?.[1]).toBe(seedanceRequest)
  })
})

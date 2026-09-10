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
import i18next from 'i18next'

import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { API_ENDPOINTS } from './constants'
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelOption,
  GroupOption,
  VideoGenerationRequest,
  VideoImageContent,
  VideoReferenceContent,
  VideoReferenceUpload,
  VideoTask,
} from './types'

/**
 * Send chat completion request (non-streaming)
 */
export async function sendChatCompletion(
  payload: ChatCompletionRequest,
  signal?: AbortSignal
): Promise<ChatCompletionResponse> {
  const res = await api.post(API_ENDPOINTS.CHAT_COMPLETIONS, payload, {
    signal,
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return res.data
}

export async function uploadVideoReference(
  file: File,
  onProgress?: (progress: number) => void
): Promise<VideoReferenceUpload> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await api.post(API_ENDPOINTS.VIDEO_REFERENCE_FILES, formData, {
    skipErrorHandler: true,
    onUploadProgress: (event) => {
      if (event.total && event.total > 0) {
        onProgress?.(
          Math.min(100, Math.round((event.loaded / event.total) * 100))
        )
      }
    },
  })
  return res.data.data
}

/**
 * Get user available models
 */
export function toModelOptions(
  models: string[],
  displayNames?: Record<string, string>
): ModelOption[] {
  return models.map((model) => {
    const displayName = displayNames?.[model]
    const label = typeof displayName === 'string' ? displayName.trim() : ''
    if (!label || label === model) {
      return { label: model, value: model }
    }
    return { label, value: model }
  })
}

export async function getUserModels(
  group: string,
  endpointType?: string
): Promise<ModelOption[]> {
  const res = await api.get(API_ENDPOINTS.USER_MODELS, {
    params: { group, endpoint_type: endpointType },
  })
  const { data } = res
  requireServerSuccess(data)

  if (!data.success || !Array.isArray(data.data)) {
    return []
  }

  const displayNames =
    data.model_display_names && typeof data.model_display_names === 'object'
      ? (data.model_display_names as Record<string, string>)
      : undefined
  return toModelOptions(data.data, displayNames)
}

export async function submitVideoGeneration(
  group: string,
  payload: VideoGenerationRequest
): Promise<VideoTask> {
  const content = payload.metadata.content ?? []
  const firstFrame = content.find(
    (item): item is VideoImageContent =>
      item.type === 'image_url' && item.role === 'first_frame'
  )
  const lastFrame = content.find(
    (item): item is VideoImageContent =>
      item.type === 'image_url' && item.role === 'last_frame'
  )
  const referenceImages = content.filter(
    (item): item is VideoImageContent => item.role === 'reference_image'
  )
  const referenceVideos = content.filter(
    (item): item is VideoReferenceContent => item.role === 'reference_video'
  )
  let body: VideoGenerationRequest | FormData = payload
  const isH3 = payload.model.toLowerCase() === 'minimax-h3-fl2va'
  const h3FrameCount = Number(Boolean(firstFrame)) + Number(Boolean(lastFrame))
  const hasH3References =
    referenceImages.length > 0 || referenceVideos.length > 0
  if (
    isH3 &&
    content.length > 0 &&
    !hasH3References &&
    (!firstFrame || content.length !== h3FrameCount)
  ) {
    throw new Error(i18next.t('Choose a supported image file.'))
  }
  if (isH3 && hasH3References) {
    if (
      firstFrame ||
      lastFrame ||
      content.length !== referenceImages.length + referenceVideos.length ||
      referenceImages.length > 2 ||
      referenceVideos.length > 1
    ) {
      throw new Error(i18next.t('Choose a supported image file.'))
    }
    const formData = new FormData()
    formData.append('model', payload.model)
    formData.append('prompt', payload.prompt)
    formData.append('seconds', String(payload.seconds))
    formData.append(
      'metadata',
      JSON.stringify({
        resolution: payload.metadata.resolution,
        ratio: payload.metadata.ratio,
        generate_audio: payload.metadata.generate_audio,
      })
    )
    referenceImages.forEach((image, index) => {
      formData.append(
        `reference_image_${index}`,
        imageContentFile(image, `reference-${index}`)
      )
    })
    const videoFiles = await Promise.all(
      referenceVideos.map(async (video, index) => {
        const url = new URL(video.video_url.url, window.location.origin)
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          !/^\/v1\/video-reference-files\/[0-9A-Za-z]{24}\.(?:mp4|mov)\/content$/.test(
            url.pathname
          ) ||
          !url.searchParams.has('expires') ||
          !url.searchParams.has('access')
        ) {
          throw new Error(i18next.t('Unable to upload the reference video.'))
        }
        const response = await fetch(url, { credentials: 'omit' })
        if (!response.ok) {
          throw new Error(i18next.t('Unable to upload the reference video.'))
        }
        const blob = await response.blob()
        const type =
          blob.type === 'video/quicktime' ? 'video/quicktime' : 'video/mp4'
        const extension = type === 'video/quicktime' ? 'mov' : 'mp4'
        return new File([blob], `reference-${index}.${extension}`, { type })
      })
    )
    videoFiles.forEach((video, index) => {
      formData.append(`reference_video_${index}`, video)
    })
    body = formData
  } else if (isH3 && firstFrame) {
    const formData = new FormData()
    formData.append('model', payload.model)
    formData.append('prompt', payload.prompt)
    formData.append('seconds', String(payload.seconds))
    formData.append(
      'metadata',
      JSON.stringify({
        resolution: payload.metadata.resolution,
        ratio: payload.metadata.ratio,
        generate_audio: payload.metadata.generate_audio,
      })
    )
    formData.append('input_reference', imageContentFile(firstFrame, 'first'))
    if (lastFrame) {
      formData.append('input_last_frame', imageContentFile(lastFrame, 'last'))
    }
    body = formData
  }
  const res = await api.post(API_ENDPOINTS.VIDEOS, body, {
    params: { group },
    skipErrorHandler: true,
  })
  return res.data
}

function imageContentFile(content: VideoImageContent, frame: string): File {
  const match = content.image_url.url.match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/
  )
  if (!match) {
    throw new Error(i18next.t('Choose a supported image file.'))
  }
  let binary: string
  try {
    binary = atob(match[2])
  } catch {
    throw new Error(i18next.t('Choose a supported image file.'))
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  const extension = match[1] === 'image/jpeg' ? 'jpg' : match[1].slice(6)
  return new File([bytes], `${frame}-frame.${extension}`, { type: match[1] })
}

export async function getVideoGeneration(taskId: string): Promise<VideoTask> {
  const res = await api.get(`${API_ENDPOINTS.VIDEOS}/${taskId}`, {
    disableDuplicate: true,
    skipErrorHandler: true,
  })
  return res.data
}

export async function getVideoContent(taskId: string): Promise<Blob> {
  const res = await api.get(`${API_ENDPOINTS.VIDEOS}/${taskId}/content`, {
    disableDuplicate: true,
    responseType: 'blob',
    skipErrorHandler: true,
  })
  return res.data
}

/**
 * Get user groups
 */
export async function getUserGroups(): Promise<GroupOption[]> {
  const res = await api.get(API_ENDPOINTS.USER_GROUPS)
  const { data } = res
  requireServerSuccess(data)

  if (!data.success || !data.data) {
    return []
  }

  const groupData = data.data as Record<string, { desc: string; ratio: number }>

  // label is for button display (name only); desc is for dropdown content
  return Object.entries(groupData).map(([group, info]) => ({
    label: group,
    value: group,
    ratio: info.ratio,
    desc: info.desc,
  }))
}

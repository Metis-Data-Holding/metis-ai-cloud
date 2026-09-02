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
import { api } from '@/lib/api'

import { API_ENDPOINTS } from './constants'
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelOption,
  GroupOption,
  VideoGenerationRequest,
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
        onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)))
      }
    },
  })
  return res.data.data
}

/**
 * Get user available models
 */
export async function getUserModels(
  group: string,
  endpointType?: string
): Promise<ModelOption[]> {
  const res = await api.get(API_ENDPOINTS.USER_MODELS, {
    params: { group, endpoint_type: endpointType },
  })
  const { data } = res

  if (!data.success || !Array.isArray(data.data)) {
    return []
  }

  return data.data.map((model: string) => ({
    label: model,
    value: model,
  }))
}

export async function submitVideoGeneration(
  group: string,
  payload: VideoGenerationRequest
): Promise<VideoTask> {
  const res = await api.post(API_ENDPOINTS.VIDEOS, payload, {
    params: { group },
    skipErrorHandler: true,
  })
  return res.data
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

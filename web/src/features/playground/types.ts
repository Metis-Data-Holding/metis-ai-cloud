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
// Message types
export type MessageRole = 'user' | 'assistant' | 'system'

export type MessageStatus = 'loading' | 'streaming' | 'complete' | 'error'

export type PlaygroundMessageLayoutMode = 'alternating' | 'left'

export interface MessageVersion {
  id: string
  content: string
}

export interface Message {
  key: string
  from: MessageRole
  versions: MessageVersion[]
  createdAt?: number
  startedAt?: number
  completedAt?: number
  durationMs?: number
  sources?: { href: string; title: string }[]
  reasoning?: {
    content: string
    duration: number
    startedAt?: number
    completedAt?: number
    durationMs?: number
  }
  isReasoningStreaming?: boolean
  isReasoningComplete?: boolean
  isContentComplete?: boolean
  status?: MessageStatus
  errorCode?: string | null
}

// API payload types
export interface ChatCompletionMessage {
  role: MessageRole
  content: string | ContentPart[]
}

export interface ContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: {
    url: string
  }
}

export interface ChatCompletionRequest {
  model: string
  group?: string
  messages: ChatCompletionMessage[]
  stream: boolean
  temperature?: number
  top_p?: number
  max_tokens?: number
  frequency_penalty?: number
  presence_penalty?: number
  seed?: number
}

export interface ChatCompletionChunk {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: MessageRole
      content?: string
      reasoning_content?: string
    }
    finish_reason: string | null
  }>
}

export interface ChatCompletionResponse {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: MessageRole
      content: string
      reasoning_content?: string
    }
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

// Configuration types
export interface PlaygroundConfig {
  model: string
  group: string
  temperature: number
  top_p: number
  max_tokens: number
  frequency_penalty: number
  presence_penalty: number
  seed: number | null
  stream: boolean
}

export interface ParameterEnabled {
  temperature: boolean
  top_p: boolean
  max_tokens: boolean
  frequency_penalty: boolean
  presence_penalty: boolean
  seed: boolean
}

// Model and group options
export interface ModelOption {
  label: string
  value: string
}

export interface GroupOption {
  label: string
  value: string
  ratio: number
  desc?: string
}

export type VideoResolution = '480p' | '720p' | '1080p' | '4k'
export type VideoAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4'
export type VideoGenerationMode = 'reference' | 'keyframes'
export type VideoImageRole = 'reference_image' | 'first_frame' | 'last_frame'

export interface VideoImageContent {
  type: 'image_url'
  image_url: { url: string }
  role: VideoImageRole
}

export interface VideoReferenceContent {
  type: 'video_url'
  video_url: { url: string }
  role: 'reference_video'
}

export interface VideoReferenceUpload {
  id: string
  url: string
  name: string
  content_type: 'video/mp4' | 'video/quicktime'
  size: number
}

export type VideoInputContent = VideoImageContent | VideoReferenceContent
export type VideoTaskStatus =
  | 'unknown'
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'

export interface VideoGenerationConfig {
  model: string
  prompt: string
  seconds: number
  resolution: VideoResolution
  ratio: VideoAspectRatio
  generateAudio: boolean
  mode: VideoGenerationMode
  content: VideoInputContent[]
}

export interface VideoGenerationRequest {
  model: string
  prompt: string
  seconds: number
  metadata: {
    resolution: VideoResolution
    ratio: VideoAspectRatio
    generate_audio: boolean
    content?: VideoInputContent[]
  }
}

export interface VideoTask {
  id: string
  object: 'video'
  model: string
  status: VideoTaskStatus
  progress: number
  created_at: number
  completed_at?: number
  expires_at?: number
  seconds?: string
  error?: {
    code: string
    message: string
  }
}

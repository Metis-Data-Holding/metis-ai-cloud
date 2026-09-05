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
import type {
  VideoGenerationConfig,
  VideoGenerationRequest,
  VideoResolution,
  VideoTaskStatus,
} from '../../types'

const FULL_RESOLUTIONS: VideoResolution[] = ['480p', '720p', '1080p', '4k']
const FAST_RESOLUTIONS: VideoResolution[] = ['480p', '720p']
const H3_RESOLUTIONS: VideoResolution[] = ['768p']
const H3_MODEL = 'minimax-h3-fl2va'

export function isTextOnlyVideoPlaygroundModel(model: string): boolean {
  return model.toLowerCase() === H3_MODEL
}

export function isSupportedVideoPlaygroundModel(model: string): boolean {
  const normalized = model.toLowerCase()
  return (
    normalized.includes('dreamina-seedance-2-0-260128') ||
    normalized.includes('dreamina-seedance-2-0-fast-260128') ||
    normalized === H3_MODEL
  )
}

export function getVideoResolutionOptions(
  model: string,
  _hasImageInput = false
): VideoResolution[] {
  if (isTextOnlyVideoPlaygroundModel(model)) {
    return H3_RESOLUTIONS
  }
  if (model.toLowerCase().includes('seedance-2-0-fast')) {
    return FAST_RESOLUTIONS
  }
  return FULL_RESOLUTIONS
}

export function isVideoResolutionDisabled(
  model: string,
  resolution: VideoResolution,
  hasImageInput = false
): boolean {
  return (
    hasImageInput &&
    resolution === '1080p' &&
    model.toLowerCase().includes('dreamina-seedance-2-0-260128')
  )
}

export function normalizeVideoResolution(
  model: string,
  resolution: VideoResolution,
  hasImageInput = false
): VideoResolution {
  const options = getVideoResolutionOptions(model, hasImageInput)
  const isDisabled = isVideoResolutionDisabled(model, resolution, hasImageInput)
  if (options.includes(resolution) && !isDisabled) return resolution
  return isTextOnlyVideoPlaygroundModel(model) ? '768p' : '720p'
}

export function buildVideoGenerationRequest(
  config: VideoGenerationConfig
): VideoGenerationRequest {
  const hasImageInput = config.content.some((item) => item.type === 'image_url')
  const metadata: VideoGenerationRequest['metadata'] = {
    resolution: normalizeVideoResolution(
      config.model,
      config.resolution,
      hasImageInput
    ),
    ratio: config.ratio,
    generate_audio: config.generateAudio,
  }
  if (config.content.length > 0) {
    metadata.content = config.content
  }

  return {
    model: config.model,
    prompt: config.prompt.trim(),
    seconds: config.seconds,
    metadata,
  }
}

export function isTerminalVideoStatus(status: VideoTaskStatus): boolean {
  return status === 'completed' || status === 'failed'
}

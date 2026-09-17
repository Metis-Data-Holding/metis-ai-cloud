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
import {
  VIDEO_ASPECT_RATIO_OPTIONS,
  VIDEO_DURATION_OPTIONS,
  WAN_VIDEO_DURATION_OPTIONS,
} from '../../constants'
import type {
  VideoAspectRatio,
  VideoGenerationConfig,
  VideoGenerationMode,
  VideoGenerationRequest,
  VideoResolution,
  VideoTaskStatus,
} from '../../types'

const FULL_RESOLUTIONS: VideoResolution[] = ['480p', '720p', '1080p', '4k']
const FAST_RESOLUTIONS: VideoResolution[] = ['480p', '720p']
const H3_RESOLUTIONS: VideoResolution[] = ['768p']
const WAN_RESOLUTIONS: VideoResolution[] = ['480p', '720p', '1080p']
const DEFAULT_ASPECT_RATIOS: VideoAspectRatio[] = [
  ...VIDEO_ASPECT_RATIO_OPTIONS,
]
const H3_ASPECT_RATIOS: VideoAspectRatio[] = ['21:9', ...DEFAULT_ASPECT_RATIOS]
const H3_MODEL = 'minimax-h3-fl2va'
const WAN_MODELS = new Set(['alibaba/wan-3.0', 'alibaba/wan-3.0-prime'])

export function isOpenRouterWanVideoPlaygroundModel(model: string): boolean {
  return WAN_MODELS.has(model.toLowerCase())
}

export function isMinimaxH3VideoPlaygroundModel(model: string): boolean {
  return model.toLowerCase() === H3_MODEL
}

export function isSupportedVideoPlaygroundModel(model: string): boolean {
  const normalized = model.toLowerCase()
  return (
    normalized.includes('dreamina-seedance-2-0-260128') ||
    normalized.includes('dreamina-seedance-2-0-fast-260128') ||
    normalized === H3_MODEL ||
    isOpenRouterWanVideoPlaygroundModel(normalized)
  )
}

export function getVideoGenerationModes(model: string): VideoGenerationMode[] {
  return isOpenRouterWanVideoPlaygroundModel(model)
    ? ['text', 'first_frame']
    : ['reference', 'keyframes']
}

export function getVideoDurationOptions(model: string): number[] {
  return isOpenRouterWanVideoPlaygroundModel(model)
    ? [...WAN_VIDEO_DURATION_OPTIONS]
    : [...VIDEO_DURATION_OPTIONS]
}

export function getVideoResolutionOptions(
  model: string,
  _hasImageInput = false
): VideoResolution[] {
  if (isMinimaxH3VideoPlaygroundModel(model)) {
    return H3_RESOLUTIONS
  }
  if (isOpenRouterWanVideoPlaygroundModel(model)) {
    return WAN_RESOLUTIONS
  }
  if (model.toLowerCase().includes('seedance-2-0-fast')) {
    return FAST_RESOLUTIONS
  }
  return FULL_RESOLUTIONS
}

export function getVideoAspectRatioOptions(model: string): VideoAspectRatio[] {
  return isMinimaxH3VideoPlaygroundModel(model)
    ? H3_ASPECT_RATIOS
    : DEFAULT_ASPECT_RATIOS
}

export function normalizeVideoAspectRatio(
  model: string,
  ratio: VideoAspectRatio
): VideoAspectRatio {
  return getVideoAspectRatioOptions(model).includes(ratio) ? ratio : '16:9'
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
  if (isMinimaxH3VideoPlaygroundModel(model)) return '768p'
  return '720p'
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

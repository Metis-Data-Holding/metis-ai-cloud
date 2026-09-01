/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or (at your option)
any later version.

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

export function isSupportedVideoPlaygroundModel(model: string): boolean {
  const normalized = model.toLowerCase()
  return (
    normalized.includes('dreamina-seedance-2-0-260128') ||
    normalized.includes('dreamina-seedance-2-0-fast-260128')
  )
}

export function getVideoResolutionOptions(model: string): VideoResolution[] {
  if (model.toLowerCase().includes('seedance-2-0-fast')) {
    return FAST_RESOLUTIONS
  }
  return FULL_RESOLUTIONS
}

export function normalizeVideoResolution(
  model: string,
  resolution: VideoResolution
): VideoResolution {
  const options = getVideoResolutionOptions(model)
  return options.includes(resolution) ? resolution : '720p'
}

export function buildVideoGenerationRequest(
  config: VideoGenerationConfig
): VideoGenerationRequest {
  return {
    model: config.model,
    prompt: config.prompt.trim(),
    seconds: config.seconds,
    metadata: {
      resolution: normalizeVideoResolution(config.model, config.resolution),
      ratio: config.ratio,
    },
  }
}

export function isTerminalVideoStatus(status: VideoTaskStatus): boolean {
  return status === 'completed' || status === 'failed'
}

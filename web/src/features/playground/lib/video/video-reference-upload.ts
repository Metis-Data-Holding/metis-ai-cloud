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
export const MAX_REFERENCE_VIDEO_BYTES = 80 * 1024 * 1024
export const MIN_REFERENCE_VIDEO_SECONDS = 2
export const MAX_REFERENCE_VIDEO_SECONDS = 15
export const MAX_COMBINED_REFERENCE_VIDEO_SECONDS = 15

export type ReferenceVideoValidationError =
  | 'format'
  | 'size'
  | 'duration'
  | 'total-duration'

export function validateReferenceVideoFile(
  file: File
): ReferenceVideoValidationError | null {
  const nameSupported = /\.(mp4|mov)$/i.test(file.name)
  const typeSupported =
    file.type === '' ||
    file.type.toLowerCase() === 'video/mp4' ||
    file.type.toLowerCase() === 'video/quicktime'
  if (!nameSupported || !typeSupported) {
    return 'format'
  }
  return file.size > MAX_REFERENCE_VIDEO_BYTES ? 'size' : null
}

export function validateReferenceVideoDuration(
  duration: number,
  existingDuration: number
): ReferenceVideoValidationError | null {
  if (
    !Number.isFinite(duration) ||
    duration < MIN_REFERENCE_VIDEO_SECONDS ||
    duration > MAX_REFERENCE_VIDEO_SECONDS
  ) {
    return 'duration'
  }
  if (existingDuration + duration > MAX_COMBINED_REFERENCE_VIDEO_SECONDS) {
    return 'total-duration'
  }
  return null
}

export function readReferenceVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const objectURL = URL.createObjectURL(file)
    const video = document.createElement('video')
    const cleanup = () => {
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(objectURL)
    }
    video.preload = 'metadata'
    video.addEventListener(
      'loadedmetadata',
      () => {
        const duration = video.duration
        cleanup()
        resolve(duration)
      },
      { once: true }
    )
    video.addEventListener(
      'error',
      () => {
        cleanup()
        reject(new Error('unable to read video metadata'))
      },
      { once: true }
    )
    video.src = objectURL
  })
}

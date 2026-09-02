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

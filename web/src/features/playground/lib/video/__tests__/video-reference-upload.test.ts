import { describe, expect, test } from 'vitest'

import {
  MAX_REFERENCE_VIDEO_BYTES,
  validateReferenceVideoFile,
  validateReferenceVideoDuration,
} from '../video-reference-upload'

describe('reference video upload validation', () => {
  test('accepts MP4 and MOV files up to and including 80 MB', () => {
    expect(
      validateReferenceVideoFile(
        new File(['video'], 'motion.mp4', { type: 'video/mp4' })
      )
    ).toBeNull()
    const mov = new File(['video'], 'motion.mov', { type: 'video/quicktime' })
    Object.defineProperty(mov, 'size', { value: MAX_REFERENCE_VIDEO_BYTES })
    expect(validateReferenceVideoFile(mov)).toBeNull()
  })

  test('rejects unsupported formats and files larger than 80 MB', () => {
    expect(
      validateReferenceVideoFile(
        new File(['video'], 'motion.webm', { type: 'video/webm' })
      )
    ).toBe('format')
    const oversized = new File(['video'], 'motion.mp4', { type: 'video/mp4' })
    Object.defineProperty(oversized, 'size', {
      value: MAX_REFERENCE_VIDEO_BYTES + 1,
    })
    expect(validateReferenceVideoFile(oversized)).toBe('size')
  })

  test('enforces the 2-15 second individual and 15 second combined limits', () => {
    expect(validateReferenceVideoDuration(1.9, 0)).toBe('duration')
    expect(validateReferenceVideoDuration(15.1, 0)).toBe('duration')
    expect(validateReferenceVideoDuration(8, 7)).toBeNull()
    expect(validateReferenceVideoDuration(8.1, 7)).toBe('total-duration')
  })
})

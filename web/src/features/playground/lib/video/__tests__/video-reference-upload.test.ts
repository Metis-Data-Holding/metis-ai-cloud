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

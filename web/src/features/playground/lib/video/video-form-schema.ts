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
import { z } from 'zod'

export const videoFormSchema = z
  .object({
    group: z.string().min(1, 'Select a group'),
    model: z.string().min(1, 'Select a video model'),
    prompt: z.string().trim(),
    seconds: z.number().int().min(2).max(30),
    resolution: z.enum(['480p', '720p', '768p', '1080p', '4k']),
    ratio: z.enum(['21:9', '16:9', '9:16', '1:1', '4:3', '3:4']),
    generateAudio: z.boolean(),
    quantity: z.number().int().min(1).max(4).default(1),
    mode: z.enum(['reference', 'keyframes', 'text', 'first_frame']),
  })
  .superRefine((values, context) => {
    if (
      !values.model.toLowerCase().startsWith('alibaba/wan-') &&
      (values.seconds < 5 || values.seconds > 15)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['seconds'],
        message: 'Video duration must be between 5 and 15 seconds',
      })
    }
  })

export type VideoFormValues = z.infer<typeof videoFormSchema>

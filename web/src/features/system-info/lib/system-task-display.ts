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
  SystemTask,
  VideoReferenceCleanupTaskResult,
} from '@/features/system-settings/types'

const TYPE_LABEL: Record<string, string> = {
  log_cleanup: 'Log cleanup',
  channel_test: 'Batch channel test',
  model_update: 'Batch upstream model update',
  midjourney_poll: 'Drawing task polling',
  async_task_poll: 'Async task polling',
  video_reference_cleanup: 'Reference content cleanup',
}

type SystemTaskDetail =
  | { text: string; destructive: true }
  | {
      key: string
      values: Record<string, string | number>
      destructive: false
    }
  | null

export function getSystemTaskTypeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  )
  const value = bytes / 1024 ** index
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: index === 0 ? 0 : 1,
  }).format(value)} ${units[index]}`
}

function isVideoReferenceCleanupResult(
  result: unknown
): result is VideoReferenceCleanupTaskResult {
  if (!result || typeof result !== 'object') return false
  const candidate = result as Record<string, unknown>
  return ['scanned', 'deleted', 'freed_bytes', 'failed'].every(
    (key) => typeof candidate[key] === 'number'
  )
}

export function getSystemTaskDetail(task: SystemTask): SystemTaskDetail {
  if (task.error) {
    return { text: task.error, destructive: true }
  }
  if (
    task.type !== 'video_reference_cleanup' ||
    !isVideoReferenceCleanupResult(task.result)
  ) {
    return null
  }
  return {
    key: 'Scanned {{scanned}} reference video files; cleaned {{deleted}}, failed {{failed}}, freed {{size}}.',
    values: {
      scanned: task.result.scanned,
      deleted: task.result.deleted,
      failed: task.result.failed,
      size: formatBytes(task.result.freed_bytes),
    },
    destructive: false,
  }
}

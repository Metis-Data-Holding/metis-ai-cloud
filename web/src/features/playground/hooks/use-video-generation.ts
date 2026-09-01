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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import {
  getVideoContent,
  getVideoGeneration,
  submitVideoGeneration,
} from '../api'
import { isTerminalVideoStatus } from '../lib/video/video-generation'
import type { VideoGenerationRequest, VideoTask } from '../types'

const VIDEO_POLL_INTERVAL_MS = 3_000

function videoTaskKey(taskId: string) {
  return ['playground', 'video-task', taskId] as const
}

function errorMessage(error: unknown): string | null {
  if (!error) {
    return null
  }
  if (typeof error === 'object' && error !== null) {
    const responseMessage = (
      error as { response?: { data?: { error?: { message?: unknown } } } }
    ).response?.data?.error?.message
    if (typeof responseMessage === 'string' && responseMessage.trim()) {
      return responseMessage
    }
  }
  return error instanceof Error ? error.message : String(error)
}

export function useVideoGeneration() {
  const queryClient = useQueryClient()
  const [taskId, setTaskId] = useState('')
  const [videoUrl, setVideoUrl] = useState<string | null>(null)

  const submission = useMutation({
    mutationFn: (input: { group: string; request: VideoGenerationRequest }) =>
      submitVideoGeneration(input.group, input.request),
    onSuccess: (task) => {
      queryClient.setQueryData(videoTaskKey(task.id), task)
      setTaskId(task.id)
    },
  })

  const taskQuery = useQuery({
    queryKey: videoTaskKey(taskId),
    queryFn: () => getVideoGeneration(taskId),
    enabled: taskId !== '',
    retry: false,
    staleTime: VIDEO_POLL_INTERVAL_MS,
    refetchInterval: (query) => {
      const task = query.state.data
      if (task && isTerminalVideoStatus(task.status)) {
        return false
      }
      return VIDEO_POLL_INTERVAL_MS
    },
  })

  const task = taskQuery.data ?? null
  const contentQuery = useQuery({
    queryKey: ['playground', 'video-content', taskId],
    queryFn: () => getVideoContent(taskId),
    enabled: task?.status === 'completed' && taskId !== '',
    retry: false,
  })

  useEffect(() => {
    if (!contentQuery.data) {
      setVideoUrl(null)
      return
    }
    const nextUrl = URL.createObjectURL(contentQuery.data)
    setVideoUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [contentQuery.data])

  const submit = async (
    group: string,
    request: VideoGenerationRequest
  ): Promise<VideoTask> => {
    setVideoUrl(null)
    setTaskId('')
    return submission.mutateAsync({ group, request })
  }

  const reset = () => {
    submission.reset()
    setTaskId('')
    setVideoUrl(null)
  }

  return {
    task,
    taskError: task?.error?.message ?? null,
    videoUrl,
    videoBlob: contentQuery.data ?? null,
    isSubmitting: submission.isPending,
    isPolling:
      task !== null &&
      !isTerminalVideoStatus(task.status) &&
      taskQuery.isFetching,
    isLoadingVideo: contentQuery.isFetching,
    submitError: errorMessage(submission.error),
    statusError: errorMessage(taskQuery.error),
    contentError: errorMessage(contentQuery.error),
    submit,
    retryStatus: taskQuery.refetch,
    retryContent: contentQuery.refetch,
    reset,
  }
}

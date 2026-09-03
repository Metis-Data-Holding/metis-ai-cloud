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
  if (!error) return null
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
  const [tasks, setTasks] = useState<VideoTask[]>([])
  const [submitError, setSubmitError] = useState<string | null>(null)

  const submission = useMutation({
    mutationFn: async (input: {
      group: string
      request: VideoGenerationRequest
      quantity: number
    }) => {
      const submitted: VideoTask[] = []
      setSubmitError(null)
      for (let index = 0; index < input.quantity; index += 1) {
        try {
          const task = await submitVideoGeneration(input.group, input.request)
          queryClient.setQueryData(videoTaskKey(task.id), task)
          submitted.push(task)
          setTasks((current) => [...current, task])
        } catch (error) {
          setSubmitError(errorMessage(error))
          throw error
        }
      }
      return submitted
    },
  })

  const submit = (
    group: string,
    request: VideoGenerationRequest,
    quantity = 1
  ) => submission.mutateAsync({ group, request, quantity })

  const reset = () => {
    submission.reset()
    setSubmitError(null)
    setTasks([])
  }

  return {
    tasks,
    isSubmitting: submission.isPending,
    submitError,
    submit,
    reset,
  }
}

export function useVideoTask(initialTask: VideoTask) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const taskQuery = useQuery({
    queryKey: videoTaskKey(initialTask.id),
    queryFn: () => getVideoGeneration(initialTask.id),
    initialData: initialTask,
    retry: false,
    staleTime: VIDEO_POLL_INTERVAL_MS,
    refetchInterval: (query) => {
      const task = query.state.data
      return task && isTerminalVideoStatus(task.status)
        ? false
        : VIDEO_POLL_INTERVAL_MS
    },
  })

  const task = taskQuery.data
  const contentQuery = useQuery({
    queryKey: ['playground', 'video-content', initialTask.id],
    queryFn: () => getVideoContent(initialTask.id),
    enabled: task.status === 'completed',
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

  return {
    task,
    taskError: task.error?.message ?? null,
    videoUrl,
    videoBlob: contentQuery.data ?? null,
    isPolling: !isTerminalVideoStatus(task.status) && taskQuery.isFetching,
    isLoadingVideo: contentQuery.isFetching,
    statusError: errorMessage(taskQuery.error),
    contentError: errorMessage(contentQuery.error),
    retryStatus: taskQuery.refetch,
    retryContent: contentQuery.refetch,
  }
}

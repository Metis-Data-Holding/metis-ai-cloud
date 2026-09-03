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
  Alert02Icon,
  AiVideoIcon,
  Download01Icon,
  RefreshIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

import { useVideoTask } from '../../hooks/use-video-generation'
import type { VideoTask } from '../../types'

type VideoGenerationResultProps = {
  task: VideoTask | null
  taskError: string | null
  statusError: string | null
  contentError: string | null
  videoUrl: string | null
  onRetryStatus: () => void
  onRetryContent: () => void
}

function taskStatusLabel(
  status: VideoTask['status'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  switch (status) {
    case 'queued':
      return t('Queued')
    case 'in_progress':
      return t('Generating')
    case 'completed':
      return t('Completed')
    case 'failed':
      return t('Failed')
    case 'unknown':
      return t('Unknown')
  }
}

export function VideoGenerationResult(props: VideoGenerationResultProps) {
  const { t } = useTranslation()

  if (!props.task) {
    return (
      <Empty className='min-h-[28rem] border'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <HugeiconsIcon icon={AiVideoIcon} strokeWidth={1.8} />
          </EmptyMedia>
          <EmptyTitle>{t('Your generated video will appear here')}</EmptyTitle>
          <EmptyDescription>
            {t('Submit a prompt to start an asynchronous video task.')}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (props.task.status === 'failed') {
    return (
      <Alert variant='destructive'>
        <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} aria-hidden='true' />
        <AlertTitle>{t('Video generation failed')}</AlertTitle>
        <AlertDescription>
          {props.taskError ||
            t('The provider did not return an error message.')}
        </AlertDescription>
      </Alert>
    )
  }

  const isPending =
    props.task.status === 'queued' || props.task.status === 'in_progress'
  if (isPending) {
    const title =
      props.task.status === 'queued'
        ? t('Task submitted')
        : t('Generating video')
    return (
      <Card className='min-h-[28rem] justify-center'>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription className='font-mono text-xs'>
            {props.task.id}
          </CardDescription>
          <CardAction>
            <Badge variant='secondary'>
              {taskStatusLabel(props.task.status, t)}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className='flex flex-col gap-4'>
          <div className='bg-muted/40 flex aspect-video items-center justify-center rounded-lg'>
            <Spinner className='size-8' />
          </div>
          <Progress value={props.task.progress}>
            <ProgressLabel>{t('Task progress')}</ProgressLabel>
            <ProgressValue />
          </Progress>
          {props.statusError ? (
            <Alert variant='destructive'>
              <HugeiconsIcon
                icon={Alert02Icon}
                strokeWidth={2}
                aria-hidden='true'
              />
              <AlertTitle>{t('Failed to refresh task status')}</AlertTitle>
              <AlertDescription className='flex flex-col items-start gap-2'>
                <span>{props.statusError}</span>
                <Button
                  type='button'
                  size='xs'
                  variant='outline'
                  onClick={props.onRetryStatus}
                >
                  <HugeiconsIcon
                    icon={RefreshIcon}
                    strokeWidth={2}
                    data-icon='inline-start'
                  />
                  {t('Retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    )
  }

  let preview = (
    <div aria-label={t('Loading video preview')}>
      <Skeleton className='aspect-video w-full rounded-lg' />
    </div>
  )
  if (props.contentError) {
    preview = (
      <Alert variant='destructive'>
        <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} aria-hidden='true' />
        <AlertTitle>{t('Video preview failed')}</AlertTitle>
        <AlertDescription className='flex flex-col items-start gap-2'>
          <span>{props.contentError}</span>
          <Button
            type='button'
            size='xs'
            variant='outline'
            onClick={props.onRetryContent}
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              strokeWidth={2}
              data-icon='inline-start'
            />
            {t('Retry')}
          </Button>
        </AlertDescription>
      </Alert>
    )
  } else if (props.videoUrl) {
    preview = (
      <video
        src={props.videoUrl}
        controls
        preload='metadata'
        aria-label={t('Generated video preview')}
        className='aspect-video w-full rounded-lg bg-black object-contain'
      />
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Video ready')}</CardTitle>
        <CardDescription className='font-mono text-xs'>
          {props.task.id}
        </CardDescription>
        <CardAction>
          <Badge>{t('Completed')}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>{preview}</CardContent>
      {props.videoUrl ? (
        <CardFooter>
          <Button
            variant='outline'
            nativeButton={false}
            render={
              <a href={props.videoUrl} download={`${props.task.id}.mp4`} />
            }
          >
            <HugeiconsIcon
              icon={Download01Icon}
              strokeWidth={2}
              data-icon='inline-start'
            />
            {t('Download video')}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}

export function VideoTaskResult({ initialTask }: { initialTask: VideoTask }) {
  const generation = useVideoTask(initialTask)

  return (
    <VideoGenerationResult
      task={generation.task}
      taskError={generation.taskError}
      statusError={generation.statusError}
      contentError={generation.contentError}
      videoUrl={generation.videoUrl}
      onRetryStatus={() => void generation.retryStatus()}
      onRetryContent={() => void generation.retryContent()}
    />
  )
}

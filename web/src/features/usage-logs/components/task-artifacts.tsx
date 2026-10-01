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
  Download01Icon,
  File01Icon,
  Image01Icon,
  MusicNote01Icon,
  RefreshIcon,
  Video01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
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
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  getServerErrorMessage,
  requireServerSuccess,
} from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { getTaskArtifacts, getTaskOriginal } from '../api'
import { TASK_STATUS } from '../constants'
import {
  resolveTaskPreviewMode,
  shouldLoadTaskArtifacts,
} from '../lib/task-artifacts'
import type {
  SuperResolutionTaskInfo,
  TaskArtifact,
  TaskArtifactType,
  TaskLog,
} from '../types'
import { AudioPreviewDialog } from './dialogs/audio-preview-dialog'

function artifactIcon(type: TaskArtifactType) {
  switch (type) {
    case 'image':
      return Image01Icon
    case 'video':
      return Video01Icon
    case 'audio':
      return MusicNote01Icon
    case 'file':
      return File01Icon
  }
}

function artifactTypeLabel(type: TaskArtifactType): string {
  switch (type) {
    case 'image':
      return 'Image'
    case 'video':
      return 'Video'
    case 'audio':
      return 'Audio'
    case 'file':
      return 'File'
  }
}

// Task lists no longer carry the persisted snapshot, so the legacy Suno clip
// list is fetched through the artifacts endpoint when the preview opens.
function LegacyAudioPreview(props: { taskId: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const artifactsQuery = useQuery({
    queryKey: ['usage-logs', 'task-artifacts', props.taskId],
    queryFn: async () =>
      requireServerSuccess(await getTaskArtifacts(props.taskId)),
    enabled: open,
    retry: false,
    staleTime: 30_000,
  })

  return (
    <>
      <button
        type='button'
        className='group flex items-center gap-1 text-left text-xs'
        onClick={() => setOpen(true)}
      >
        <HugeiconsIcon
          icon={MusicNote01Icon}
          className='text-muted-foreground size-3'
          strokeWidth={2}
          aria-hidden='true'
        />
        <span className='text-foreground leading-snug group-hover:underline'>
          {t('Click to preview audio')}
        </span>
      </button>
      <AudioPreviewDialog
        open={open}
        onOpenChange={setOpen}
        clips={artifactsQuery.data?.legacyAudioClips ?? []}
        loading={open && artifactsQuery.isPending}
      />
    </>
  )
}

function ArtifactMedia(props: {
  artifact: TaskArtifact
  mediaUrl: string
  onError: () => void
}) {
  if (props.artifact.type === 'image') {
    return (
      <img
        src={props.mediaUrl}
        alt={props.artifact.key}
        loading='lazy'
        className='max-h-[60vh] w-full rounded-md object-contain'
        onError={props.onError}
      />
    )
  }
  if (props.artifact.type === 'video') {
    return (
      <video
        src={props.mediaUrl}
        controls
        preload='metadata'
        className='max-h-[60vh] w-full rounded-md bg-black'
        onError={props.onError}
      />
    )
  }
  if (props.artifact.type === 'audio') {
    return (
      <audio
        src={props.mediaUrl}
        controls
        preload='none'
        className='w-full'
        onError={props.onError}
      />
    )
  }
  return null
}

function MediaFailure(props: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <Alert variant='destructive'>
      <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} aria-hidden='true' />
      <AlertTitle>{t('Media preview failed. Please try again.')}</AlertTitle>
      <AlertDescription>{t('Preview unavailable')}</AlertDescription>
      <AlertAction>
        <Button
          type='button'
          variant='outline'
          size='xs'
          onClick={props.onRetry}
        >
          <HugeiconsIcon
            icon={RefreshIcon}
            strokeWidth={2}
            data-icon='inline-start'
          />
          {t('Retry')}
        </Button>
      </AlertAction>
    </Alert>
  )
}

function TaskArtifactCard(props: { artifact: TaskArtifact }) {
  const { t } = useTranslation()
  const [mediaFailed, setMediaFailed] = useState(false)
  const [mediaRevision, setMediaRevision] = useState(0)
  const icon = artifactIcon(props.artifact.type)
  const isVisualArtifact =
    props.artifact.type === 'image' || props.artifact.type === 'video'

  let cardContent = (
    <div
      className={cn(
        'bg-muted/40 text-muted-foreground flex items-center justify-center rounded-md',
        isVisualArtifact ? 'aspect-video min-h-48' : 'min-h-20'
      )}
    >
      <HugeiconsIcon icon={icon} className='size-6' strokeWidth={1.5} />
    </div>
  )
  if (mediaFailed) {
    cardContent = (
      <MediaFailure
        onRetry={() => {
          setMediaFailed(false)
          setMediaRevision((revision) => revision + 1)
        }}
      />
    )
  } else if (props.artifact.type !== 'file') {
    cardContent = (
      <ArtifactMedia
        key={mediaRevision}
        artifact={props.artifact}
        mediaUrl={props.artifact.content_url}
        onError={() => setMediaFailed(true)}
      />
    )
  }

  return (
    <Card size='sm'>
      <CardHeader>
        <CardTitle className='flex min-w-0 items-center gap-1.5'>
          <HugeiconsIcon
            icon={icon}
            className='size-4 shrink-0'
            strokeWidth={2}
            aria-hidden='true'
          />
          <span className='truncate'>
            {t(artifactTypeLabel(props.artifact.type))}
          </span>
        </CardTitle>
        <CardDescription className='min-w-0'>
          <span className='block truncate font-mono text-xs'>
            {props.artifact.key}
          </span>
          {props.artifact.mime_type ? (
            <span className='block truncate font-mono text-[11px]'>
              {props.artifact.mime_type}
            </span>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent>{cardContent}</CardContent>
      <CardFooter>
        <Button
          variant='outline'
          size='sm'
          nativeButton={false}
          render={
            <a
              href={props.artifact.content_url}
              download={props.artifact.key}
              target='_blank'
              rel='noopener noreferrer'
            />
          }
        >
          <HugeiconsIcon
            icon={Download01Icon}
            strokeWidth={2}
            data-icon='inline-start'
          />
          {t('Download')}
        </Button>
      </CardFooter>
    </Card>
  )
}

function ArtifactDownloadButton(props: {
  contentUrl?: string
  fileName: string
}) {
  const { t } = useTranslation()

  return (
    <Button
      variant='outline'
      size='sm'
      disabled={!props.contentUrl}
      nativeButton={false}
      render={
        <a
          href={props.contentUrl}
          download={props.fileName}
          target='_blank'
          rel='noopener noreferrer'
        />
      }
    >
      <HugeiconsIcon
        icon={Download01Icon}
        strokeWidth={2}
        data-icon='inline-start'
      />
      {t('Download video')}
    </Button>
  )
}

function SuperResolutionArtifacts(props: {
  taskId: string
  open: boolean
  finalAvailable: boolean
  superResolution: SuperResolutionTaskInfo
  artifacts: TaskArtifact[]
  artifactsPending: boolean
  artifactsError: boolean
  retryArtifacts: () => void
}) {
  const { t } = useTranslation()
  const hasOriginal = props.superResolution.original_available === true
  const finalVideo = props.artifacts.find(
    (artifact) => artifact.type === 'video'
  )
  const defaultTab = props.finalAvailable ? 'super-resolution' : 'original'
  const [activeTab, setActiveTab] = useState(defaultTab)
  const [originalUrl, setOriginalUrl] = useState<string>()
  const [originalPending, setOriginalPending] = useState(false)
  const [originalError, setOriginalError] = useState<string>()
  const [originalRevision, setOriginalRevision] = useState(0)
  const [finalMediaFailed, setFinalMediaFailed] = useState(false)
  const [finalMediaRevision, setFinalMediaRevision] = useState(0)

  useEffect(() => {
    setActiveTab(defaultTab)
  }, [defaultTab, props.taskId])

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | undefined

    setOriginalUrl(undefined)
    setOriginalError(undefined)
    setOriginalPending(false)
    if (!props.open || activeTab !== 'original' || !hasOriginal) {
      return undefined
    }

    setOriginalPending(true)
    void getTaskOriginal(props.taskId)
      .then((blob) => {
        const url = URL.createObjectURL(blob)
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        objectUrl = url
        setOriginalUrl(url)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setOriginalError(
          getServerErrorMessage(error, t('Failed to load original video'))
        )
      })
      .finally(() => {
        if (!cancelled) setOriginalPending(false)
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [activeTab, hasOriginal, originalRevision, props.open, props.taskId, t])

  const originalArtifact: TaskArtifact = {
    key: `original-${props.taskId}`,
    type: 'video',
    mime_type: 'video/mp4',
    content_url: originalUrl || '',
  }

  let originalContent: React.ReactNode
  if (!hasOriginal) {
    originalContent = (
      <EmptyTaskArtifacts description={t('Original video is unavailable')} />
    )
  } else if (originalPending) {
    originalContent = (
      <div aria-label={t('Loading...')}>
        <Skeleton className='aspect-video min-h-48 w-full rounded-xl' />
      </div>
    )
  } else if (originalError) {
    originalContent = (
      <Alert variant='destructive'>
        <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} aria-hidden='true' />
        <AlertTitle>{t('Failed to load original video')}</AlertTitle>
        <AlertDescription>{originalError}</AlertDescription>
        <AlertAction>
          <Button
            type='button'
            variant='outline'
            size='xs'
            onClick={() => {
              setOriginalError(undefined)
              setOriginalUrl(undefined)
              setOriginalRevision((revision) => revision + 1)
            }}
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              strokeWidth={2}
              data-icon='inline-start'
            />
            {t('Retry')}
          </Button>
        </AlertAction>
      </Alert>
    )
  } else if (originalUrl) {
    originalContent = (
      <ArtifactMedia
        artifact={originalArtifact}
        mediaUrl={originalUrl}
        onError={() =>
          setOriginalError(t('Media preview failed. Please try again.'))
        }
      />
    )
  } else {
    originalContent = <EmptyTaskArtifacts />
  }

  let finalContent: React.ReactNode
  if (props.artifactsPending) {
    finalContent = (
      <div aria-label={t('Loading...')}>
        <Skeleton className='aspect-video min-h-48 w-full rounded-xl' />
      </div>
    )
  } else if (props.artifactsError) {
    finalContent = (
      <Alert variant='destructive'>
        <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} aria-hidden='true' />
        <AlertTitle>{t('Failed to load artifacts')}</AlertTitle>
        <AlertDescription>{t('Preview unavailable')}</AlertDescription>
        <AlertAction>
          <Button
            type='button'
            variant='outline'
            size='xs'
            onClick={props.retryArtifacts}
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              strokeWidth={2}
              data-icon='inline-start'
            />
            {t('Retry')}
          </Button>
        </AlertAction>
      </Alert>
    )
  } else if (finalVideo) {
    finalContent = finalMediaFailed ? (
      <MediaFailure
        onRetry={() => {
          setFinalMediaFailed(false)
          setFinalMediaRevision((revision) => revision + 1)
        }}
      />
    ) : (
      <ArtifactMedia
        key={finalMediaRevision}
        artifact={finalVideo}
        mediaUrl={finalVideo.content_url}
        onError={() => setFinalMediaFailed(true)}
      />
    )
  } else {
    finalContent = <EmptyTaskArtifacts />
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className='w-full'>
      <TabsList aria-label={t('Video versions')}>
        <TabsTrigger value='original' disabled={!hasOriginal}>
          {t('Original video')}
        </TabsTrigger>
        <TabsTrigger value='super-resolution' disabled={!props.finalAvailable}>
          {t('Super-resolution video')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value='original' className='space-y-3 pt-2'>
        {originalContent}
      </TabsContent>
      <TabsContent value='super-resolution' className='space-y-3 pt-2'>
        {finalContent}
      </TabsContent>
      <ArtifactDownloadButton
        contentUrl={
          activeTab === 'original' ? originalUrl : finalVideo?.content_url
        }
        fileName={
          activeTab === 'original'
            ? `original-${props.taskId.replaceAll(/[^A-Za-z0-9._-]/g, '_')}.mp4`
            : `${finalVideo?.key || 'video'}.mp4`
        }
      />
    </Tabs>
  )
}

interface TaskArtifactsProps {
  taskId: string
  open: boolean
  enabled: boolean
  isAdmin: boolean
  finalAvailable?: boolean
  superResolution?: SuperResolutionTaskInfo
  emptyContent?: (legacyContentUrl?: string) => React.ReactNode
}

function TaskArtifacts(props: TaskArtifactsProps) {
  const { t } = useTranslation()
  const artifactsQuery = useQuery({
    queryKey: ['usage-logs', 'task-artifacts', props.taskId],
    queryFn: async () =>
      requireServerSuccess(await getTaskArtifacts(props.taskId)),
    enabled: props.enabled,
    retry: false,
    staleTime: 30_000,
  })

  if (props.superResolution && props.isAdmin) {
    return (
      <SuperResolutionArtifacts
        key={props.taskId}
        taskId={props.taskId}
        open={props.open}
        finalAvailable={props.finalAvailable === true}
        superResolution={props.superResolution}
        artifacts={artifactsQuery.data?.artifacts ?? []}
        artifactsPending={artifactsQuery.isPending && props.enabled}
        artifactsError={artifactsQuery.isError}
        retryArtifacts={() => void artifactsQuery.refetch()}
      />
    )
  }

  if (!props.enabled) return null

  if (artifactsQuery.isPending) {
    return (
      <div aria-label={t('Loading...')}>
        <Skeleton className='aspect-video min-h-48 w-full rounded-xl' />
      </div>
    )
  }

  if (artifactsQuery.isError) {
    return (
      <Alert variant='destructive'>
        <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} aria-hidden='true' />
        <AlertTitle>{t('Failed to load artifacts')}</AlertTitle>
        <AlertDescription>{t('Preview unavailable')}</AlertDescription>
        <AlertAction>
          <Button
            type='button'
            variant='outline'
            size='xs'
            disabled={artifactsQuery.isFetching}
            onClick={() => void artifactsQuery.refetch()}
          >
            {artifactsQuery.isFetching ? (
              <Spinner data-icon='inline-start' />
            ) : (
              <HugeiconsIcon
                icon={RefreshIcon}
                strokeWidth={2}
                data-icon='inline-start'
              />
            )}
            {t('Retry')}
          </Button>
        </AlertAction>
      </Alert>
    )
  }

  if (artifactsQuery.data.artifacts.length === 0) {
    return (
      props.emptyContent?.(artifactsQuery.data.legacyContentUrl) ?? (
        <EmptyTaskArtifacts />
      )
    )
  }

  return (
    <div
      className={cn(
        'grid gap-3',
        artifactsQuery.data.artifacts.length > 1 && 'lg:grid-cols-2'
      )}
    >
      {artifactsQuery.data.artifacts.map((artifact) => (
        <TaskArtifactCard key={artifact.key} artifact={artifact} />
      ))}
    </div>
  )
}

function EmptyTaskArtifacts(props: { description?: string } = {}) {
  const { t } = useTranslation()
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <HugeiconsIcon icon={File01Icon} strokeWidth={2} aria-hidden='true' />
        </EmptyMedia>
        <EmptyTitle>{t('Artifacts')}</EmptyTitle>
        <EmptyDescription>{props.description ?? t('None')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function LegacyTaskArtifacts(props: { legacyContentUrl?: string }) {
  if (props.legacyContentUrl) {
    return <LegacyVideoMedia contentUrl={props.legacyContentUrl} />
  }
  return <EmptyTaskArtifacts />
}

export function TaskArtifactsCell(props: { log: TaskLog; isAdmin: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const previewMode = resolveTaskPreviewMode(props.log)
  const superResolution = props.isAdmin
    ? props.log.admin_info?.super_resolution
    : undefined
  const isSuperResolutionTask = superResolution !== undefined
  const canOpenRetainedOriginal =
    isSuperResolutionTask && superResolution.original_available === true

  if (previewMode === 'discarded' && !canOpenRetainedOriginal) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className='text-muted-foreground cursor-help text-xs' />
            }
          >
            {t('Result not retained')}
          </TooltipTrigger>
          <TooltipContent>
            {t(
              'The result was returned in the API response and was not saved as an artifact'
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
  if (!shouldLoadTaskArtifacts(props.log, true) && !canOpenRetainedOriginal) {
    return <span className='text-muted-foreground/60 text-xs'>-</span>
  }
  if (previewMode === 'legacy-suno' && !isSuperResolutionTask) {
    return <LegacyAudioPreview taskId={props.log.task_id} />
  }

  return (
    <>
      {previewMode === 'legacy-video' && !isSuperResolutionTask ? (
        <button
          type='button'
          className='text-foreground text-xs hover:underline'
          onClick={() => setOpen(true)}
        >
          {t('Click to preview video')}
        </button>
      ) : (
        <Button
          type='button'
          variant='outline'
          size='xs'
          onClick={() => setOpen(true)}
        >
          <HugeiconsIcon
            icon={File01Icon}
            strokeWidth={2}
            data-icon='inline-start'
          />
          {t('Artifacts')}
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={
          previewMode === 'legacy-video' ? (
            t('Preview')
          ) : (
            <span className='flex items-center gap-2'>
              <HugeiconsIcon
                icon={File01Icon}
                className='text-muted-foreground size-4'
                strokeWidth={2}
                aria-hidden='true'
              />
              {t('Artifacts')}
            </span>
          )
        }
        contentClassName={
          previewMode === 'legacy-video' ? 'sm:max-w-xl' : 'sm:max-w-4xl'
        }
        contentHeight='auto'
        bodyClassName='pr-2 sm:pr-4'
      >
        <TaskArtifacts
          taskId={props.log.task_id}
          open={open}
          enabled={shouldLoadTaskArtifacts(props.log, open)}
          isAdmin={props.isAdmin}
          finalAvailable={props.log.status === TASK_STATUS.SUCCESS}
          superResolution={superResolution}
          emptyContent={(legacyContentUrl) => (
            <LegacyTaskArtifacts legacyContentUrl={legacyContentUrl} />
          )}
        />
      </Dialog>
    </>
  )
}

interface LegacyVideoMediaProps {
  contentUrl: string
}

function LegacyVideoMedia(props: LegacyVideoMediaProps) {
  const [mediaFailed, setMediaFailed] = useState(false)
  const [mediaRevision, setMediaRevision] = useState(0)

  return mediaFailed ? (
    <MediaFailure
      onRetry={() => {
        setMediaFailed(false)
        setMediaRevision((revision) => revision + 1)
      }}
    />
  ) : (
    <video
      key={mediaRevision}
      src={props.contentUrl}
      controls
      preload='metadata'
      className='max-h-[60vh] w-full rounded-md bg-black'
      onError={() => setMediaFailed(true)}
    />
  )
}

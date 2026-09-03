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
import { ArrowLeftRightIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { ImagePlusIcon, PlusIcon, Trash2Icon, VideoIcon } from 'lucide-react'
import {
  type ChangeEvent,
  type CSSProperties,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { uploadVideoReference } from '../../api'
import {
  getVideoReferenceAssets,
  type VideoReferenceAsset,
} from '../../lib/video/video-reference-assets'
import {
  readReferenceVideoDuration,
  validateReferenceVideoDuration,
  validateReferenceVideoFile,
} from '../../lib/video/video-reference-upload'
import type {
  VideoGenerationMode,
  VideoImageRole,
  VideoInputContent,
} from '../../types'

const MAX_IMAGE_BYTES = 30 * 1024 * 1024
const MAX_COMBINED_IMAGE_BYTES = 45 * 1024 * 1024
const MAX_REFERENCE_IMAGES = 9
const MAX_REFERENCE_VIDEOS = 3
const REFERENCE_CARD_ROTATIONS = [-5, 4, -3, 5] as const
const IMAGE_ACCEPT =
  'image/jpeg,image/png,image/webp,image/bmp,image/tiff,image/gif,image/heic,image/heif,.heic,.heif'
const VIDEO_ACCEPT = 'video/mp4,video/quicktime,.mp4,.mov'
const REFERENCE_CONTENT_ACCEPT = `${IMAGE_ACCEPT},${VIDEO_ACCEPT}`
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/gif',
  'image/heic',
  'image/heif',
])

interface VideoReferenceInputProps {
  mode: VideoGenerationMode
  content: VideoInputContent[]
  onContentChange: (content: VideoInputContent[]) => void
  onExpandedChange?: (expanded: boolean) => void
  onValidityChange: (valid: boolean) => void
  disabled?: boolean
  variant?: 'default' | 'composer'
}

interface UploadedReferenceVideo {
  id: string
  url: string
  name: string
  size: number
  duration: number
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener(
      'load',
      () => resolve(String(reader.result ?? '')),
      { once: true }
    )
    reader.addEventListener('error', () => reject(reader.error), {
      once: true,
    })
    reader.readAsDataURL(file)
  })
}

function contentUrl(item: VideoInputContent): string {
  return item.type === 'image_url' ? item.image_url.url : item.video_url.url
}

function dataUrlByteLength(url: string): number {
  const encoded = url.split(',')[1]
  return encoded ? Math.floor((encoded.length * 3) / 4) : 0
}

function isSupportedImage(file: File): boolean {
  if (file.type !== '') {
    return SUPPORTED_IMAGE_MIME_TYPES.has(file.type.toLowerCase())
  }
  return /\.(jpe?g|png|webp|bmp|tiff?|gif|heic|heif)$/i.test(file.name)
}

function imageContent(url: string, role: VideoImageRole): VideoInputContent {
  return { type: 'image_url', image_url: { url }, role }
}

function sortFrameContent(content: VideoInputContent[]): VideoInputContent[] {
  const roleOrder: Partial<Record<VideoInputContent['role'], number>> = {
    first_frame: 0,
    last_frame: 1,
  }
  return [...content].sort(
    (first, second) =>
      (roleOrder[first.role] ?? 2) - (roleOrder[second.role] ?? 2)
  )
}

export function VideoReferenceInput(props: VideoReferenceInputProps) {
  const { t } = useTranslation()
  const { onExpandedChange } = props
  const [imageError, setImageError] = useState('')
  const [videoError, setVideoError] = useState('')
  const [uploadedVideos, setUploadedVideos] = useState<
    UploadedReferenceVideo[]
  >([])
  const [isUploadingVideo, setIsUploadingVideo] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [suppressReferenceExpansion, setSuppressReferenceExpansion] =
    useState(false)
  const [referenceExpanded, setReferenceExpanded] = useState(false)
  const uploadGeneration = useRef(0)
  const interactionDisabled = props.disabled || isUploadingVideo

  useEffect(() => {
    setImageError('')
    setVideoError('')
    setUploadedVideos([])
    setIsUploadingVideo(false)
    setUploadProgress(0)
    setSuppressReferenceExpansion(false)
    setReferenceExpanded(false)
    onExpandedChange?.(false)
    uploadGeneration.current += 1
  }, [props.mode, onExpandedChange])

  const replaceRole = (role: VideoImageRole, next?: VideoInputContent) => {
    const content = props.content.filter((item) => item.role !== role)
    if (next) {
      content.push(next)
    }
    props.onContentChange(sortFrameContent(content))
  }

  const handleReferenceContent = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const files = [...(event.currentTarget.files ?? [])]
    event.currentTarget.value = ''
    if (files.length === 0) {
      return
    }
    event.currentTarget.blur()
    setSuppressReferenceExpansion(true)
    setReferenceExpanded(false)
    onExpandedChange?.(false)
    const currentGeneration = uploadGeneration.current
    const imageFiles = files.filter(
      (file) =>
        isSupportedImage(file) ||
        (!file.type.startsWith('video/') && !/\.(mp4|mov)$/i.test(file.name))
    )
    const imageFileSet = new Set(imageFiles)
    const videoFiles = files.filter((file) => !imageFileSet.has(file))
    const currentImages = props.content.filter(
      (item) => item.role === 'reference_image'
    )
    if (currentImages.length + imageFiles.length > MAX_REFERENCE_IMAGES) {
      setImageError(t('You can add up to 9 reference images.'))
      return
    }
    if (imageFiles.some((file) => !isSupportedImage(file))) {
      setImageError(t('Choose a supported image file.'))
      return
    }
    if (imageFiles.some((file) => file.size >= MAX_IMAGE_BYTES)) {
      setImageError(t('Each image must be smaller than 30 MB.'))
      return
    }
    const currentBytes = currentImages.reduce(
      (total, item) => total + dataUrlByteLength(contentUrl(item)),
      0
    )
    if (
      currentBytes + imageFiles.reduce((total, file) => total + file.size, 0) >
      MAX_COMBINED_IMAGE_BYTES
    ) {
      setImageError(t('The combined image size is too large.'))
      return
    }
    if (uploadedVideos.length + videoFiles.length > MAX_REFERENCE_VIDEOS) {
      setVideoError(t('You can add up to 3 reference videos.'))
      return
    }
    const fileErrors = new Set(videoFiles.map(validateReferenceVideoFile))
    if (fileErrors.has('format')) {
      setVideoError(t('Choose an MP4 or MOV video.'))
      return
    }
    if (fileErrors.has('size')) {
      setVideoError(t('Each reference video must not exceed 80 MB.'))
      return
    }
    const finishVideoSelection = () => {
      if (currentGeneration === uploadGeneration.current) {
        setIsUploadingVideo(false)
        setUploadProgress(0)
        props.onValidityChange(true)
      }
    }
    if (videoFiles.length > 0) {
      setIsUploadingVideo(true)
      setUploadProgress(0)
      setVideoError('')
      props.onValidityChange(false)
    }

    let durations: number[]
    try {
      durations = await Promise.all(videoFiles.map(readReferenceVideoDuration))
    } catch {
      setVideoError(t('Unable to upload the reference video.'))
      finishVideoSelection()
      return
    }
    let totalDuration = uploadedVideos.reduce(
      (total, upload) => total + upload.duration,
      0
    )
    for (const duration of durations) {
      const durationError = validateReferenceVideoDuration(
        duration,
        totalDuration
      )
      if (durationError === 'duration') {
        setVideoError(
          t('Each reference video must be between 2 and 15 seconds.')
        )
        finishVideoSelection()
        return
      }
      if (durationError === 'total-duration') {
        setVideoError(t('Reference videos must total no more than 15 seconds.'))
        finishVideoSelection()
        return
      }
      totalDuration += duration
    }
    if (currentGeneration !== uploadGeneration.current) {
      return
    }

    const additions: VideoInputContent[] = []
    const newUploads: UploadedReferenceVideo[] = []
    const existingUrls = new Set(props.content.map(contentUrl))
    let processingKind: 'image' | 'video' = 'image'
    const commitAdditions = () => {
      if (additions.length > 0) {
        props.onContentChange([...props.content, ...additions])
      }
      if (newUploads.length > 0) {
        setUploadedVideos((current) => [...current, ...newUploads])
      }
    }
    try {
      for (const file of files) {
        if (imageFileSet.has(file)) {
          processingKind = 'image'
          const url = await readFileAsDataUrl(file)
          if (!existingUrls.has(url)) {
            additions.push(imageContent(url, 'reference_image'))
            existingUrls.add(url)
          }
          continue
        }

        const videoIndex = videoFiles.indexOf(file)
        processingKind = 'video'
        const uploaded = await uploadVideoReference(file, (progress) => {
          setUploadProgress(
            Math.round(
              ((videoIndex + progress / 100) / videoFiles.length) * 100
            )
          )
        })
        additions.push({
          type: 'video_url',
          video_url: { url: uploaded.url },
          role: 'reference_video',
        })
        newUploads.push({
          id: uploaded.id,
          url: uploaded.url,
          name: uploaded.name,
          size: uploaded.size,
          duration: durations[videoIndex],
        })
      }
      if (currentGeneration !== uploadGeneration.current) {
        return
      }
      commitAdditions()
      setImageError('')
      setVideoError('')
    } catch {
      if (currentGeneration === uploadGeneration.current) {
        commitAdditions()
        if (processingKind === 'image') {
          setImageError(t('Unable to read the selected image.'))
        } else {
          setVideoError(t('Unable to upload the reference video.'))
        }
      }
    } finally {
      finishVideoSelection()
    }
  }

  const handleFrame = async (
    event: ChangeEvent<HTMLInputElement>,
    role: 'first_frame' | 'last_frame'
  ) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) {
      return
    }
    if (!isSupportedImage(file)) {
      setImageError(t('Choose a supported image file.'))
      return
    }
    if (file.size >= MAX_IMAGE_BYTES) {
      setImageError(t('Each image must be smaller than 30 MB.'))
      return
    }
    const otherFrameBytes = props.content
      .filter((item) => item.role !== role && item.type === 'image_url')
      .reduce((total, item) => total + dataUrlByteLength(contentUrl(item)), 0)
    if (otherFrameBytes + file.size > MAX_COMBINED_IMAGE_BYTES) {
      setImageError(t('The combined image size is too large.'))
      return
    }
    try {
      replaceRole(role, imageContent(await readFileAsDataUrl(file), role))
      setImageError('')
    } catch {
      setImageError(t('Unable to read the selected image.'))
    }
  }

  const swapFrames = () => {
    const firstFrame = props.content.find(
      (content) => content.role === 'first_frame'
    )
    const lastFrame = props.content.find(
      (content) => content.role === 'last_frame'
    )
    if (!firstFrame || !lastFrame) {
      return
    }
    props.onContentChange(
      sortFrameContent(
        props.content.map((item) => {
          if (item.role === 'first_frame') {
            return { ...item, role: 'last_frame' }
          }
          if (item.role === 'last_frame') {
            return { ...item, role: 'first_frame' }
          }
          return item
        })
      )
    )
  }

  const removeAt = (index: number) => {
    const item = props.content[index]
    if (item?.type === 'video_url') {
      setUploadedVideos((current) =>
        current.filter((upload) => upload.url !== item.video_url.url)
      )
    }
    props.onContentChange(
      props.content.filter((_, itemIndex) => itemIndex !== index)
    )
  }

  const referenceAssets = getVideoReferenceAssets(props.content)
  const referenceLabel = (asset: VideoReferenceAsset) =>
    t(asset.kind === 'image' ? 'Image {{number}}' : 'Video {{number}}', {
      number: asset.number,
    })

  const referenceCard = (asset: VideoReferenceAsset, index: number) => {
    const label = referenceLabel(asset)
    const url = contentUrl(asset.item)
    return (
      <div
        key={url}
        data-slot='video-reference-asset'
        data-kind={asset.kind}
        className={cn(
          'border-border bg-muted/20 relative size-28 origin-bottom shrink-0 overflow-hidden rounded-xl border shadow-sm transition-[margin,transform] duration-200',
          'ml-2',
          index === 0 && 'sm:ml-0',
          index > 0 && referenceExpanded && 'sm:ml-2',
          index > 0 && !referenceExpanded && 'sm:-ml-[6.5rem]',
          referenceExpanded
            ? 'sm:rotate-0'
            : 'sm:rotate-[var(--collapsed-reference-rotation)]'
        )}
        style={
          {
            zIndex: index + 1,
            '--collapsed-reference-rotation': `${REFERENCE_CARD_ROTATIONS[index % REFERENCE_CARD_ROTATIONS.length]}deg`,
          } as CSSProperties
        }
      >
        {asset.kind === 'image' ? (
          <img
            src={url}
            alt={t('Reference image {{number}}', { number: asset.number })}
            className='size-full object-cover'
          />
        ) : (
          <>
            <video
              src={url}
              aria-label={t('Reference video {{number}}', {
                number: asset.number,
              })}
              className='size-full object-cover'
              muted
              playsInline
              preload='metadata'
            />
            <span className='bg-background/85 absolute top-1 right-1 flex size-6 items-center justify-center rounded-full'>
              <VideoIcon aria-hidden='true' className='size-3.5' />
            </span>
          </>
        )}
        <span className='absolute inset-x-0 bottom-0 truncate bg-black/65 px-1.5 py-0.5 text-center text-xs font-medium text-white'>
          {label}
        </span>
        <Button
          type='button'
          size='icon-xs'
          variant='secondary'
          aria-label={t('Remove {{name}}', { name: label })}
          className={cn(
            'absolute top-1 left-1 opacity-0 transition-opacity focus-visible:opacity-100',
            referenceExpanded && 'group-hover/reference:opacity-100'
          )}
          disabled={interactionDisabled}
          onClick={() => removeAt(asset.contentIndex)}
        >
          <Trash2Icon aria-hidden='true' />
        </Button>
      </div>
    )
  }

  const frameSlot = (role: 'first_frame' | 'last_frame', label: string) => {
    const item = props.content.find((content) => content.role === role)
    const inputId = `video-${role}`
    return (
      <div className='relative aspect-square size-24 shrink-0 sm:size-28'>
        <input
          id={inputId}
          type='file'
          accept={IMAGE_ACCEPT}
          className='sr-only'
          disabled={props.disabled}
          onChange={(event) => void handleFrame(event, role)}
        />
        <label
          htmlFor={inputId}
          className={cn(
            'border-border bg-muted/30 hover:bg-muted/60 flex size-full cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed transition-colors',
            props.disabled && 'pointer-events-none opacity-50'
          )}
        >
          {item ? (
            <img
              src={contentUrl(item)}
              alt={label}
              className='size-full object-cover'
            />
          ) : (
            <>
              <ImagePlusIcon aria-hidden='true' className='size-5' />
              <span className='text-sm font-medium'>{label}</span>
            </>
          )}
        </label>
        {item ? (
          <Button
            type='button'
            size='icon-sm'
            variant='secondary'
            aria-label={t('Remove {{name}}', { name: label })}
            className='absolute top-2 right-2'
            disabled={props.disabled}
            onClick={() => replaceRole(role)}
          >
            <Trash2Icon aria-hidden='true' />
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <div
      data-slot='video-reference-input'
      className='flex h-full min-w-0 flex-col items-start gap-3'
    >
      {props.mode === 'reference' ? (
        <div
          data-slot='video-reference-tray'
          data-expanded={referenceExpanded}
          className={cn(
            'group/reference relative flex h-28 min-w-0 max-w-full items-start overflow-x-auto overflow-y-hidden transition-[width] duration-200',
            referenceAssets.length === 0 || !referenceExpanded
              ? 'w-28 sm:overflow-visible'
              : 'w-full sm:overflow-x-auto'
          )}
          onPointerEnter={() => {
            if (referenceAssets.length === 0 || suppressReferenceExpansion) {
              return
            }
            setReferenceExpanded(true)
            onExpandedChange?.(true)
          }}
          onPointerLeave={() => {
            setSuppressReferenceExpansion(false)
            setReferenceExpanded(false)
            onExpandedChange?.(false)
          }}
          onFocusCapture={(event) => {
            if (event.target instanceof HTMLInputElement) {
              return
            }
            setSuppressReferenceExpansion(false)
            if (referenceAssets.length > 0) {
              setReferenceExpanded(true)
              onExpandedChange?.(true)
            }
          }}
          onBlurCapture={(event) => {
            const nextTarget = event.relatedTarget
            if (
              nextTarget instanceof Node &&
              event.currentTarget.contains(nextTarget)
            ) {
              return
            }
            setReferenceExpanded(false)
            onExpandedChange?.(false)
          }}
        >
          <input
            id='video-reference-content'
            type='file'
            accept={REFERENCE_CONTENT_ACCEPT}
            multiple
            aria-label={t('Add reference content')}
            className='sr-only'
            disabled={interactionDisabled}
            onChange={(event) => void handleReferenceContent(event)}
          />
          <label
            htmlFor='video-reference-content'
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'size-28 shrink-0 cursor-pointer border-dashed',
              props.variant === 'composer' &&
                'aspect-square flex-col justify-center gap-1 rounded-xl px-2 text-xs',
              referenceAssets.length > 0 &&
                (referenceExpanded
                  ? 'sm:w-28 sm:border sm:px-2 sm:opacity-100'
                  : 'sm:w-0 sm:border-0 sm:px-0 sm:opacity-0'),
              interactionDisabled && 'pointer-events-none opacity-50'
            )}
            data-slot='video-reference-picker'
          >
            <ImagePlusIcon aria-hidden='true' />
            {isUploadingVideo
              ? t('Uploading video {{progress}}%', {
                  progress: uploadProgress,
                })
              : t(
                  props.variant === 'composer'
                    ? 'Reference content'
                    : 'Add reference content'
                )}
          </label>
          {referenceAssets.map(referenceCard)}
          {referenceAssets.length > 0 ? (
            <label
              htmlFor='video-reference-content'
              style={{
                left: `${6 + Math.min(referenceAssets.length - 1, 4) * 0.5}rem`,
              }}
              className={cn(
                'bg-background hover:bg-muted absolute bottom-0 z-20 hidden size-8 cursor-pointer items-center justify-center rounded-full border shadow-sm transition-opacity sm:flex',
                referenceExpanded && 'pointer-events-none opacity-0',
                interactionDisabled && 'pointer-events-none opacity-50'
              )}
            >
              <PlusIcon aria-hidden='true' className='size-4' />
            </label>
          ) : null}
        </div>
      ) : (
        <div
          data-slot='video-keyframe-inputs'
          className='flex min-h-28 w-full min-w-0 items-center justify-start gap-2 sm:gap-3'
        >
          {frameSlot('first_frame', t('First frame'))}
          <Button
            type='button'
            size='icon-sm'
            variant='outline'
            className='shrink-0 rounded-full'
            aria-label={t('Swap first and last frames')}
            disabled={
              props.disabled ||
              !props.content.some((item) => item.role === 'first_frame') ||
              !props.content.some((item) => item.role === 'last_frame')
            }
            onClick={swapFrames}
          >
            <HugeiconsIcon icon={ArrowLeftRightIcon} aria-hidden='true' />
          </Button>
          {frameSlot('last_frame', t('Last frame'))}
        </div>
      )}
      {imageError ? (
        <p className='text-destructive text-sm' role='alert'>
          {imageError}
        </p>
      ) : null}
      {videoError ? (
        <p className='text-destructive text-sm' role='alert'>
          {videoError}
        </p>
      ) : null}
    </div>
  )
}

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
import { ImagePlusIcon, Trash2Icon, VideoIcon } from 'lucide-react'
import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { uploadVideoReference } from '../../api'
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
  onValidityChange: (valid: boolean) => void
  disabled?: boolean
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
    reader.addEventListener('error', () => reject(reader.error), { once: true })
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

function sortContent(content: VideoInputContent[]): VideoInputContent[] {
  const roleOrder: Record<VideoInputContent['role'], number> = {
    reference_image: 0,
    reference_video: 1,
    first_frame: 0,
    last_frame: 1,
  }
  return [...content].sort(
    (first, second) => roleOrder[first.role] - roleOrder[second.role]
  )
}

export function VideoReferenceInput(props: VideoReferenceInputProps) {
  const { t } = useTranslation()
  const [imageError, setImageError] = useState('')
  const [videoError, setVideoError] = useState('')
  const [uploadedVideos, setUploadedVideos] = useState<
    UploadedReferenceVideo[]
  >([])
  const [isUploadingVideo, setIsUploadingVideo] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const uploadGeneration = useRef(0)
  const interactionDisabled = props.disabled || isUploadingVideo

  useEffect(() => {
    setImageError('')
    setVideoError('')
    setUploadedVideos([])
    setIsUploadingVideo(false)
    setUploadProgress(0)
    uploadGeneration.current += 1
  }, [props.mode])

  const videoContents = (
    uploads: UploadedReferenceVideo[]
  ): VideoInputContent[] =>
    uploads.map((upload) => ({
      type: 'video_url' as const,
      video_url: { url: upload.url },
      role: 'reference_video' as const,
    }))

  const syncVideoContent = (uploads: UploadedReferenceVideo[]) => {
    const withoutVideo = props.content.filter(
      (item) => item.role !== 'reference_video'
    )
    props.onContentChange(
      sortContent([...withoutVideo, ...videoContents(uploads)])
    )
  }

  const replaceRole = (role: VideoImageRole, next?: VideoInputContent) => {
    const content = props.content.filter((item) => item.role !== role)
    if (next) {
      content.push(next)
    }
    props.onContentChange(sortContent(content))
  }

  const handleReferenceContent = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const files = [...(event.currentTarget.files ?? [])]
    event.currentTarget.value = ''
    if (files.length === 0) {
      return
    }
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

    let nextContent = props.content
    try {
      const urls = await Promise.all(imageFiles.map(readFileAsDataUrl))
      const existingUrls = new Set(props.content.map(contentUrl))
      const newImages = urls
        .filter((url) => !existingUrls.has(url))
        .map((url) => imageContent(url, 'reference_image'))
      nextContent = sortContent([...props.content, ...newImages])
      setImageError('')
    } catch {
      setImageError(t('Unable to read the selected image.'))
      finishVideoSelection()
      return
    }

    if (videoFiles.length === 0) {
      props.onContentChange(nextContent)
      setVideoError('')
      return
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

    const newUploads: UploadedReferenceVideo[] = []
    try {
      for (const [index, file] of videoFiles.entries()) {
        const uploaded = await uploadVideoReference(file, (progress) => {
          setUploadProgress(
            Math.round(((index + progress / 100) / videoFiles.length) * 100)
          )
        })
        newUploads.push({
          id: uploaded.id,
          url: uploaded.url,
          name: uploaded.name,
          size: uploaded.size,
          duration: durations[index],
        })
      }
      if (currentGeneration !== uploadGeneration.current) {
        return
      }
      const nextUploaded = [...uploadedVideos, ...newUploads]
      setUploadedVideos(nextUploaded)
      const withoutVideo = nextContent.filter(
        (item) => item.role !== 'reference_video'
      )
      props.onContentChange(
        sortContent([...withoutVideo, ...videoContents(nextUploaded)])
      )
    } catch {
      if (currentGeneration === uploadGeneration.current) {
        if (newUploads.length > 0) {
          const nextUploaded = [...uploadedVideos, ...newUploads]
          setUploadedVideos(nextUploaded)
          const withoutVideo = nextContent.filter(
            (item) => item.role !== 'reference_video'
          )
          props.onContentChange(
            sortContent([...withoutVideo, ...videoContents(nextUploaded)])
          )
        }
        setVideoError(t('Unable to upload the reference video.'))
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

  const removeUploadedVideo = (id: string) => {
    const nextUploaded = uploadedVideos.filter((upload) => upload.id !== id)
    setUploadedVideos(nextUploaded)
    syncVideoContent(nextUploaded)
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
      sortContent(
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
    props.onContentChange(
      props.content.filter((_, itemIndex) => itemIndex !== index)
    )
  }

  const frameSlot = (role: 'first_frame' | 'last_frame', label: string) => {
    const item = props.content.find((content) => content.role === role)
    const inputId = `video-${role}`
    return (
      <div className='relative min-w-0 flex-1'>
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
            'border-border bg-muted/30 hover:bg-muted/60 flex h-28 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed transition-colors',
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
    <div className='flex min-w-0 flex-col gap-3'>
      {props.mode === 'reference' ? (
        <>
          <div className='flex flex-wrap gap-2'>
            {props.content
              .filter((item) => item.role === 'reference_image')
              .map((item, index) => {
                const contentIndex = props.content.indexOf(item)
                return (
                  <div
                    key={contentUrl(item)}
                    className='border-border relative size-20 overflow-hidden rounded-xl border'
                  >
                    <img
                      src={contentUrl(item)}
                      alt={t('Reference image {{number}}', {
                        number: index + 1,
                      })}
                      className='size-full object-cover'
                    />
                    <Button
                      type='button'
                      size='icon-xs'
                      variant='secondary'
                      aria-label={t('Remove reference image {{number}}', {
                        number: index + 1,
                      })}
                      className='absolute top-1 right-1'
                      disabled={interactionDisabled}
                      onClick={() => removeAt(contentIndex)}
                    >
                      <Trash2Icon aria-hidden='true' />
                    </Button>
                  </div>
                )
              })}
            <input
              id='video-reference-content'
              type='file'
              accept={REFERENCE_CONTENT_ACCEPT}
              multiple
              className='sr-only'
              disabled={interactionDisabled}
              onChange={(event) => void handleReferenceContent(event)}
            />
            <label
              htmlFor='video-reference-content'
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'border-dashed',
                interactionDisabled && 'pointer-events-none opacity-50'
              )}
            >
              <ImagePlusIcon aria-hidden='true' />
              {isUploadingVideo
                ? t('Uploading video {{progress}}%', {
                    progress: uploadProgress,
                  })
                : t('Add reference content')}
            </label>
          </div>
          <div className='flex flex-col gap-2'>
            {uploadedVideos.map((video, index) => (
              <div
                key={video.id}
                className='border-border bg-muted/30 flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2'
              >
                <VideoIcon aria-hidden='true' className='size-5 shrink-0' />
                <div className='min-w-0 flex-1'>
                  <p className='truncate text-sm font-medium'>{video.name}</p>
                  <p className='text-muted-foreground text-xs'>
                    {t('{{duration}}s · {{size}} MB', {
                      duration: Number(video.duration.toFixed(1)),
                      size: (video.size / 1024 / 1024).toFixed(1),
                    })}
                  </p>
                </div>
                <Button
                  type='button'
                  size='icon-sm'
                  variant='ghost'
                  aria-label={t('Remove uploaded reference video {{number}}', {
                    number: index + 1,
                  })}
                  disabled={interactionDisabled}
                  onClick={() => removeUploadedVideo(video.id)}
                >
                  <Trash2Icon aria-hidden='true' />
                </Button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className='flex min-w-0 items-center gap-3'>
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
          {frameSlot('last_frame', t('Last frame (optional)'))}
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

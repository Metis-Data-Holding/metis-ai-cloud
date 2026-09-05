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
import { Alert02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { cn } from '@/lib/utils'

import { getUserGroups, getUserModels } from '../../api'
import { DEFAULT_GROUP, VIDEO_ENDPOINT_TYPE } from '../../constants'
import { useVideoGeneration } from '../../hooks/use-video-generation'
import {
  videoFormSchema,
  type VideoFormValues,
} from '../../lib/video/video-form-schema'
import {
  buildVideoGenerationRequest,
  getVideoResolutionOptions,
  isSupportedVideoPlaygroundModel,
  isTextOnlyVideoPlaygroundModel,
  isVideoResolutionDisabled,
  normalizeVideoResolution,
} from '../../lib/video/video-generation'
import type {
  GroupOption,
  ModelOption,
  VideoGenerationMode,
  VideoInputContent,
} from '../../types'
import { VideoComposer } from './video-composer'
import { VideoTaskResult } from './video-generation-result'

const EMPTY_GROUPS: GroupOption[] = []
const EMPTY_MODELS: ModelOption[] = []

const DEFAULT_VALUES: VideoFormValues = {
  group: DEFAULT_GROUP,
  model: '',
  prompt: '',
  seconds: 5,
  resolution: '720p',
  ratio: '16:9',
  generateAudio: false,
  quantity: 1,
  mode: 'reference',
}

export function VideoPlayground() {
  const { t } = useTranslation()
  const [selectedGroup, setSelectedGroup] = useState<string>(DEFAULT_GROUP)
  const [inputContent, setInputContent] = useState<VideoInputContent[]>([])
  const [inputContentValid, setInputContentValid] = useState(true)
  const generation = useVideoGeneration()
  const form = useForm<VideoFormValues>({
    defaultValues: DEFAULT_VALUES,
  })
  const values = form.watch()
  const hasImageInput = inputContent.some((item) => item.type === 'image_url')
  const textOnly = isTextOnlyVideoPlaygroundModel(values.model)

  const groupsQuery = useQuery({
    queryKey: ['playground', 'video-groups'],
    queryFn: getUserGroups,
  })
  const modelsQuery = useQuery({
    queryKey: ['playground', 'video-models', selectedGroup],
    queryFn: () => getUserModels(selectedGroup, VIDEO_ENDPOINT_TYPE),
    enabled: selectedGroup !== '',
  })
  const groups = groupsQuery.data ?? EMPTY_GROUPS
  const models = (modelsQuery.data ?? EMPTY_MODELS).filter((model) =>
    isSupportedVideoPlaygroundModel(model.value)
  )
  const resolutions = values.model
    ? getVideoResolutionOptions(values.model, hasImageInput)
    : []
  const disabledResolutions = resolutions.filter((resolution) =>
    isVideoResolutionDisabled(values.model, resolution, hasImageInput)
  )

  useEffect(() => {
    if (groups.length === 0) return
    if (groups.some((group) => group.value === selectedGroup)) return
    const fallback =
      groups.find((group) => group.value === DEFAULT_GROUP) ?? groups[0]
    setSelectedGroup(fallback.value)
    form.setValue('group', fallback.value, { shouldValidate: true })
  }, [form, groups, selectedGroup])

  useEffect(() => {
    if (modelsQuery.isPending) return
    const nextModel = models.some((model) => model.value === values.model)
      ? values.model
      : (models[0]?.value ?? '')
    if (nextModel !== values.model) {
      form.setValue('model', nextModel, { shouldValidate: true })
    }
  }, [form, models, modelsQuery.isPending, values.model])

  useEffect(() => {
    const nextResolution = normalizeVideoResolution(
      values.model,
      values.resolution,
      hasImageInput
    )
    if (nextResolution !== values.resolution) {
      form.setValue('resolution', nextResolution)
    }
  }, [form, hasImageInput, values.model, values.resolution])

  useEffect(() => {
    if (!textOnly) return
    form.setValue('mode', 'reference')
    setInputContent([])
    setInputContentValid(true)
  }, [form, textOnly])

  const handleGroupChange = (value: string) => {
    setSelectedGroup(value)
    form.setValue('group', value, { shouldValidate: true })
    form.setValue('model', '')
  }

  const handleModeChange = (mode: VideoGenerationMode) => {
    form.setValue('mode', mode)
    setInputContent([])
    setInputContentValid(true)
  }

  const submit = async () => {
    const parsedValues = videoFormSchema.safeParse(form.getValues())
    if (!parsedValues.success) return
    const submittedValues = parsedValues.data
    try {
      await generation.submit(
        submittedValues.group,
        buildVideoGenerationRequest({
          ...submittedValues,
          content: inputContent,
        }),
        submittedValues.quantity
      )
    } catch {
      // Successful tasks remain visible when a later task fails.
    }
  }

  const noVideoModels = !modelsQuery.isPending && models.length === 0
  const composerDisabled = generation.isSubmitting || noVideoModels
  const systemDisabled =
    generation.isSubmitting || modelsQuery.isPending || noVideoModels
  const hasFirstFrame = inputContent.some((item) => item.role === 'first_frame')
  const inputContentMissing =
    (values.mode === 'keyframes' && !hasFirstFrame) ||
    (values.mode === 'reference' &&
      inputContent.length === 0 &&
      values.prompt.trim() === '')
  const submitDisabled =
    systemDisabled ||
    values.model === '' ||
    inputContentMissing ||
    !inputContentValid
  const hasResults = generation.tasks.length > 0
  const optionLoadError = groupsQuery.error || modelsQuery.error

  const composer = (
    <VideoComposer
      audio={values.generateAudio}
      disabled={composerDisabled}
      submitDisabled={submitDisabled}
      groups={groups}
      groupValue={selectedGroup}
      inputContent={inputContent}
      isSubmitting={generation.isSubmitting}
      mode={values.mode}
      models={models}
      modelValue={values.model}
      prompt={values.prompt}
      quantity={values.quantity}
      ratio={values.ratio}
      resolution={values.resolution}
      resolutions={resolutions}
      disabledResolutions={disabledResolutions}
      seconds={values.seconds}
      textOnly={textOnly}
      onAudioChange={(value) => form.setValue('generateAudio', value)}
      onGroupChange={handleGroupChange}
      onInputContentChange={setInputContent}
      onInputValidityChange={setInputContentValid}
      onModeChange={handleModeChange}
      onModelChange={(value) =>
        form.setValue('model', value, { shouldValidate: true })
      }
      onPromptChange={(value) => form.setValue('prompt', value)}
      onQuantityChange={(value) => form.setValue('quantity', value)}
      onRatioChange={(value) => form.setValue('ratio', value)}
      onResolutionChange={(value) => form.setValue('resolution', value)}
      onSecondsChange={(value) => form.setValue('seconds', value)}
      onSubmit={submit}
    />
  )

  return (
    <div
      data-testid='video-playground-layout'
      data-layout={hasResults ? 'results' : 'centered'}
      className='relative flex min-h-0 flex-1 flex-col overflow-hidden'
    >
      {hasResults ? (
        <div className='min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6'>
          <div className='mx-auto grid w-full max-w-5xl gap-5 md:grid-cols-2'>
            {generation.tasks.map((task) => (
              <VideoTaskResult key={task.id} initialTask={task} />
            ))}
          </div>
        </div>
      ) : (
        <div className='flex min-h-0 flex-1 items-center overflow-y-auto px-4 py-8 sm:px-6'>
          <div className='mx-auto flex w-full max-w-5xl flex-col gap-5'>
            <div className='text-center'>
              <h2 className='text-2xl font-semibold tracking-tight'>
                {t('Create a video')}
              </h2>
            </div>
            {composer}
          </div>
        </div>
      )}

      {hasResults ? (
        <div className='bg-background/95 shrink-0 px-4 pt-3 pb-4 backdrop-blur sm:px-6'>
          <div className='mx-auto w-full max-w-5xl'>{composer}</div>
        </div>
      ) : null}

      {noVideoModels ? (
        <Empty className='absolute inset-4 border'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>{t('No video models available')}</EmptyTitle>
            <EmptyDescription>
              {t(
                'Choose another group or ask an administrator to enable a video model.'
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {optionLoadError || generation.submitError ? (
        <Alert
          variant='destructive'
          className={cn(
            'absolute right-4 bottom-4 max-w-md',
            hasResults && 'bottom-36'
          )}
        >
          <HugeiconsIcon
            icon={Alert02Icon}
            strokeWidth={2}
            aria-hidden='true'
          />
          <AlertTitle>{t('Unable to submit video task')}</AlertTitle>
          <AlertDescription>
            {generation.submitError || t('Failed to load video options')}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

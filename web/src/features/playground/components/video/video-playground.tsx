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
import { zodResolver } from '@hookform/resolvers/zod'
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
import { AiMagicIcon, Alert02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { ModelGroupSelector } from '@/components/model-group-selector'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { getUserGroups, getUserModels } from '../../api'
import {
  DEFAULT_GROUP,
  VIDEO_ASPECT_RATIO_OPTIONS,
  VIDEO_DURATION_OPTIONS,
  VIDEO_ENDPOINT_TYPE,
} from '../../constants'
import { useVideoGeneration } from '../../hooks/use-video-generation'
import {
  videoFormSchema,
  type VideoFormValues,
} from '../../lib/video/video-form-schema'
import {
  buildVideoGenerationRequest,
  getVideoResolutionOptions,
  isSupportedVideoPlaygroundModel,
  normalizeVideoResolution,
} from '../../lib/video/video-generation'
import type { GroupOption, ModelOption } from '../../types'
import { VideoGenerationResult } from './video-generation-result'
import { VideoSegmentedControl } from './video-segmented-control'

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
}

export function VideoPlayground() {
  const { t } = useTranslation()
  const [selectedGroup, setSelectedGroup] = useState<string>(DEFAULT_GROUP)
  const generation = useVideoGeneration()
  const form = useForm<VideoFormValues>({
    resolver: zodResolver(videoFormSchema),
    defaultValues: DEFAULT_VALUES,
  })
  const selectedModel = form.watch('model')
  const selectedResolution = form.watch('resolution')
  const selectedSeconds = form.watch('seconds')
  const selectedRatio = form.watch('ratio')
  const generateAudio = form.watch('generateAudio')

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
  const resolutions = selectedModel
    ? getVideoResolutionOptions(selectedModel)
    : []

  useEffect(() => {
    if (groups.length === 0) {
      return
    }
    const hasSelectedGroup = groups.some(
      (group) => group.value === selectedGroup
    )
    if (hasSelectedGroup) {
      return
    }
    const fallback =
      groups.find((group) => group.value === DEFAULT_GROUP) ?? groups[0]
    setSelectedGroup(fallback.value)
    form.setValue('group', fallback.value, { shouldValidate: true })
  }, [form, groups, selectedGroup])

  useEffect(() => {
    if (modelsQuery.isPending) {
      return
    }
    const hasSelectedModel = models.some(
      (model) => model.value === selectedModel
    )
    const nextModel = hasSelectedModel
      ? selectedModel
      : (models[0]?.value ?? '')
    if (nextModel !== selectedModel) {
      form.setValue('model', nextModel, { shouldValidate: true })
    }
  }, [form, models, modelsQuery.isPending, selectedModel])

  useEffect(() => {
    const nextResolution = normalizeVideoResolution(
      selectedModel,
      selectedResolution
    )
    if (nextResolution !== selectedResolution) {
      form.setValue('resolution', nextResolution)
    }
  }, [form, selectedModel, selectedResolution])

  const handleGroupChange = (value: string) => {
    setSelectedGroup(value)
    form.setValue('group', value, { shouldValidate: true })
    form.setValue('model', '')
  }

  const handleSubmit = form.handleSubmit(async (values) => {
    try {
      await generation.submit(values.group, buildVideoGenerationRequest(values))
    } catch {
      // The mutation exposes the provider error in the result panel.
    }
  })

  const optionLoadError = groupsQuery.error || modelsQuery.error
  const noVideoModels = !modelsQuery.isPending && models.length === 0

  return (
    <div className='min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6'>
      <div className='mx-auto grid w-full max-w-6xl gap-5 lg:grid-cols-[minmax(20rem,0.85fr)_minmax(0,1.15fr)]'>
        <Card>
          <CardHeader>
            <CardTitle>{t('Create a video')}</CardTitle>
            <CardDescription>
              {t('Submit an asynchronous Seedance text-to-video task.')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form id='video-generation-form' onSubmit={handleSubmit}>
              <FieldGroup>
                <Field>
                  <FieldLabel>{t('Model and group')}</FieldLabel>
                  <ModelGroupSelector
                    selectedModel={selectedModel}
                    models={models}
                    onModelChange={(value) =>
                      form.setValue('model', value, { shouldValidate: true })
                    }
                    selectedGroup={selectedGroup}
                    groups={groups}
                    onGroupChange={handleGroupChange}
                    disabled={
                      groupsQuery.isPending ||
                      modelsQuery.isPending ||
                      generation.isSubmitting
                    }
                  />
                  {form.formState.errors.model ? (
                    <FieldError>
                      {t(form.formState.errors.model.message ?? '')}
                    </FieldError>
                  ) : null}
                </Field>

                {noVideoModels ? (
                  <Empty className='border'>
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

                <Field data-invalid={Boolean(form.formState.errors.prompt)}>
                  <FieldLabel htmlFor='video-prompt'>{t('Prompt')}</FieldLabel>
                  <Textarea
                    id='video-prompt'
                    rows={7}
                    placeholder={t(
                      'Describe the scene, motion, camera, lighting, and style...'
                    )}
                    aria-invalid={Boolean(form.formState.errors.prompt)}
                    disabled={generation.isSubmitting || noVideoModels}
                    {...form.register('prompt')}
                  />
                  <FieldDescription>
                    {t('Text-to-video only in this first version.')}
                  </FieldDescription>
                  {form.formState.errors.prompt ? (
                    <FieldError>
                      {t(form.formState.errors.prompt.message ?? '')}
                    </FieldError>
                  ) : null}
                </Field>

                <FieldSet>
                  <FieldLegend id='video-duration-label' variant='label'>
                    {t('Video duration')}
                  </FieldLegend>
                  <VideoSegmentedControl
                    labelledBy='video-duration-label'
                    value={String(selectedSeconds)}
                    options={VIDEO_DURATION_OPTIONS.map((seconds) => ({
                      value: String(seconds),
                      label: t('{{value}}s', { value: seconds }),
                    }))}
                    onValueChange={(value) => {
                      form.setValue('seconds', Number(value))
                    }}
                    disabled={generation.isSubmitting || noVideoModels}
                    scrollable
                    backwardLabel={t('Scroll duration backward')}
                    forwardLabel={t('Scroll duration forward')}
                  />
                </FieldSet>

                <FieldSet>
                  <FieldLegend id='video-resolution-label' variant='label'>
                    {t('Resolution')}
                  </FieldLegend>
                  <VideoSegmentedControl
                    labelledBy='video-resolution-label'
                    value={selectedResolution}
                    options={resolutions.map((resolution) => ({
                      value: resolution,
                      label: resolution,
                    }))}
                    onValueChange={(resolution) => {
                      form.setValue('resolution', resolution)
                    }}
                    disabled={generation.isSubmitting || noVideoModels}
                  />
                </FieldSet>

                <FieldSet>
                  <FieldLegend id='video-ratio-label' variant='label'>
                    {t('Aspect ratio')}
                  </FieldLegend>
                  <VideoSegmentedControl
                    labelledBy='video-ratio-label'
                    value={selectedRatio}
                    options={VIDEO_ASPECT_RATIO_OPTIONS.map((ratio) => ({
                      value: ratio,
                      label: ratio,
                    }))}
                    onValueChange={(ratio) => {
                      form.setValue('ratio', ratio)
                    }}
                    disabled={generation.isSubmitting || noVideoModels}
                  />
                </FieldSet>

                <Field
                  orientation='horizontal'
                  className='bg-muted/40 rounded-xl border p-3'
                >
                  <FieldContent>
                    <FieldLabel htmlFor='video-generate-audio'>
                      {t('Generate audio')}
                    </FieldLabel>
                    <FieldDescription>
                      {t(
                        'Adds synchronized sound. Keep this off for a silent video and fewer audio copyright checks.'
                      )}
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    id='video-generate-audio'
                    checked={generateAudio}
                    onCheckedChange={(checked) =>
                      form.setValue('generateAudio', checked)
                    }
                    disabled={generation.isSubmitting || noVideoModels}
                  />
                </Field>

                {optionLoadError || generation.submitError ? (
                  <Alert variant='destructive'>
                    <HugeiconsIcon
                      icon={Alert02Icon}
                      strokeWidth={2}
                      aria-hidden='true'
                    />
                    <AlertTitle>{t('Unable to submit video task')}</AlertTitle>
                    <AlertDescription>
                      {generation.submitError ||
                        t('Failed to load video options')}
                    </AlertDescription>
                  </Alert>
                ) : null}
              </FieldGroup>
            </form>
          </CardContent>
          <CardFooter className='justify-end'>
            <Button
              form='video-generation-form'
              type='submit'
              disabled={
                generation.isSubmitting ||
                modelsQuery.isPending ||
                noVideoModels ||
                selectedModel === ''
              }
            >
              {generation.isSubmitting ? (
                <Spinner data-icon='inline-start' />
              ) : (
                <HugeiconsIcon
                  icon={AiMagicIcon}
                  strokeWidth={2}
                  data-icon='inline-start'
                />
              )}
              {t('Generate video')}
            </Button>
          </CardFooter>
        </Card>

        <VideoGenerationResult
          task={generation.task}
          taskError={generation.taskError}
          statusError={generation.statusError}
          contentError={generation.contentError}
          videoUrl={generation.videoUrl}
          onRetryStatus={() => void generation.retryStatus()}
          onRetryContent={() => void generation.retryContent()}
        />
      </div>
    </div>
  )
}

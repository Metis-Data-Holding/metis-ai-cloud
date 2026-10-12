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
import { useMutation, useQuery } from '@tanstack/react-query'
import { ImageIcon, SendIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input'
import { ErrorState } from '@/components/error-state'
import { ModelGroupSelector } from '@/components/model-group-selector'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import {
  getUserGroups,
  getUserModels,
  getImageTask,
  getImageContent,
  submitImageGeneration,
  type ImageTask,
} from '../../api'
import { DEFAULT_GROUP } from '../../constants'
import {
  imageFormSchema,
  type ImageFormValues,
} from '../../lib/image-form-schema'

function ImageResult(props: {
  task: ImageTask
  onPendingChange: (pending: boolean) => void
}) {
  const { t } = useTranslation()
  const [url, setUrl] = useState<string | null>(null)
  const taskQuery = useQuery({
    queryKey: ['playground', 'image-task', props.task.task_id],
    queryFn: () => getImageTask(props.task.task_id),
    initialData: props.task,
    retry: false,
    refetchInterval: (query) =>
      ['SUCCESS', 'FAILURE'].includes(query.state.data?.status ?? '')
        ? false
        : 3000,
    meta: { errorToast: false },
  })
  const task = taskQuery.data
  const onPendingChange = props.onPendingChange
  const terminal = ['SUCCESS', 'FAILURE'].includes(task.status)
  const content = useQuery({
    queryKey: ['playground', 'image-content', task.task_id],
    queryFn: () => getImageContent(task.task_id),
    enabled: task.status === 'SUCCESS',
    retry: false,
    staleTime: Infinity,
    meta: { errorToast: false },
  })
  useEffect(() => {
    onPendingChange(!terminal)
  }, [terminal, onPendingChange])
  useEffect(() => {
    if (!content.data) return
    const next = URL.createObjectURL(content.data)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [content.data])
  if (task.status === 'FAILURE') {
    return (
      <ErrorState
        title={t('Image generation failed')}
        description={
          task.fail_reason
            ? t(task.fail_reason, { skipInterpolation: true })
            : undefined
        }
      />
    )
  }
  if (taskQuery.error) {
    return (
      <ErrorState
        description={getServerErrorMessage(taskQuery.error)}
        onRetry={() => void taskQuery.refetch()}
      />
    )
  }
  if (content.error) {
    return (
      <ErrorState
        description={getServerErrorMessage(content.error)}
        onRetry={() => void content.refetch()}
      />
    )
  }
  if (!url) {
    return (
      <div role='status' className='flex items-center justify-center gap-2 p-8'>
        <Spinner />
        {task.status === 'SUCCESS' ? t('Loading image') : t('Generating image')}
      </div>
    )
  }
  return (
    <div className='flex flex-col items-center gap-3'>
      <img
        src={url}
        alt={t('Generated image')}
        className='max-h-[65dvh] max-w-full rounded-xl object-contain'
      />
      <Button render={<a href={url} download={`${task.task_id}.png`} />}>
        {t('Download image')}
      </Button>
    </div>
  )
}

export function ImagePlayground() {
  const { t } = useTranslation()
  const [group, setGroup] = useState<string>(DEFAULT_GROUP)
  const [task, setTask] = useState<ImageTask | null>(null)
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)
  const form = useForm<ImageFormValues>({
    resolver: zodResolver(imageFormSchema),
    defaultValues: { prompt: '', seed: '42' },
    mode: 'onChange',
  })
  const groups = useQuery({
    queryKey: ['playground', 'groups'],
    queryFn: getUserGroups,
  })
  const models = useQuery({
    queryKey: ['playground', 'models', group, 'image-generation'],
    queryFn: () => getUserModels(group, 'image-generation'),
    enabled:
      groups.isSuccess && groups.data.some((item) => item.value === group),
  })
  useEffect(() => {
    if (
      groups.data?.length &&
      !groups.data.some((item) => item.value === group)
    ) {
      setGroup(
        (
          groups.data.find((item) => item.value === DEFAULT_GROUP) ??
          groups.data[0]
        ).value
      )
    }
  }, [group, groups.data])
  const available = (models.data ?? []).filter(
    (model) => model.value === 'qwen-image-2.1'
  )
  const model = available[0]?.value ?? ''
  const submission = useMutation({
    mutationFn: (values: ImageFormValues) =>
      submitImageGeneration(group, {
        model,
        prompt: values.prompt,
        n: 1,
        size: '1024x1024',
        ...(values.seed.trim() ? { seed: Number(values.seed) } : {}),
      }),
    onSuccess: (result) => {
      setTask(result)
      setPending(true)
    },
    meta: { errorToast: false },
  })
  const busy = submission.isPending || pending
  const submit = form.handleSubmit(async (values) => {
    if (submitting.current || busy || !model || models.isFetching) return
    submitting.current = true
    try {
      await submission.mutateAsync(values)
    } catch {
      /* 错误由表单展示。 */
    } finally {
      submitting.current = false
    }
  })
  return (
    <div className='flex size-full min-h-0 flex-col'>
      {task ? (
        <div className='min-h-0 flex-1 overflow-y-auto p-4'>
          <ImageResult
            key={task.task_id}
            task={task}
            onPendingChange={setPending}
          />
        </div>
      ) : null}
      <div
        className={cn(
          'mx-auto w-full max-w-5xl p-4',
          !task && 'flex flex-1 flex-col justify-center'
        )}
      >
        {!task ? (
          <div className='mb-6 text-center'>
            <ImageIcon className='mx-auto mb-3 size-8' aria-hidden='true' />
            <h2 className='text-xl font-semibold'>{t('Image generation')}</h2>
            <p className='text-muted-foreground mt-2'>
              {t('Describe the image you want to create')}
            </p>
          </div>
        ) : null}
        {groups.error || models.error ? (
          <ErrorState
            description={getServerErrorMessage(groups.error || models.error)}
            onRetry={() => {
              void groups.refetch()
              void models.refetch()
            }}
          />
        ) : null}
        {!models.isPending && !models.error && !model ? (
          <p role='status' className='text-muted-foreground mb-3'>
            {t('No image models available in this group')}
          </p>
        ) : null}
        {submission.error ? (
          <p role='alert' className='text-destructive mb-3'>
            {getServerErrorMessage(submission.error)}
          </p>
        ) : null}
        <PromptInput
          onSubmit={() => submit()}
          onSubmitCapture={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void submit()
          }}
          groupClassName='bg-card border-border/70 has-disabled:bg-card has-disabled:opacity-100 dark:bg-card dark:has-disabled:bg-card items-stretch rounded-2xl overflow-hidden shadow-lg ring-1 ring-foreground/5 focus-within:border-primary/45 focus-within:ring-primary/15'
        >
          <PromptInputTextarea
            aria-label={t('Prompt')}
            placeholder={t('Describe the image you want to create')}
            disabled={busy}
            {...form.register('prompt')}
            className='min-h-28'
          />
          <PromptInputFooter className='flex-wrap gap-3 p-3'>
            <div className='flex items-center gap-2'>
              <Label htmlFor='image-seed'>{t('Seed')}</Label>
              <Input
                id='image-seed'
                aria-invalid={Boolean(form.formState.errors.seed)}
                inputMode='numeric'
                disabled={busy}
                {...form.register('seed')}
                className='w-32'
              />
              <span className='text-muted-foreground text-xs'>1024 × 1024</span>
            </div>
            <div className='ml-auto flex items-center gap-2'>
              <ModelGroupSelector
                selectedModel={model}
                models={available}
                onModelChange={() => {}}
                selectedGroup={group}
                groups={groups.data ?? []}
                onGroupChange={setGroup}
                disabled={busy}
                className='w-64 max-w-[calc(100vw-6rem)]'
              />
              <PromptInputButton
                type='button'
                variant='default'
                className='shrink-0 rounded-full'
                aria-label={t('Generate image')}
                disabled={
                  busy || !model || models.isFetching || !form.formState.isValid
                }
                onClick={() => void submit()}
              >
                {busy ? <Spinner /> : <SendIcon aria-hidden='true' />}
              </PromptInputButton>
            </div>
          </PromptInputFooter>
        </PromptInput>
        {form.formState.errors.seed ? (
          <p role='alert' className='text-destructive mt-2'>
            {t('Seed must be a non-negative safe integer')}
          </p>
        ) : null}
      </div>
    </div>
  )
}

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
import { AiVideoIcon, Film01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ChevronDownIcon,
  ImagePlusIcon,
  Maximize2Icon,
  Minimize2Icon,
  SendIcon,
  VideoIcon,
} from 'lucide-react'
import { type CSSProperties, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputTextarea,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { ModelGroupSelector } from '@/components/model-group-selector'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { getVideoReferenceAssets } from '../../lib/video/video-reference-assets'
import type {
  GroupOption,
  ModelOption,
  VideoAspectRatio,
  VideoGenerationMode,
  VideoInputContent,
  VideoResolution,
} from '../../types'
import { VideoParameterPanel } from './video-parameter-panel'
import { VideoReferenceInput } from './video-reference-input'

type VideoComposerProps = {
  audio: boolean
  disabled: boolean
  groups: GroupOption[]
  groupValue: string
  inputContent: VideoInputContent[]
  isSubmitting: boolean
  submitDisabled: boolean
  mode: VideoGenerationMode
  models: ModelOption[]
  modelValue: string
  prompt: string
  quantity: number
  ratio: VideoAspectRatio
  resolution: VideoResolution
  resolutions: VideoResolution[]
  seconds: number
  onAudioChange: (value: boolean) => void
  onGroupChange: (value: string) => void
  onInputContentChange: (value: VideoInputContent[]) => void
  onInputValidityChange: (value: boolean) => void
  onModeChange: (value: VideoGenerationMode) => void
  onModelChange: (value: string) => void
  onPromptChange: (value: string) => void
  onQuantityChange: (value: number) => void
  onRatioChange: (value: VideoAspectRatio) => void
  onResolutionChange: (value: VideoResolution) => void
  onSecondsChange: (value: number) => void
  onSubmit: () => void | Promise<void>
}

export function VideoComposer(props: VideoComposerProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [referenceTrayExpanded, setReferenceTrayExpanded] = useState(false)
  const [mentionRange, setMentionRange] = useState<{
    start: number
    end: number
    query: string
  } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const referenceAssets = getVideoReferenceAssets(props.inputContent)
  const modeLabel =
    props.mode === 'reference'
      ? t('Reference generation')
      : t('First and last frames')
  const expandLabel = expanded
    ? t('Collapse prompt input')
    : t('Expand prompt input')

  const submit = (_message: PromptInputMessage) => props.onSubmit()

  const assetLabel = (asset: (typeof referenceAssets)[number]) =>
    t(asset.kind === 'image' ? 'Image {{number}}' : 'Video {{number}}', {
      number: asset.number,
    })

  const handlePromptChange = (value: string, caret: number | null) => {
    props.onPromptChange(value)
    if (props.mode !== 'reference' || referenceAssets.length === 0) {
      setMentionRange(null)
      return
    }
    const end = caret ?? value.length
    const match = value.slice(0, end).match(/@[^@\s]*$/u)
    setMentionRange(
      match
        ? { start: end - match[0].length, end, query: match[0].slice(1) }
        : null
    )
  }

  const insertMention = (mention: string) => {
    if (!mentionRange) return
    const nextPrompt = `${props.prompt.slice(0, mentionRange.start)}@${mention} ${props.prompt.slice(mentionRange.end)}`
    const nextCaret = mentionRange.start + mention.length + 2
    props.onPromptChange(nextPrompt)
    setMentionRange(null)
    queueMicrotask(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret)
    })
  }

  const mentionOptions = mentionRange
    ? referenceAssets.filter((asset) =>
        assetLabel(asset)
          .toLocaleLowerCase()
          .includes(mentionRange.query.toLocaleLowerCase())
      )
    : []

  return (
    <PromptInput
      onSubmit={submit}
      className='relative w-full'
      groupClassName={cn(
        'bg-card border-border/70 has-disabled:bg-card has-disabled:opacity-100 dark:bg-card dark:has-disabled:bg-card items-stretch rounded-2xl overflow-hidden shadow-lg ring-1 ring-foreground/5 transition-[min-height] duration-200 focus-within:border-primary/45 focus-within:ring-primary/15',
        expanded ? 'min-h-[min(36rem,calc(100dvh-14rem))]' : 'min-h-0'
      )}
    >
      <div
        data-slot='video-composer-content'
        className={cn(
          'flex min-w-0 flex-col items-stretch gap-3 p-3 sm:flex-row sm:p-4',
          expanded ? 'flex-1' : 'flex-none'
        )}
      >
        <div
          data-slot='video-reference-area'
          className={cn(
            'min-w-0 shrink-0 self-stretch transition-[width] duration-200',
            props.mode === 'keyframes'
              ? 'w-full sm:w-[22rem] sm:max-w-[46%]'
              : cn(
                  'w-full sm:max-w-[46%]',
                  referenceTrayExpanded
                    ? 'sm:w-[min(46%,var(--expanded-reference-width))] sm:overflow-hidden'
                    : 'sm:w-28 sm:overflow-visible'
                )
          )}
          style={
            props.mode === 'reference'
              ? ({
                  '--expanded-reference-width': `${Math.min(
                    56,
                    (referenceAssets.length + 1) * 7.5
                  )}rem`,
                } as CSSProperties)
              : undefined
          }
        >
          <VideoReferenceInput
            mode={props.mode}
            content={props.inputContent}
            onContentChange={props.onInputContentChange}
            onExpandedChange={setReferenceTrayExpanded}
            onValidityChange={props.onInputValidityChange}
            disabled={props.disabled}
            variant='composer'
          />
        </div>
        <div
          data-slot='video-prompt-area'
          className='relative min-h-28 min-w-0 flex-1 self-stretch'
        >
          <PromptInputTextarea
            ref={textareaRef}
            aria-label={t('Prompt')}
            autoComplete='off'
            autoCorrect='off'
            autoCapitalize='off'
            spellCheck={false}
            disabled={props.disabled}
            value={props.prompt}
            onChange={(event) =>
              handlePromptChange(
                event.currentTarget.value,
                event.currentTarget.selectionStart
              )
            }
            placeholder={t(
              'Use @ to quickly reference uploaded files, for example: use the motion from @Video 1 to generate a video in which the characters from @Image 2 and @Image 3 fight.'
            )}
            className='h-full max-h-none min-h-28 resize-none pr-12 text-base leading-7'
          />
          {mentionRange && mentionOptions.length > 0 ? (
            <div
              role='listbox'
              aria-label={t('Reference content')}
              className='border-border bg-popover absolute bottom-0 left-2 z-30 flex max-h-24 min-w-44 flex-col gap-1 overflow-y-auto rounded-xl border p-1.5 shadow-lg'
            >
              {mentionOptions.map((asset) => {
                const label = assetLabel(asset)
                return (
                  <button
                    key={`${asset.kind}-${asset.number}`}
                    type='button'
                    role='option'
                    aria-selected='false'
                    className='hover:bg-accent focus-visible:bg-accent flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm outline-none'
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertMention(label)}
                  >
                    {asset.kind === 'video' ? (
                      <VideoIcon aria-hidden='true' className='size-4' />
                    ) : (
                      <ImagePlusIcon aria-hidden='true' className='size-4' />
                    )}
                    <span>@{label}</span>
                  </button>
                )
              })}
            </div>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <PromptInputButton
                  aria-label={expandLabel}
                  aria-expanded={expanded}
                  className='absolute top-0 right-0'
                  onClick={() => setExpanded((value) => !value)}
                />
              }
            >
              {expanded ? (
                <Minimize2Icon
                  data-slot='video-expand-icon'
                  data-icon='collapse'
                  aria-hidden='true'
                />
              ) : (
                <Maximize2Icon
                  data-slot='video-expand-icon'
                  data-icon='expand'
                  aria-hidden='true'
                />
              )}
            </TooltipTrigger>
            <TooltipContent>{expandLabel}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <PromptInputFooter
        data-slot='video-composer-footer'
        className='bg-card flex-wrap px-3 py-2.5'
      >
        <div className='flex min-w-0 flex-1 flex-wrap items-center gap-1'>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <PromptInputButton
                  aria-label={t('Generation mode: {{mode}}', {
                    mode: modeLabel,
                  })}
                  disabled={props.disabled}
                />
              }
            >
              <HugeiconsIcon icon={AiVideoIcon} data-icon='inline-start' />
              <span>{modeLabel}</span>
              <ChevronDownIcon data-icon='inline-end' />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side='top'
              sideOffset={8}
              className='w-64 rounded-2xl p-2'
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel className='px-3 py-2 text-sm'>
                  {t('Generation mode')}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={props.mode}
                  onValueChange={(value) =>
                    props.onModeChange(value as VideoGenerationMode)
                  }
                >
                  <DropdownMenuRadioItem
                    value='reference'
                    className='data-checked:bg-accent h-14 cursor-pointer gap-3 px-3 text-base'
                  >
                    <HugeiconsIcon icon={AiVideoIcon} aria-hidden='true' />
                    <span>{t('Reference generation')}</span>
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem
                    value='keyframes'
                    className='data-checked:bg-accent h-14 cursor-pointer gap-3 px-3 text-base'
                  >
                    <HugeiconsIcon icon={Film01Icon} aria-hidden='true' />
                    <span>{t('First and last frames')}</span>
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <VideoParameterPanel
            audio={props.audio}
            disabled={props.disabled}
            quantity={props.quantity}
            ratio={props.ratio}
            resolution={props.resolution}
            resolutions={props.resolutions}
            seconds={props.seconds}
            onAudioChange={props.onAudioChange}
            onQuantityChange={props.onQuantityChange}
            onRatioChange={props.onRatioChange}
            onResolutionChange={props.onResolutionChange}
            onSecondsChange={props.onSecondsChange}
          />
        </div>

        <div className='ml-auto flex min-w-0 items-center gap-2'>
          <ModelGroupSelector
            selectedModel={props.modelValue}
            models={props.models}
            onModelChange={props.onModelChange}
            selectedGroup={props.groupValue}
            groups={props.groups}
            onGroupChange={props.onGroupChange}
            disabled={props.disabled}
            className='max-w-48'
          />
          <PromptInputButton
            type='button'
            size='icon-sm'
            variant='default'
            aria-label={t('Generate video')}
            disabled={props.submitDisabled}
            className='shrink-0 rounded-full'
            onClick={() => void props.onSubmit()}
          >
            {props.isSubmitting ? <Spinner /> : <SendIcon aria-hidden='true' />}
          </PromptInputButton>
        </div>
      </PromptInputFooter>
    </PromptInput>
  )
}

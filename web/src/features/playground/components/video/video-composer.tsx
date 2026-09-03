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
  ArrowDownLeft01Icon,
  ArrowUpRight01Icon,
  AiVideoIcon,
  Film01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { ChevronDownIcon, SendIcon } from 'lucide-react'
import { useState } from 'react'
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
  const modeLabel =
    props.mode === 'reference'
      ? t('Reference generation')
      : t('First and last frames')
  const expandLabel = expanded
    ? t('Collapse prompt input')
    : t('Expand prompt input')

  const submit = (_message: PromptInputMessage) => props.onSubmit()

  return (
    <PromptInput
      onSubmit={submit}
      className='relative w-full'
      groupClassName={cn(
        'bg-card border-border/70 has-disabled:bg-card has-disabled:opacity-100 dark:bg-card dark:has-disabled:bg-card rounded-2xl overflow-hidden shadow-lg ring-1 ring-foreground/5 transition-[min-height] duration-200 focus-within:border-primary/45 focus-within:ring-primary/15',
        expanded ? 'min-h-[54rem]' : 'min-h-72'
      )}
    >
      <div
        data-slot='video-composer-content'
        className='flex min-w-0 flex-1 flex-col items-stretch gap-3 p-3 sm:flex-row sm:p-4'
      >
        <div
          data-slot='video-reference-area'
          className={cn(
            'min-w-0 shrink-0 self-stretch',
            props.mode === 'keyframes'
              ? 'w-full sm:w-[22rem] sm:max-w-[46%]'
              : 'w-full sm:w-auto sm:max-w-[46%]'
          )}
        >
          <VideoReferenceInput
            mode={props.mode}
            content={props.inputContent}
            onContentChange={props.onInputContentChange}
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
            aria-label={t('Prompt')}
            autoComplete='off'
            autoCorrect='off'
            autoCapitalize='off'
            spellCheck={false}
            disabled={props.disabled}
            value={props.prompt}
            onChange={(event) => props.onPromptChange(event.target.value)}
            placeholder={t(
              'Describe the scene, motion, camera, lighting, and style...'
            )}
            className={cn(
              'h-full max-h-none min-h-28 resize-none pr-12 text-base leading-7',
              expanded && 'min-h-[44rem]'
            )}
          />
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
              <HugeiconsIcon
                icon={expanded ? ArrowDownLeft01Icon : ArrowUpRight01Icon}
              />
            </TooltipTrigger>
            <TooltipContent>{expandLabel}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <PromptInputFooter className='border-border/60 bg-card flex-wrap border-t px-3 py-2.5'>
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

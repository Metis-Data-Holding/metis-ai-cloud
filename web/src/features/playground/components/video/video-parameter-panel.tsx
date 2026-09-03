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
import { Settings02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'

import { PromptInputButton } from '@/components/ai-elements/prompt-input'
import { FieldLegend, FieldSet } from '@/components/ui/field'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'

import {
  VIDEO_ASPECT_RATIO_OPTIONS,
  VIDEO_DURATION_OPTIONS,
} from '../../constants'
import type { VideoAspectRatio, VideoResolution } from '../../types'
import { VideoSegmentedControl } from './video-segmented-control'

type VideoParameterPanelProps = {
  audio: boolean
  disabled?: boolean
  quantity: number
  ratio: VideoAspectRatio
  resolution: VideoResolution
  resolutions: VideoResolution[]
  seconds: number
  onAudioChange: (value: boolean) => void
  onQuantityChange: (value: number) => void
  onRatioChange: (value: VideoAspectRatio) => void
  onResolutionChange: (value: VideoResolution) => void
  onSecondsChange: (value: number) => void
}

function VideoParameterContent(props: VideoParameterPanelProps) {
  const { t } = useTranslation()

  return (
    <div className='flex min-w-0 flex-col gap-5 overflow-y-auto p-1'>
      <FieldSet className='min-w-0 gap-2'>
        <FieldLegend id='video-ratio-label' variant='label'>
          {t('Aspect ratio')}
        </FieldLegend>
        <VideoSegmentedControl
          labelledBy='video-ratio-label'
          value={props.ratio}
          options={VIDEO_ASPECT_RATIO_OPTIONS.map((ratio) => ({
            value: ratio,
            label: ratio,
          }))}
          onValueChange={props.onRatioChange}
          disabled={props.disabled}
        />
      </FieldSet>

      <FieldSet className='min-w-0 gap-2'>
        <FieldLegend id='video-resolution-label' variant='label'>
          {t('Resolution')}
        </FieldLegend>
        <VideoSegmentedControl
          labelledBy='video-resolution-label'
          value={props.resolution}
          options={props.resolutions.map((resolution) => ({
            value: resolution,
            label: resolution,
          }))}
          onValueChange={props.onResolutionChange}
          disabled={props.disabled}
        />
      </FieldSet>

      <FieldSet className='min-w-0 gap-2'>
        <FieldLegend id='video-duration-label' variant='label'>
          {t('Video duration')}
        </FieldLegend>
        <VideoSegmentedControl
          labelledBy='video-duration-label'
          value={String(props.seconds)}
          options={VIDEO_DURATION_OPTIONS.map((seconds) => ({
            value: String(seconds),
            label: t('{{value}}s', { value: seconds }),
          }))}
          onValueChange={(value) => props.onSecondsChange(Number(value))}
          disabled={props.disabled}
          scrollable
          backwardLabel={t('Scroll duration backward')}
          forwardLabel={t('Scroll duration forward')}
        />
      </FieldSet>

      <FieldSet className='min-w-0 gap-2'>
        <FieldLegend id='video-audio-label' variant='label'>
          {t('Output audio')}
        </FieldLegend>
        <VideoSegmentedControl
          labelledBy='video-audio-label'
          value={props.audio ? 'on' : 'off'}
          options={[
            { value: 'on', label: t('On') },
            { value: 'off', label: t('Off') },
          ]}
          onValueChange={(value) => props.onAudioChange(value === 'on')}
          disabled={props.disabled}
        />
      </FieldSet>

      <FieldSet className='min-w-0 gap-2'>
        <FieldLegend id='video-quantity-label' variant='label'>
          {t('Generation quantity')}
        </FieldLegend>
        <VideoSegmentedControl
          labelledBy='video-quantity-label'
          value={String(props.quantity)}
          options={[1, 2, 3, 4].map((quantity) => ({
            value: String(quantity),
            label: String(quantity),
          }))}
          onValueChange={(value) => props.onQuantityChange(Number(value))}
          disabled={props.disabled}
        />
      </FieldSet>
    </div>
  )
}

export function VideoParameterPanel(props: VideoParameterPanelProps) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const audio = props.audio ? t('audio on') : t('audio off')
  const videos = t(
    props.quantity === 1 ? '{{count}} video' : '{{count}} videos',
    {
      count: props.quantity,
    }
  )
  const summary = t(
    'Video settings: {{ratio}}, {{resolution}}, {{seconds}}s, {{audio}}, {{videos}}',
    {
      ratio: props.ratio,
      resolution: props.resolution,
      seconds: props.seconds,
      audio,
      videos,
    }
  )
  const trigger = (
    <PromptInputButton
      aria-label={summary}
      disabled={props.disabled}
      className='max-w-full min-w-0'
    >
      <HugeiconsIcon icon={Settings02Icon} data-icon='inline-start' />
      <span className='truncate'>
        {props.ratio} · {props.resolution} · {props.seconds}s · {audio} ·{' '}
        {videos}
      </span>
    </PromptInputButton>
  )

  if (isMobile) {
    return (
      <Sheet>
        <SheetTrigger render={trigger} />
        <SheetContent side='bottom' className='max-h-[85vh] rounded-t-xl'>
          <SheetHeader>
            <SheetTitle>{t('Video settings')}</SheetTitle>
          </SheetHeader>
          <div className='min-h-0 overflow-y-auto px-4 pb-4'>
            <VideoParameterContent {...props} />
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Popover>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        align='start'
        side='top'
        sideOffset={8}
        collisionPadding={12}
        className='max-h-[min(42rem,calc(100vh-2rem))] w-[32rem] max-w-[calc(100vw-2rem)] overflow-hidden p-4'
      >
        <PopoverHeader>
          <PopoverTitle>{t('Video settings')}</PopoverTitle>
        </PopoverHeader>
        <VideoParameterContent {...props} />
      </PopoverContent>
    </Popover>
  )
}

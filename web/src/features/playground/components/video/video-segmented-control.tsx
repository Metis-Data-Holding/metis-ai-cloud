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
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { type ReactNode, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

interface VideoSegmentedOption<T extends string> {
  value: T
  label: ReactNode
}

interface VideoSegmentedControlProps<T extends string> {
  labelledBy: string
  options: readonly VideoSegmentedOption<T>[]
  value: T
  onValueChange: (value: T) => void
  disabled?: boolean
  scrollable?: boolean
  backwardLabel?: string
  forwardLabel?: string
  optionClassName?: string
}

export function VideoSegmentedControl<T extends string>({
  labelledBy,
  options,
  value,
  onValueChange,
  disabled = false,
  scrollable = false,
  backwardLabel,
  forwardLabel,
  optionClassName,
}: VideoSegmentedControlProps<T>) {
  const viewportRef = useRef<HTMLDivElement>(null)

  const scroll = (direction: -1 | 1) => {
    viewportRef.current?.scrollBy({
      left: direction * 180,
      behavior: 'smooth',
    })
  }

  return (
    <div
      data-slot='video-segmented-control'
      className='bg-muted/70 flex min-w-0 items-center gap-1 rounded-xl p-1'
    >
      {scrollable ? (
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          aria-label={backwardLabel}
          disabled={disabled}
          onClick={() => scroll(-1)}
          className='bg-background/70 shadow-xs'
        >
          <ChevronLeftIcon aria-hidden='true' />
        </Button>
      ) : null}

      <div
        ref={viewportRef}
        data-scroll-viewport
        className={cn(
          'min-w-0 flex-1 overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          scrollable ? 'touch-pan-x overflow-x-auto' : 'overflow-hidden'
        )}
      >
        <ToggleGroup
          aria-labelledby={labelledBy}
          value={[value]}
          onValueChange={(values) => {
            const nextValue = values[0] as T | undefined
            if (nextValue) {
              onValueChange(nextValue)
            }
          }}
          spacing={1}
          className={cn('w-full', scrollable && 'min-w-max')}
        >
          {options.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              disabled={disabled}
              className={cn(
                'hover:bg-background/60 min-w-14 flex-1 border-0 bg-transparent px-3 shadow-none',
                'aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm',
                'data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm',
                optionClassName
              )}
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {scrollable ? (
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          aria-label={forwardLabel}
          disabled={disabled}
          onClick={() => scroll(1)}
          className='bg-background/70 shadow-xs'
        >
          <ChevronRightIcon aria-hidden='true' />
        </Button>
      ) : null}
    </div>
  )
}

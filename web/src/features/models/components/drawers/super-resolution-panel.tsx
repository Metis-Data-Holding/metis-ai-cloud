/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  SideDrawerSection,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerSwitchItemClassName,
} from '@/components/drawer-layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { SheetFooter } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import {
  createServerError,
  getServerErrorMessage,
} from '@/lib/server-error-message'

import { updateSuperResolutionConfig } from '../../api'
import { modelsQueryKeys } from '../../lib'
import type { SuperResolutionConfig } from '../../types'

interface SuperResolutionPanelProps {
  modelName: string
  config: SuperResolutionConfig
  onDirtyChange: (dirty: boolean) => void
}

export function SuperResolutionPanel(props: SuperResolutionPanelProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { onDirtyChange } = props
  const enabledId = useId()
  const preserveOriginalId = useId()
  const sourceResolutionId = useId()
  const [enabled, setEnabled] = useState(props.config.enabled)
  const [sourceResolution, setSourceResolution] = useState(
    props.config.source_resolution
  )
  const [preserveOriginal, setPreserveOriginal] = useState(
    props.config.preserve_original
  )

  useEffect(() => {
    setEnabled(props.config.enabled)
    setSourceResolution(props.config.source_resolution)
    setPreserveOriginal(props.config.preserve_original)
  }, [
    props.config.enabled,
    props.config.preserve_original,
    props.config.source_resolution,
  ])

  const dirty =
    enabled !== props.config.enabled ||
    sourceResolution !== props.config.source_resolution ||
    preserveOriginal !== props.config.preserve_original

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  const save = useMutation({
    meta: { errorToast: false },
    mutationFn: async () => {
      const response = await updateSuperResolutionConfig({
        model: props.modelName,
        enabled,
        source_resolution: sourceResolution,
        preserve_original: preserveOriginal,
      })
      if (!response.success || !response.data) {
        throw createServerError(
          response,
          t('Failed to save super-resolution settings')
        )
      }
      return response.data
    },
    onSuccess: (data) => {
      queryClient.setQueryData(
        modelsQueryKeys.superResolution(props.modelName),
        data
      )
      toast.success(t('Super-resolution settings saved'))
    },
  })

  const errorMessage = save.error
    ? getServerErrorMessage(
        save.error,
        t('Failed to save super-resolution settings')
      )
    : null

  return (
    <>
      <div className={sideDrawerFormClassName()}>
        <SideDrawerSection>
          <div>
            <h3 className='text-sm font-semibold'>{t('Super-resolution')}</h3>
            <p className='text-muted-foreground mt-1 text-xs leading-5'>
              {t(
                'Super-resolution runs after video generation and is only visible to administrators.'
              )}
            </p>
          </div>

          <div className={sideDrawerSwitchItemClassName()}>
            <div className='flex flex-col gap-0.5'>
              <Label htmlFor={enabledId} className='text-base'>
                {t('Enable super-resolution')}
              </Label>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Generate at the selected source resolution for requests targeting 1080P and above.'
                )}
              </p>
            </div>
            <Switch
              id={enabledId}
              aria-label={t('Enable super-resolution')}
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>

          {enabled ? (
            <>
              <div className='space-y-3'>
                <div>
                  <Label>{t('Source resolution')}</Label>
                  <p className='text-muted-foreground mt-1 text-xs'>
                    {t(
                      'The temporary resolution used for the initial video generation.'
                    )}
                  </p>
                </div>
                <RadioGroup
                  value={sourceResolution}
                  onValueChange={(value) => {
                    if (value === '480p' || value === '720p') {
                      setSourceResolution(value)
                    }
                  }}
                  aria-label={t('Source resolution')}
                  className='flex flex-wrap gap-5'
                >
                  {(['480p', '720p'] as const).map((value) => (
                    <div key={value} className='flex items-center gap-2'>
                      <RadioGroupItem
                        value={value}
                        id={`${sourceResolutionId}-${value}`}
                      />
                      <Label
                        htmlFor={`${sourceResolutionId}-${value}`}
                        className='cursor-pointer font-normal'
                      >
                        {t(value === '480p' ? '480P' : '720P')}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              <div className={sideDrawerSwitchItemClassName()}>
                <div className='flex flex-col gap-0.5'>
                  <Label htmlFor={preserveOriginalId} className='text-base'>
                    {t('Keep original video')}
                  </Label>
                  <p className='text-muted-foreground text-xs'>
                    {t(
                      'The original video is only available to administrators from task logs and is never shown to customers.'
                    )}
                  </p>
                </div>
                <Switch
                  id={preserveOriginalId}
                  aria-label={t('Keep original video')}
                  checked={preserveOriginal}
                  onCheckedChange={setPreserveOriginal}
                />
              </div>
            </>
          ) : null}

          <div className='text-muted-foreground rounded-md border p-3 text-xs'>
            <div className='flex items-center justify-between gap-3'>
              <span>{t('Enhancement mode')}</span>
              <span className='font-medium'>{t('Fast')}</span>
            </div>
          </div>

          {errorMessage ? (
            <Alert variant='destructive'>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}
        </SideDrawerSection>
      </div>
      <SheetFooter className={sideDrawerFooterClassName()}>
        <Button
          type='button'
          onClick={() => save.mutate()}
          disabled={save.isPending}
        >
          {save.isPending ? t('Saving...') : t('Save settings')}
        </Button>
      </SheetFooter>
    </>
  )
}

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
import { useEffect, useId, useMemo, useState } from 'react'
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
import type {
  SuperResolutionConfig,
  SuperResolutionSourceResolution,
  SuperResolutionTargetResolution,
} from '../../types'

interface SuperResolutionPanelProps {
  modelName: string
  config: SuperResolutionConfig
  onDirtyChange: (dirty: boolean) => void
}

const TARGET_RESOLUTIONS: SuperResolutionTargetResolution[] = ['1080p', '4k']

function getSupportedTargetResolutions(
  modelName: string,
  config: SuperResolutionConfig
): SuperResolutionTargetResolution[] {
  const configured = config.supported_target_resolutions
  const targets: string[] =
    configured ??
    (modelName.toLowerCase().includes('fast') ? [] : ['1080p', '4k'])
  return TARGET_RESOLUTIONS.filter((resolution) => targets.includes(resolution))
}

function getSourceResolutions(
  config: SuperResolutionConfig,
  targets: SuperResolutionTargetResolution[]
): Record<string, SuperResolutionSourceResolution> {
  return Object.fromEntries(
    targets.map((target) => [
      target,
      config.source_resolutions?.[target] ?? config.source_resolution,
    ])
  )
}

function resolutionLabelKey(resolution: SuperResolutionTargetResolution) {
  return resolution === '4k' ? '4K' : '1080P'
}

export function SuperResolutionPanel(props: SuperResolutionPanelProps) {
  const { t } = useTranslation()
  const config = props.config
  const queryClient = useQueryClient()
  const { onDirtyChange } = props
  const enabledId = useId()
  const preserveOriginalId = useId()
  const sourceResolutionId = useId()
  const targetResolutions = useMemo(
    () => getSupportedTargetResolutions(props.modelName, config),
    [props.modelName, config]
  )
  const [sourceResolutions, setSourceResolutions] = useState(() =>
    getSourceResolutions(config, targetResolutions)
  )
  const [enabled, setEnabled] = useState(config.enabled)
  const [sourceResolution, setSourceResolution] = useState(
    config.source_resolution
  )
  const [preserveOriginal, setPreserveOriginal] = useState(
    config.preserve_original
  )

  useEffect(() => {
    setEnabled(config.enabled)
    setSourceResolution(config.source_resolution)
    setSourceResolutions(getSourceResolutions(config, targetResolutions))
    setPreserveOriginal(config.preserve_original)
  }, [config, targetResolutions])

  const dirty =
    enabled !== config.enabled ||
    sourceResolution !== config.source_resolution ||
    preserveOriginal !== config.preserve_original ||
    JSON.stringify(sourceResolutions) !==
      JSON.stringify(getSourceResolutions(config, targetResolutions))

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  const canEnable = targetResolutions.length > 0
  const effectiveEnabled = canEnable && enabled

  const save = useMutation({
    meta: { errorToast: false },
    mutationFn: async () => {
      const response = await updateSuperResolutionConfig({
        model: props.modelName,
        enabled: effectiveEnabled,
        source_resolution: sourceResolution,
        source_resolutions: sourceResolutions,
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
              checked={effectiveEnabled}
              onCheckedChange={setEnabled}
              disabled={!canEnable}
            />
          </div>

          {effectiveEnabled ? (
            <>
              {targetResolutions.map((target) => {
                const targetSourceResolution =
                  sourceResolutions[target] ?? sourceResolution
                const targetSourceResolutionId = `${sourceResolutionId}-${target}`
                return (
                  <div key={target} className='space-y-3'>
                    <div>
                      <Label>
                        {t('Target resolution')}:{' '}
                        {t(resolutionLabelKey(target))}
                      </Label>
                      <p className='text-muted-foreground mt-1 text-xs'>
                        {t(
                          'The temporary resolution used for the initial video generation.'
                        )}
                      </p>
                    </div>
                    <RadioGroup
                      value={targetSourceResolution}
                      onValueChange={(value) => {
                        if (value !== '480p' && value !== '720p') return
                        setSourceResolutions((current) => ({
                          ...current,
                          [target]: value,
                        }))
                        setSourceResolution(value)
                      }}
                      aria-label={`${t('Source resolution')} ${t(resolutionLabelKey(target))}`}
                      className='flex flex-wrap gap-5'
                    >
                      {(['480p', '720p'] as const).map((value) => (
                        <div key={value} className='flex items-center gap-2'>
                          <RadioGroupItem
                            value={value}
                            id={`${targetSourceResolutionId}-${value}`}
                          />
                          <Label
                            htmlFor={`${targetSourceResolutionId}-${value}`}
                            className='cursor-pointer font-normal'
                          >
                            {t(value === '480p' ? '480P' : '720P')}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                )
              })}

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

          {targetResolutions.length === 0 ? (
            <Alert>
              <AlertDescription>
                {t(
                  'This model has no supported high-resolution output for super-resolution.'
                )}
              </AlertDescription>
            </Alert>
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

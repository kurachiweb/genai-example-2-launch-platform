import { useId } from 'react';
import { useFormContext } from 'react-hook-form';

import {
  API_KEY_FEATURE_LABELS,
  API_KEY_FEATURES,
  API_KEY_LEVEL_LABELS,
  type ApiKeyFeature,
  type ApiKeyWriteLevel,
  isAllowedScopeLevel,
} from '../../../common-lib/public-api/api-key-rules.ts';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { Label } from '../../../lib/components/ui/label/label.tsx';
import { RadioGroup } from '../../../lib/components/ui/radio-group/radio-group.tsx';
import { RadioGroupItem } from '../../../lib/components/ui/radio-group/radio-group-item.tsx';
import { API_KEY_FORM_MESSAGES } from './api-key-form-messages.ts';
import type { ApiKeyFormValues } from './api-key-form-schema.ts';

const LEVELS: readonly ApiKeyWriteLevel[] = Object.freeze([
  'none',
  'read',
  'read_write',
]);

// 機能ごとに選べる値だけを示し、読み書きを選べない機能に選択肢を出さない
const levelsOf = (feature: ApiKeyFeature): readonly ApiKeyWriteLevel[] =>
  LEVELS.filter((level) => isAllowedScopeLevel(feature, level));

function ScopeRadioGroup({ feature }: { readonly feature: ApiKeyFeature }) {
  const { control } = useFormContext<ApiKeyFormValues>();
  const itemBaseId = useId();
  return (
    <FormField
      control={control}
      name={`scopes.${feature}`}
      label={API_KEY_FEATURE_LABELS[feature]}
      className="gap-1.5 sm:grid sm:grid-cols-[minmax(0,10rem)_1fr] sm:items-center sm:gap-x-4 sm:[&>[data-slot=form-message]]:col-start-2"
    >
      {(field) => (
        <RadioGroup
          id={field.id}
          ref={field.ref}
          value={field.value}
          onValueChange={field.onChange}
          onBlur={field.onBlur}
          disabled={field.disabled}
          aria-labelledby={field.labelId}
          aria-describedby={field['aria-describedby']}
          aria-invalid={field['aria-invalid']}
          className="flex flex-wrap gap-x-5 gap-y-2"
        >
          {levelsOf(feature).map((level) => (
            <div key={level} className="flex items-center gap-2">
              <RadioGroupItem id={`${itemBaseId}-${level}`} value={level} />
              <Label htmlFor={`${itemBaseId}-${level}`} className="font-normal">
                {API_KEY_LEVEL_LABELS[level]}
              </Label>
            </div>
          ))}
        </RadioGroup>
      )}
    </FormField>
  );
}

export function ApiKeyScopeFields() {
  const descriptionId = useId();
  return (
    <fieldset
      aria-describedby={descriptionId}
      className="flex min-w-0 flex-col gap-3"
    >
      <legend className="text-sm font-medium">
        {API_KEY_FORM_MESSAGES.scopesHeading}
      </legend>
      <p id={descriptionId} className="text-sm text-muted-foreground">
        {API_KEY_FORM_MESSAGES.scopesDescription}
      </p>
      <div className="flex flex-col gap-3 rounded-md border p-3 sm:gap-2">
        {API_KEY_FEATURES.map((feature) => (
          <ScopeRadioGroup key={feature} feature={feature} />
        ))}
      </div>
    </fieldset>
  );
}

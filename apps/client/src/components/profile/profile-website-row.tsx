import { FormField } from '../../../lib/components/form/form-field.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import type { ProfileEditFormApi } from './profile-edit-form-types.ts';
import {
  WEBSITE_NAME_LABEL,
  WEBSITE_REMOVE_LABEL,
  WEBSITE_URL_LABEL,
  websiteRemoveLabelOf,
  websiteRowLabelOf,
} from './profile-form-messages.ts';

const nameFieldOf = (index: number) =>
  `websites.${String(index)}.name` as `websites.${number}.name`;

const urlFieldOf = (index: number) =>
  `websites.${String(index)}.url` as `websites.${number}.url`;

export interface ProfileWebsiteRowProps {
  readonly form: ProfileEditFormApi;
  readonly index: number;
  readonly disabled: boolean;
  readonly onRemove: () => void;
}

export function ProfileWebsiteRow({
  form,
  index,
  disabled,
  onRemove,
}: ProfileWebsiteRowProps) {
  const position = index + 1;
  return (
    <div
      role="group"
      aria-label={websiteRowLabelOf(position)}
      className="flex flex-col gap-3 sm:flex-row sm:items-start"
    >
      <FormField
        control={form.control}
        name={nameFieldOf(index)}
        label={WEBSITE_NAME_LABEL}
        className="sm:w-56"
        disabled={disabled}
      >
        {(control) => <Input {...control} autoComplete="off" />}
      </FormField>
      <FormField
        control={form.control}
        name={urlFieldOf(index)}
        label={WEBSITE_URL_LABEL}
        className="min-w-0 sm:flex-1"
        disabled={disabled}
      >
        {(control) => (
          <Input
            {...control}
            type="url"
            inputMode="url"
            autoComplete="off"
            aria-required
          />
        )}
      </FormField>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start sm:mt-7"
        aria-label={websiteRemoveLabelOf(position)}
        disabled={disabled}
        onClick={onRemove}
      >
        {WEBSITE_REMOVE_LABEL}
      </Button>
    </div>
  );
}

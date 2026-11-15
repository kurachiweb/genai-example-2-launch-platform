import type { UseFormReturn } from 'react-hook-form';

import type {
  ProfileFormInput,
  ProfileFormValues,
} from './profile-form-schema.ts';

export type ProfileEditFormApi = UseFormReturn<
  ProfileFormInput,
  unknown,
  ProfileFormValues
>;

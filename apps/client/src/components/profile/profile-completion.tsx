import { CircleDashedIcon, SettingsIcon } from 'lucide-react';

import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { PROFILE_EDIT_HREF } from './profile-paths.ts';
import {
  PROFILE_COMPLETION_DESCRIPTION,
  PROFILE_COMPLETION_FIELDS,
  PROFILE_COMPLETION_TITLE,
  PROFILE_SETUP_LABEL,
} from './profile-messages.ts';

const HEADING_ID = 'profile-completion-heading';

export function ProfileCompletion() {
  return (
    <section
      aria-labelledby={HEADING_ID}
      className="mt-5 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4"
    >
      <h2 id={HEADING_ID} className="text-sm font-bold">
        {PROFILE_COMPLETION_TITLE}
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {PROFILE_COMPLETION_DESCRIPTION}
      </p>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        {PROFILE_COMPLETION_FIELDS.map((field) => (
          <li key={field} className="flex items-center gap-1.5">
            <CircleDashedIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 text-primary"
            />
            {field}
          </li>
        ))}
      </ul>
      <Button size="sm" className="mt-4 w-full" asChild>
        <PathLink href={PROFILE_EDIT_HREF}>
          <SettingsIcon aria-hidden="true" />
          {PROFILE_SETUP_LABEL}
        </PathLink>
      </Button>
    </section>
  );
}

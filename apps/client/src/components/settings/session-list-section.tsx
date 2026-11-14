import { useRef } from 'react';

import { RevokeOtherSessionsButton } from './revoke-other-sessions-button.tsx';
import { SessionListItem, type SessionSummary } from './session-list-item.tsx';
import { SettingsSection } from './settings-section.tsx';
import {
  SESSIONS_SECTION_DESCRIPTION,
  SESSIONS_SECTION_TITLE,
  sessionCountMessage,
} from './settings-messages.ts';

export interface SessionListSectionProps {
  readonly sessions: readonly SessionSummary[];
}

export function SessionListSection({ sessions }: SessionListSectionProps) {
  const countRef = useRef<HTMLParagraphElement>(null);
  const hasOtherSessions = sessions.some(({ current }) => !current);

  // 押したボタンは失効させた端末とともに一覧から消えるため、フォーカスを残る要素へ移す
  const focusCount = (): void => {
    countRef.current?.focus();
  };

  return (
    <SettingsSection
      title={SESSIONS_SECTION_TITLE}
      description={<p>{SESSIONS_SECTION_DESCRIPTION}</p>}
    >
      <p ref={countRef} tabIndex={-1} className="rounded-sm font-medium">
        {sessionCountMessage(sessions.length)}
      </p>
      <ul className="flex flex-col divide-y divide-border">
        {sessions.map((session) => (
          <SessionListItem
            key={session.id}
            session={session}
            onRevoked={focusCount}
          />
        ))}
      </ul>
      {hasOtherSessions ? (
        <RevokeOtherSessionsButton onRevoked={focusCount} />
      ) : null}
    </SettingsSection>
  );
}

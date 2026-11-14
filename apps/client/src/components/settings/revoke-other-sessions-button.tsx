import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { notify } from '../../../lib/components/feedback/notify.ts';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Dialog } from '../../../lib/components/ui/dialog/dialog.tsx';
import { DialogClose } from '../../../lib/components/ui/dialog/dialog-close.tsx';
import { DialogContent } from '../../../lib/components/ui/dialog/dialog-content.tsx';
import { DialogDescription } from '../../../lib/components/ui/dialog/dialog-description.tsx';
import { DialogFooter } from '../../../lib/components/ui/dialog/dialog-footer.tsx';
import { DialogHeader } from '../../../lib/components/ui/dialog/dialog-header.tsx';
import { DialogTitle } from '../../../lib/components/ui/dialog/dialog-title.tsx';
import { DialogTrigger } from '../../../lib/components/ui/dialog/dialog-trigger.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { ClientRevokeOtherSessionsDocument } from '../../graphql/generated/graphql.ts';
import { MY_SESSIONS_QUERY_PREFIX } from './my-sessions-query.ts';
import {
  CANCEL_LABEL,
  otherSessionsRevokedMessage,
  REVOKE_OTHER_SESSIONS_CONFIRM_DESCRIPTION,
  REVOKE_OTHER_SESSIONS_CONFIRM_LABEL,
  REVOKE_OTHER_SESSIONS_CONFIRM_TITLE,
  REVOKE_OTHER_SESSIONS_LABEL,
} from './settings-messages.ts';

export interface RevokeOtherSessionsButtonProps {
  readonly onRevoked: () => void;
}

export function RevokeOtherSessionsButton({
  onRevoked,
}: RevokeOtherSessionsButtonProps) {
  const [open, setOpen] = useState(false);
  const revokedRef = useRef(false);
  const queryClient = useQueryClient();
  const revokeOthers = useMutation({
    ...graphqlMutationOptions(ClientRevokeOtherSessionsDocument),
    onSuccess: async ({ revokeOtherSessions }) => {
      notify.success(otherSessionsRevokedMessage(revokeOtherSessions));
      revokedRef.current = true;
      setOpen(false);
      await queryClient.invalidateQueries({
        queryKey: MY_SESSIONS_QUERY_PREFIX,
      });
      onRevoked();
    },
    onError: (error) => {
      notify.error(errorMessageOf(error, CLIENT_PROFILE.contactAvailable));
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="self-start">
          {REVOKE_OTHER_SESSIONS_LABEL}
        </Button>
      </DialogTrigger>
      <DialogContent
        onCloseAutoFocus={(event) => {
          // 失効の後は一覧を取り直すとこのボタンが消えるため、開いた元へ戻さず、取り直した後に呼び出し側が示す要素へ移す
          if (revokedRef.current) {
            revokedRef.current = false;
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{REVOKE_OTHER_SESSIONS_CONFIRM_TITLE}</DialogTitle>
          <DialogDescription>
            {REVOKE_OTHER_SESSIONS_CONFIRM_DESCRIPTION}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {CANCEL_LABEL}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            aria-disabled={revokeOthers.isPending || undefined}
            aria-busy={revokeOthers.isPending || undefined}
            onClick={() => {
              if (!revokeOthers.isPending) {
                revokeOthers.mutate({ variables: {} });
              }
            }}
          >
            {REVOKE_OTHER_SESSIONS_CONFIRM_LABEL}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

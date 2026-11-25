import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { ModerationCommentHiddenInput } from '../../../../../lib/core/email/kinds/ugc-moderation.ts';
import { ModerationActedAtText } from './moderation-acted-at-text.tsx';
import { ModerationMultilineText } from './moderation-multiline-text.tsx';
import { commentHiddenLead } from './moderation-notice-copy.ts';

interface CommentHiddenEmailBodyProps {
  readonly input: ModerationCommentHiddenInput;
}

export function CommentHiddenEmailBody({
  input,
}: CommentHiddenEmailBodyProps): ReactNode {
  return (
    <>
      <Text>{commentHiddenLead(input.productName)}</Text>
      <ModerationActedAtText label="公開の停止日時" at={input.hiddenAt} />
      <ModerationMultilineText label="コメント" value={input.excerpt} />
      <ModerationMultilineText label="理由" value={input.reason} />
      <Text>
        公開を停止している間、このコメントは他のユーザーに表示されません。
      </Text>
      <Text>ご質問がある場合は、下のボタンからお問い合わせください。</Text>
    </>
  );
}

import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { ModerationProductHiddenInput } from '../../../../../lib/core/email/kinds/ugc-moderation.ts';
import { ModerationActedAtText } from './moderation-acted-at-text.tsx';
import { ModerationMultilineText } from './moderation-multiline-text.tsx';
import {
  PRODUCT_HIDDEN_SPONSORSHIP_PARAGRAPH,
  productHiddenLead,
} from './moderation-notice-copy.ts';

interface ProductHiddenEmailBodyProps {
  readonly input: ModerationProductHiddenInput;
}

export function ProductHiddenEmailBody({
  input,
}: ProductHiddenEmailBodyProps): ReactNode {
  return (
    <>
      <Text>{productHiddenLead(input.productName)}</Text>
      <ModerationActedAtText label="公開の停止日時" at={input.hiddenAt} />
      <ModerationMultilineText label="理由" value={input.reason} />
      <Text>
        公開を停止している間、このプロダクトは他のユーザーに表示されません。このプロダクトのまだ始まっていないマッチの予定は取り消され、公開が再開されても元に戻りません。
      </Text>
      <Text>{PRODUCT_HIDDEN_SPONSORSHIP_PARAGRAPH}</Text>
      <Text>
        トーナメントの組み合わせ決定の時点でこのプロダクトの公開を停止している場合、支払ったトーナメントの参加費は自動で全額返金されます。
      </Text>
      <Text>
        内容を直したら、下のボタンからお問い合わせのうえ、確認を依頼してください。
      </Text>
    </>
  );
}

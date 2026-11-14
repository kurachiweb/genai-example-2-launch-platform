import { describe, expect, test, vi } from 'vitest';

import type {
  EmailProvider,
  OutgoingEmail,
} from '../../../application/email/ports.ts';
import { createRecipientAllowlistProvider } from './recipient-allowlist-provider.ts';

const OUTGOING: OutgoingEmail = {
  from: { address: 'noreply@sender.example', name: 'Launch Stadium' },
  to: 'allowed@recipient.example',
  subject: '疎通確認',
  html: '<p>疎通確認です。</p>',
  text: '疎通確認です。',
  headers: {},
};

function createInner() {
  const spy = vi.fn<EmailProvider['send']>(() =>
    Promise.resolve({ kind: 'sent', providerMessageId: 'inner-message-1' }),
  );
  const inner: EmailProvider = { send: spy };
  return { inner, spy };
}

describe('宛先制限の送信プロバイダ', () => {
  test('許可された照合キーの宛先は包んだ実装で送り、その結果を返す', async () => {
    const { inner, spy } = createInner();
    const provider = createRecipientAllowlistProvider(
      inner,
      new Set(['allowed@recipient.example']),
    );

    const outcome = await provider.send(OUTGOING);

    expect(outcome).toEqual({
      kind: 'sent',
      providerMessageId: 'inner-message-1',
    });
    expect(spy).toHaveBeenCalledWith(OUTGOING);
  });

  test('宛先を照合キーにしてから許可を判定し、元の宛先のまま送る', async () => {
    const { inner, spy } = createInner();
    const provider = createRecipientAllowlistProvider(
      inner,
      new Set(['allowed@recipient.example']),
    );
    const email = { ...OUTGOING, to: ' Allowed@Recipient.EXAMPLE ' };

    await provider.send(email);

    expect(spy).toHaveBeenCalledWith(email);
  });

  test('許可されていない宛先は送らずに環境の宛先制限として返す', async () => {
    const { inner, spy } = createInner();
    const provider = createRecipientAllowlistProvider(
      inner,
      new Set(['allowed@recipient.example']),
    );

    const outcome = await provider.send({
      ...OUTGOING,
      to: 'stranger@recipient.example',
    });

    expect(outcome).toEqual({ kind: 'recipient-not-allowed' });
    expect(spy).not.toHaveBeenCalled();
  });

  test('許可が空ならどの宛先にも送らない', async () => {
    const { inner, spy } = createInner();
    const provider = createRecipientAllowlistProvider(inner, new Set());

    const outcome = await provider.send(OUTGOING);

    expect(outcome).toEqual({ kind: 'recipient-not-allowed' });
    expect(spy).not.toHaveBeenCalled();
  });
});

import { describe, expect, test } from 'bun:test';

import { filterApplyOutput } from './apply-output.ts';

const APPLY_OUTPUT = `ephemeral.infisical_secret.cloudflare_api_token: Opening...
ephemeral.infisical_secret.cloudflare_api_token: Opening complete after 0s
module.storage.cloudflare_d1_database.this["main"]: Creating...
module.storage.cloudflare_d1_database.this["main"]: Still creating... [10s elapsed]
module.storage.cloudflare_d1_database.this["main"]: Creation complete after 12s [id=3f9c2b1a-6d4e-4f8a-9b7c-1e2d3c4b5a69]
module.edge_services.cloudflare_turnstile_widget.this: Modifying... [id=0x4AAAAAAA]
module.queues[0].cloudflare_queue.this: Destroying... [id=abc]
data.cloudflare_zone.this: Reading...
ephemeral.infisical_secret.cloudflare_api_token: Closing...

Warning: Value for undeclared variable

  secret = "fake-turnstile-secret-value"

Error: Error creating widget

  with module.edge_services.cloudflare_turnstile_widget.this,
  on ../modules/edge-services/main.tf line 1:
   1: resource "cloudflare_turnstile_widget" "this" {

fake-turnstile-secret-value
Apply complete! Resources: 1 added, 1 changed, 1 destroyed.

Outputs:

resource_ids = {
  "turnstile_sitekey" = "0x4AAAAAAA"
}
`;

describe('filterApplyOutput', () => {
  test('資源のアドレスで始まる行と完了の行だけを残し、警告・誤りの詳細・出力の値を捨てる', () => {
    const kept = APPLY_OUTPUT.split('\n').flatMap((line) => {
      const shown = filterApplyOutput(line);
      return shown === undefined ? [] : [shown];
    });

    expect(kept).toEqual([
      'ephemeral.infisical_secret.cloudflare_api_token: Opening...',
      'ephemeral.infisical_secret.cloudflare_api_token: Opening complete after 0s',
      'module.storage.cloudflare_d1_database.this["main"]: Creating...',
      'module.storage.cloudflare_d1_database.this["main"]: Still creating... [10s elapsed]',
      'module.storage.cloudflare_d1_database.this["main"]: Creation complete after 12s [id=3f9c2b1a-6d4e-4f8a-9b7c-1e2d3c4b5a69]',
      'module.edge_services.cloudflare_turnstile_widget.this: Modifying... [id=0x4AAAAAAA]',
      'module.queues[0].cloudflare_queue.this: Destroying... [id=abc]',
      'data.cloudflare_zone.this: Reading...',
      'ephemeral.infisical_secret.cloudflare_api_token: Closing...',
      'Apply complete! Resources: 1 added, 1 changed, 1 destroyed.',
    ]);
  });

  test.each([
    [
      '行頭に空白がある資源のアドレス',
      '  module.storage.cloudflare_d1_database.this: Creating...',
    ],
    [
      'アドレスの後に区切りが無い',
      'module.storage.cloudflare_d1_database.this Creating...',
    ],
    ['種類と名前の組でない', 'resource_ids: {'],
    [
      '色の制御文字で始まる',
      '\u001b[1mmodule.storage.cloudflare_d1_database.this: Creating...',
    ],
  ])('%s行は捨てる', (_label, line) => {
    expect(filterApplyOutput(line)).toBeUndefined();
  });
});

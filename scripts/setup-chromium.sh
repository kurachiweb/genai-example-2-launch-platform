#!/bin/sh
set -eu

# Playwright・chrome-devtools MCPが必要とするChromiumを導入する。
# Chromium本体は`bun install`で解決された`@playwright/test`の実際のバージョンに追従させる必要があるため、イメージビルド時ではなくこのスクリプトの実行時に都度インストールする。該当リビジョンが既にあれば再ダウンロードは行われない。

# `bunx --bun playwright`はカレントディレクトリの`node_modules`を解決するため、Playwrightがインストールされている位置に移る。
cd /workspace

if [ ! -x /workspace/node_modules/.bin/playwright ]; then
  echo 'Playwrightが未インストールのためChromiumのセットアップをスキップしました。ルートディレクトリで`bun install`を実行してから、このスクリプトを再実行してください。' >&2
  exit 0
fi

if ! { bunx --bun playwright install chromium \
  && ln -sf "$(find "${PLAYWRIGHT_BROWSERS_PATH}" -maxdepth 1 -type d -name 'chromium-*' | sort -V | tail -n 1)/chrome-linux/chrome" "${CHROMIUM_PATH}" \
  && test -x "${CHROMIUM_PATH}"; }; then
  echo "Chromiumのセットアップに失敗しました。CHROMIUM_PATH=${CHROMIUM_PATH} が実行可能ファイルとして存在しません。" >&2
  exit 1
fi

# syntax=docker/dockerfile:1

# opentofu・wrangler・gh・gitleaks・mailpit・nodeを導入する専用ビルドステージ。
# `node`パッケージはアプリケーションコードの実行には使わないものの、Wrangler CLI、Vitest系テストランナーが必要とするため、明示的に導入する。
# nixpkgsのビルド済みキャッシュ(cache.nixos.org)を利用でき、自前ビルドを避けられる。
# 最終イメージには`/nix`のクロージャと固定シンボリックリンク(`/opt/tools-profile`)だけをCOPYし、`nix`コマンド自体は含めない。
FROM nixos/nix:2.35.1 AS nix-builder

# Nixのビルドサンドボックスは非特権ユーザー名前空間を要求するが、コンテナ内では無効なため利用できない(後述のChromiumサンドボックスと同じ制約)。
# 対象パッケージは全てcache.nixos.orgにビルド済みキャッシュがあり実際のサンドボックスビルドが発生しないため、無効化しても差し支えない。
# nixpkgsはリリースブランチを固定参照し、再現性のあるバージョンを取得する。
ARG NIXPKGS_ARCHIVE_URL=https://github.com/NixOS/nixpkgs/archive/refs/heads/nixos-26.05.tar.gz
# Nixストアのパスはパッケージ内容に応じたハッシュを含み事前に予測できないため、`-p`オプションで`/opt/tools-profile`という固定パスの世代シンボリックリンクを作成し、ハッシュを意識せずPATH指定やCOPY対象の指定を行えるようにする。
RUN mkdir -p /etc/nix /opt \
  && echo 'sandbox = false' >> /etc/nix/nix.conf \
  && nix-env -p /opt/tools-profile -f "${NIXPKGS_ARCHIVE_URL}" -iA opentofu wrangler gh gitleaks mailpit nodejs

# 最終イメージへCOPYするクロージャ(依存パッケージ一式)と、固定パスのシンボリックリンク一式を`/closure`へ集約する。
RUN mkdir -p /closure/nix/store \
  && for p in $(nix-store -qR /opt/tools-profile); do \
  cp -a --parents "$p" /closure/; \
  done \
  && cp -a --parents /opt/tools-profile /closure/ \
  && cp -a --parents /opt/tools-profile-1-link /closure/

# 本番環境はCloudflare Workers(サーバーレス)で動くため、このイメージは開発専用でありデプロイしない。
FROM oven/bun:1.3-slim

# 各種CLIツールのインストーラやネイティブ依存のビルドに必要なパッケージを導入する。
# apt-getのダウンロードキャッシュはキャッシュマウントでビルド間永続化し再ダウンロードを避ける。公式Debianベースイメージが標準で有効化するdocker-cleanフックはapt-get実行直後にキャッシュを削除するため、キャッシュマウントを機能させるには無効化が必要。
# Infisical(秘密情報管理サービス)のCLIは公式のAPTリポジトリを登録し、apt-getで導入する。
RUN --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
  --mount=type=cache,target=/var/cache/apt,sharing=locked \
  rm -f /etc/apt/apt.conf.d/docker-clean \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates build-essential procps curl file git \
  && curl -1sLf 'https://artifacts-cli.infisical.com/setup.deb.sh' | bash \
  && apt-get install -y --no-install-recommends infisical

# opentofu・wrangler・gh・gitleaks・mailpit・nodeのクロージャと、固定パスのシンボリックリンク(`/opt/tools-profile`)を導入する。
COPY --from=nix-builder /closure/nix /nix
COPY --from=nix-builder /closure/opt /opt
ENV PATH="/opt/tools-profile/bin:${PATH}"

# Playwright・chrome-devtools MCPが起動するChromiumを導入する。
# ChromiumバイナリのOS側共有ライブラリ(libnss3等)はrootユーザーとして導入する。
# Chromium本体は`bun install`後に確定する`@playwright/test`の実バージョンに一致させる必要があるため、entrypoint.sh側でbunユーザーが導入する(不一致は`Executable doesn't exist`エラーの原因になる)。
# CHROMIUM_PATHはMCPサーバーへ実行ファイルを絶対パスで渡すための固定シンボリックリンク先。
# コンテナでは非特権ユーザー名前空間が無効でサンドボックスが起動できないため、.mcp.json側で--no-sandboxを渡す。
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
ENV CHROMIUM_PATH=/opt/ms-playwright-bin/chrome
RUN --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
  --mount=type=cache,target=/var/cache/apt,sharing=locked \
  bunx --bun playwright@latest install-deps chromium \
  && mkdir -p ${PLAYWRIGHT_BROWSERS_PATH} /opt/ms-playwright-bin \
  && chown -R bun:bun ${PLAYWRIGHT_BROWSERS_PATH} /opt/ms-playwright-bin

# bunユーザーはsudo権限がなく自分でディレクトリを作れないため、rootのうちに作成してbun所有に変更しておく。
# Claude、Infisical、Cloudflareのログイン情報を永続化し、コンテナ再作成時の再認証を不要にする。
ENV CLAUDE_CONFIG_DIR=/home/bun/.claude
RUN mkdir -p /home/bun/.claude \
  && chown -R bun:bun /home/bun/.claude \
  && mkdir -p /home/bun/.infisical \
  && chown -R bun:bun /home/bun/.infisical \
  && mkdir -p /home/bun/.wrangler \
  && chown -R bun:bun /home/bun/.wrangler

# node_modulesは名前付きボリューム(node_modules_***)で分離する。
# 名前付きボリュームは中身が空だとマウント先ディレクトリの所有者をそのまま引き継ぐため、
# 非rootに切り替える前にbun所有で作成しておき、bunユーザーのbun installが書き込めるようにする(権限エラー回避)。
RUN mkdir -p /workspace/node_modules \
  && chown -R bun:bun /workspace/node_modules \
  && mkdir -p /workspace/apps/api/node_modules \
  && chown -R bun:bun /workspace/apps/api/node_modules \
  && mkdir -p /workspace/apps/public-api/node_modules \
  && chown -R bun:bun /workspace/apps/public-api/node_modules \
  && mkdir -p /workspace/apps/db/node_modules \
  && chown -R bun:bun /workspace/apps/db/node_modules \
  && mkdir -p /workspace/apps/client/node_modules \
  && chown -R bun:bun /workspace/apps/client/node_modules \
  && mkdir -p /workspace/apps/admin/node_modules \
  && chown -R bun:bun /workspace/apps/admin/node_modules \
  && mkdir -p /workspace/apps/frontend-lib/node_modules \
  && chown -R bun:bun /workspace/apps/frontend-lib/node_modules

USER bun
WORKDIR /workspace

# Claude Codeはコンテナ内で自動アップデートされるよう、公式ネイティブインストーラで導入する。
# rtkはnixpkgsに未収録のため、公式install.shで導入する。
ENV PATH="/home/bun/.local/bin:${PATH}"
RUN curl -fsSL https://claude.ai/install.sh | bash \
  && curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh

# コンテナ起動時のセットアップ処理はスクリプトへ切り出す。
COPY --chmod=755 scripts/entrypoint.sh /usr/local/bin/entrypoint.sh

# entrypoint.shは`.`(source)で読み込む。別プロセスとして実行すると常駐プロセスがPID1(docker-init)の子であるshの子でなくなり、スクリプト内のtrapもスクリプト終了時に失われるため、停止時にMailpitへSIGTERMを転送できなくなる。
# `sleep infinity`は「何もせず永遠に待ち続けるだけ」のコマンドで、これをバックグラウンドで動かし続けることでPID1のshを終了させず、コンテナを生かし続ける(Mailpitが落ちてもコンテナは生存する)。
# `wait $!`は直前にバックグラウンド実行した`sleep infinity`の終了を待つ組み込みコマンドで、シグナル(SIGTERMなど)を受けると即座に中断されるため、コンテナ停止時にスクリプト内の`trap`をすぐ発火できる。
CMD ["sh", "-c", ". /usr/local/bin/entrypoint.sh; sleep infinity & wait $!"]

# syntax=docker/dockerfile:1

# gh・OpenTofu・Wranglerを導入する専用ビルドステージ。
# 各ツールは可能な限りAPT(公式リポジトリ)、それが無ければnpmレジストリ(bun経由)の順で取得する。
# `apt-get install`ではなく`apt-get download`+`dpkg -x`でファイルのみを抽出することで、postinstスクリプトやAPT状態を最終イメージに残さない。
FROM oven/bun:1.3.14-slim AS tools-builder
ARG GH_VERSION=2.97.0
ARG TOFU_VERSION=1.12.5
ARG WRANGLER_VERSION=4.123.0

# gh(公式リポジトリ: cli.github.com/packages)、OpenTofu(公式リポジトリ: packages.opentofu.org)をAPTで取得する。
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && mkdir -p -m 755 /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
  && curl -fsSL https://get.opentofu.org/opentofu.gpg -o /etc/apt/keyrings/opentofu.gpg \
  && curl -fsSL https://packages.opentofu.org/opentofu/tofu/gpgkey | gpg --no-tty --batch --dearmor -o /etc/apt/keyrings/opentofu-repo.gpg \
  && chmod a+r /etc/apt/keyrings/opentofu.gpg /etc/apt/keyrings/opentofu-repo.gpg \
  && echo "deb [signed-by=/etc/apt/keyrings/opentofu.gpg,/etc/apt/keyrings/opentofu-repo.gpg] https://packages.opentofu.org/opentofu/tofu/any/ any main" > /etc/apt/sources.list.d/opentofu.list \
  && apt-get update \
  && apt-get download "gh=${GH_VERSION}" "tofu=${TOFU_VERSION}" \
  && mkdir -p /out \
  && for f in gh_*.deb tofu_*.deb; do dpkg -x "$f" /out; done \
  && rm -f ./*.deb

# Wranglerを導入する。
# BUN_INSTALLを固定パスにすることで、実行ファイルへのシンボリックリンク(`/usr/local/bin`配下)の参照先を`/out`へのCOPY後も維持する。
ENV BUN_INSTALL=/opt/wrangler
RUN bun install -g "wrangler@${WRANGLER_VERSION}"

# BetterleaksとMailpitを導入する専用ビルドステージ。
# いずれもAPT・npmレジストリのいずれにも公式パッケージが存在しないため、公式GitHub Releasesのバイナリを直接取得する。
# bunを必要としないため、上記ステージとは別の軽量なベースイメージを使い、BuildKit上で並列にダウンロードできるようにする。
FROM debian:trixie-slim AS release-binaries-builder
ARG TARGETARCH
ARG BETTERLEAKS_VERSION=1.7.3
ARG MAILPIT_VERSION=1.30.7
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl

# Betterleaksはchecksums.txtによるSHA256検証付きで取得する。
RUN case "${TARGETARCH}" in \
  amd64) BL_ARCH=x64 ;; \
  arm64) BL_ARCH=arm64 ;; \
  *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
  esac \
  && cd /tmp \
  && curl -fsSLO "https://github.com/betterleaks/betterleaks/releases/download/v${BETTERLEAKS_VERSION}/betterleaks_${BETTERLEAKS_VERSION}_linux_${BL_ARCH}.tar.gz" \
  && curl -fsSL "https://github.com/betterleaks/betterleaks/releases/download/v${BETTERLEAKS_VERSION}/checksums.txt" -o checksums.txt \
  && grep " betterleaks_${BETTERLEAKS_VERSION}_linux_${BL_ARCH}.tar.gz\$" checksums.txt | sha256sum -c - \
  && mkdir -p /out/usr/local/bin \
  && tar -xzf "betterleaks_${BETTERLEAKS_VERSION}_linux_${BL_ARCH}.tar.gz" -C /out/usr/local/bin betterleaks

# Mailpitはチェックサムが非公開のため未検証で取得する。
RUN mkdir -p /out/usr/local/bin \
  && curl -fsSL "https://github.com/axllent/mailpit/releases/download/v${MAILPIT_VERSION}/mailpit-linux-${TARGETARCH}.tar.gz" -o /tmp/mailpit.tar.gz \
  && tar -xzf /tmp/mailpit.tar.gz -C /out/usr/local/bin mailpit

# 本番環境はCloudflare Workers(サーバーレス)で動くため、このイメージは開発専用でありデプロイしない。
FROM oven/bun:1.3.14-slim
ARG PLAYWRIGHT_VERSION=1.62.1

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

# gh・OpenTofuを導入する。各バイナリが標準的な`/usr`配下へ展開済みのため、PATH変更は不要。
COPY --from=tools-builder /out/ /

# Wranglerを導入する。bunのグローバルインストールはパッケージ本体を`/opt/wrangler`へ、実行ファイルへのシンボリックリンクを`/usr/local/bin`へ配置するため、両方をコピーする。
# `COPY`は単一ファイルを指定するとシンボリックリンクを実体化(参照先の内容へ展開)してしまうため、ディレクトリ単位でコピーしリンクを維持する。
COPY --from=tools-builder /opt/wrangler /opt/wrangler
COPY --from=tools-builder /usr/local/bin/ /usr/local/bin/

# Betterleaks・Mailpitを導入する。各バイナリが標準的な`/usr`配下へ展開済みのため、PATH変更は不要。
COPY --from=release-binaries-builder /out/ /

# Playwright・chrome-devtools MCPが起動するChromiumを導入する。
# ChromiumバイナリのOS側共有ライブラリ(libnss3等)はrootユーザーとして導入する。
# Chromium本体は`bun install`後に確定する`@playwright/test`の実バージョンに一致させる必要があるため、entrypoint.sh側でbunユーザーが導入する(不一致は`Executable doesn't exist`エラーの原因になる)。
# CHROMIUM_PATHはMCPサーバーへ実行ファイルを絶対パスで渡すための固定シンボリックリンク先。
# コンテナでは非特権ユーザー名前空間が無効でサンドボックスが起動できないため、.mcp.json側で--no-sandboxを渡す。
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
ENV CHROMIUM_PATH=/opt/ms-playwright-bin/chrome
RUN --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
  --mount=type=cache,target=/var/cache/apt,sharing=locked \
  bunx --bun "playwright@${PLAYWRIGHT_VERSION}" install-deps chromium \
  && mkdir -p ${PLAYWRIGHT_BROWSERS_PATH} /opt/ms-playwright-bin \
  && chown -R bun:bun ${PLAYWRIGHT_BROWSERS_PATH} /opt/ms-playwright-bin

# bunユーザーはsudo権限がなく自分でディレクトリを作れないため、rootのうちに作成してbun所有に変更しておく。
# Claude・Infisical・Cloudflareのログイン情報、Bunのグローバルインストールキャッシュ、及びClaude Code・RTKの実行ファイルを永続化し、コンテナ再作成時の再認証やMCPパッケージ再ダウンロード、コンテナ内でのツール更新の巻き戻りを不要にする。
ENV CLAUDE_CONFIG_DIR=/home/bun/.claude
RUN mkdir -p /home/bun/.claude \
  && chown -R bun:bun /home/bun/.claude \
  && mkdir -p /home/bun/.infisical \
  && chown -R bun:bun /home/bun/.infisical \
  && mkdir -p /home/bun/.wrangler \
  && chown -R bun:bun /home/bun/.wrangler \
  && mkdir -p /home/bun/.bun \
  && chown -R bun:bun /home/bun/.bun \
  && mkdir -p /home/bun/.local \
  && chown -R bun:bun /home/bun/.local

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

# Claude Code・RTKは`scripts/update-local.sh`により`/home/bun/.local`配下へ導入される。
# 導入先は名前付きボリュームで永続化されており、イメージの内容がコピーされるのはボリュームが空の初回マウント時のみであるため、ビルド時ではなくコンテナ起動時(CMD)にインストーラを実行することで、再作成後も含め毎回両ツールを最新版へ更新する。
ENV PATH="/home/bun/.local/bin:${PATH}"

# コンテナ起動時のセットアップ処理はスクリプトへ切り出す。
COPY scripts/update-local.sh /usr/local/bin/update-local.sh
COPY scripts/entrypoint.sh /usr/local/bin/entrypoint.sh

# 両スクリプトでエラーが発生しても、エラーメッセージ出力のみでコンテナ起動を継続する。
# entrypoint.shはtrapや常駐プロセスを持つため、`.`(source)で読み込む。別プロセスとして実行すると常駐プロセスがPID1(docker-init)の子であるbashの子でなくなり、スクリプト内のtrapもスクリプト終了時に失われるため、停止時にMailpitへSIGTERMを転送できなくなる。
# `sleep infinity`は「何もせず永遠に待ち続けるだけ」のコマンドで、これをバックグラウンドで動かし続けることでPID1のbashを終了させず、コンテナを生かし続ける(Mailpitが落ちてもコンテナは生存する)。
# `wait $!`は直前にバックグラウンド実行した`sleep infinity`の終了を待つ組み込みコマンドで、シグナル(SIGTERMなど)を受けると即座に中断されるため、コンテナ停止時にスクリプト内の`trap`をすぐ発火できる。
CMD ["bash", "-c", "/usr/local/bin/update-local.sh; . /usr/local/bin/entrypoint.sh; sleep infinity & wait $!"]

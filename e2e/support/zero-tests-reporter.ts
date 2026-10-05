import type { FullConfig, Reporter, Suite } from '@playwright/test/reporter';

interface TextOutput {
  write(text: string): unknown;
}

// Playwrightは設定ファイルに書いたオプションに自身の値を加えて渡すため、知らないキーを受け入れる
export interface ZeroTestsReporterOptions {
  readonly output?: TextOutput;
  readonly [key: string]: unknown;
}

const ZERO_TESTS_NOTICE = '実行対象のE2Eテストは0件です\n';

// Playwrightの標準のレポーターは`--pass-with-no-tests`で0件のとき何も表示しないため、0件であったことを表示する
export default class ZeroTestsReporter implements Reporter {
  private readonly output: TextOutput;

  constructor({ output = process.stdout }: ZeroTestsReporterOptions = {}) {
    this.output = output;
  }

  onBegin(_config: FullConfig, suite: Pick<Suite, 'allTests'>): void {
    if (suite.allTests().length === 0) {
      this.output.write(ZERO_TESTS_NOTICE);
    }
  }
}

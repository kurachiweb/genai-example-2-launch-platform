import { z } from 'zod';

// Zodはz.objectを作る時点でnew Functionを試し、CSPの下のブラウザでは例外を捕捉しても違反として報告される。試行を止めるのはスキーマを作る前のjitlessだけのため、Zodの値は必ずこのモジュールから読み込む
z.config({ jitless: true });

export { z };

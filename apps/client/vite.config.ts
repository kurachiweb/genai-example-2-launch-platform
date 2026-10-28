import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// api・eventのwrangler dev --persist-toと同じ保存先にし、D1・R2などのローカル状態を共有する
const LOCAL_STATE_PATH = '/workspace/.wrangler/state';

export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: 'ssr' },
      persistState: { path: LOCAL_STATE_PATH },
      // apiのwrangler devが既定の9229、eventが9230で固定しているため、同時に起動しても重ならない固定の値にする
      inspectorPort: 9231,
    }),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
});

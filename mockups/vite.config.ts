import { defineConfig } from 'vite';
import { devtools } from '@tanstack/devtools-vite';

import { tanstackStart } from '@tanstack/react-start/plugin/vite';

import viteReact from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const MOCKUPS_PORT = 48047;

// tanstackStart()はtsr.config.jsonを読み込むものの、プラグイン自身の既定値(semicolons: false)で上書きされてしまうため、routeTree.gen.tsをPrettierのsemi: trueに揃えるにはここでも明示する必要がある
const routerGeneratorOptions = { semicolons: true };

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart({ router: routerGeneratorOptions }),
    viteReact(),
  ],
  server: { port: MOCKUPS_PORT },
  preview: { port: MOCKUPS_PORT },
});

export default config;

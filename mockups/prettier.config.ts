import type { Config } from 'prettier';

const config: Config = {
  singleQuote: true,
  plugins: ['prettier-plugin-tailwindcss'],
  tailwindStylesheet: './src/styles.css',
};

export default config;

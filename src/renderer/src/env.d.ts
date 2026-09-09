/// <reference types="vite/client" />

import type { GptbApi } from '@shared/ipc';

declare global {
  interface Window {
    prism: GptbApi;
    gptb: GptbApi;
  }
}

export {};

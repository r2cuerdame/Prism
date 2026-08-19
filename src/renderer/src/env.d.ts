/// <reference types="vite/client" />

import type { GptbApi } from '@shared/ipc';

declare global {
  interface Window {
    gptb: GptbApi;
  }
}

export {};

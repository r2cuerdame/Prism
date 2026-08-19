import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type GenerateProgress,
  type GptbApi,
  type UpdaterStatus
} from '@shared/ipc';

function subscribe<T>(channel: string) {
  return (cb: (payload: T) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

const api: GptbApi = {
  generate: (req) => ipcRenderer.invoke(IPC.generate, req),
  regenerateBlock: (req) => ipcRenderer.invoke(IPC.regenerateBlock, req),
  interpretEdit: (req) => ipcRenderer.invoke(IPC.interpretEdit, req),
  recipesList: () => ipcRenderer.invoke(IPC.recipesList),
  recipesSave: (recipe) => ipcRenderer.invoke(IPC.recipesSave, recipe),
  recipesRemove: (id) => ipcRenderer.invoke(IPC.recipesRemove, id),
  prefsList: () => ipcRenderer.invoke(IPC.prefsList),
  prefsRecord: (signals) => ipcRenderer.invoke(IPC.prefsRecord, signals),
  prefsClear: (id) => ipcRenderer.invoke(IPC.prefsClear, id),
  sessionsSaveSnapshot: (snapshot) => ipcRenderer.invoke(IPC.sessionsSaveSnapshot, snapshot),
  sessionsList: () => ipcRenderer.invoke(IPC.sessionsList),
  sessionsLoad: (sessionId) => ipcRenderer.invoke(IPC.sessionsLoad, sessionId),
  settingsGet: () => ipcRenderer.invoke(IPC.settingsGet),
  settingsSet: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
  updaterCheck: () => ipcRenderer.invoke(IPC.updaterCheck),
  updaterInstall: () => ipcRenderer.invoke(IPC.updaterInstall),
  openOriginal: (url) => ipcRenderer.invoke(IPC.openOriginal, url),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  onGenerateProgress: subscribe<GenerateProgress>(IPC.evGenerateProgress),
  onUpdaterStatus: subscribe<UpdaterStatus>(IPC.evUpdaterStatus)
};

contextBridge.exposeInMainWorld('gptb', api);

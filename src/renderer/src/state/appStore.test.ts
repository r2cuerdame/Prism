import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreferenceSignal } from '@shared/domain/preference';
import { AppStore } from './appStore';

describe('AppStore preference synchronization', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('refreshes renderer preference state after inferred signals are recorded', async () => {
    const recorded: PreferenceSignal[] = [];
    const prefsRecord = vi.fn(async (signals: PreferenceSignal[]) => {
      recorded.push(...signals);
    });
    const prefsList = vi.fn(async () => [...recorded]);
    vi.stubGlobal('window', { gptb: { prefsRecord, prefsList } });

    const store = new AppStore();
    store.newSession();
    store.dispatch({ type: 'adjust_mix', kind: 'article', direction: 'less' });
    await vi.waitFor(() => expect(store.get().prefSignals).toHaveLength(1));

    expect(prefsRecord).toHaveBeenCalledOnce();
    expect(prefsList).toHaveBeenCalledOnce();
    expect(store.get().prefSignals).toEqual(recorded);
    expect(store.get().prefSignals[0]?.target).toEqual({ type: 'kind', value: 'article' });
  });

  it('serializes rapid preference writes so no inferred signals are lost', async () => {
    const recorded: PreferenceSignal[] = [];
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const prefsRecord = vi
      .fn<(signals: PreferenceSignal[]) => Promise<void>>()
      .mockImplementationOnce(async (signals) => {
        recorded.push(...signals);
        await firstPending;
      })
      .mockImplementationOnce(async (signals) => {
        recorded.push(...signals);
      });
    const prefsList = vi.fn(async () => [...recorded]);
    vi.stubGlobal('window', { gptb: { prefsRecord, prefsList } });

    const store = new AppStore();
    store.newSession();
    store.dispatch({ type: 'adjust_mix', kind: 'article', direction: 'less' });
    store.dispatch({ type: 'adjust_mix', kind: 'video', direction: 'more' });

    await vi.waitFor(() => expect(prefsRecord).toHaveBeenCalledOnce());
    releaseFirst();
    await vi.waitFor(() => expect(prefsRecord).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(store.get().prefSignals).toHaveLength(2));
    expect(store.get().prefSignals.map((signal) => signal.target.value)).toEqual([
      'article',
      'video'
    ]);
  });

  it('logs recording failures and leaves renderer preference state unchanged', async () => {
    const error = new Error('disk unavailable');
    const prefsRecord = vi.fn().mockRejectedValue(error);
    const prefsList = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('window', { gptb: { prefsRecord, prefsList } });

    const store = new AppStore();
    store.newSession();
    store.dispatch({ type: 'adjust_mix', kind: 'video', direction: 'more' });
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith('Failed to record inferred preference signals.', error)
    );

    expect(prefsList).not.toHaveBeenCalled();
    expect(store.get().prefSignals).toEqual([]);
  });
});

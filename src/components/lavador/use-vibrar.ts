'use client';

import { useCallback } from 'react';

/** Vibração curta (sucesso, 30 ms) ou longa (conflito, 120 ms); sem a API (iPhone/Safari) não faz nada. */
export function useVibrar(): (ms?: number) => void {
  return useCallback((ms = 30) => {
    if ('vibrate' in navigator) navigator.vibrate(ms);
  }, []);
}

/** Regras puras do login PIN (spec §3: 4 a 6 dígitos, bloqueio após 5 erros). PIN é string para preservar zeros. */
export const PIN_MAX_ERROS = 5;
export const PIN_BLOQUEIO_MS = 15 * 60 * 1000;

export const isValidPin = (pin: string): boolean => /^[0-9]{4,6}$/.test(pin);

export const normalizeUsername = (value: string): string => value.trim().toLowerCase();

/** Espera o valor já normalizado. */
export const isValidUsername = (value: string): boolean => /^[a-z0-9_.]{3,30}$/.test(value);

export const isPinBlocked = (blockedUntil: Date | null, now: Date): boolean => blockedUntil !== null && blockedUntil > now;

export function nextPinFailure(failed: number, now: Date): { failed: number; blockedUntil: Date | null } {
  const total = failed + 1;
  return { failed: total, blockedUntil: total >= PIN_MAX_ERROS ? new Date(now.getTime() + PIN_BLOQUEIO_MS) : null };
}

import { describe, expect, it } from 'vitest';
import { isPinBlocked, isValidPin, isValidUsername, nextPinFailure, normalizeUsername } from '@/lib/auth/pin.rules';

const QUINZE_MIN = 15 * 60 * 1000;

describe('isValidPin', () => {
  it('aceita 4 a 6 dígitos, preservando zeros à esquerda', () => {
    expect(isValidPin('0123')).toBe(true);
    expect(isValidPin('123456')).toBe(true);
    expect(isValidPin('00000')).toBe(true);
  });

  it.each(['123', '1234567', '12a4', '', ' 1234', '1234 ', '１２３４', '12.4', '-123'])('recusa %j', (pin) => {
    expect(isValidPin(pin)).toBe(false);
  });
});

describe('usuário', () => {
  it('normaliza com trim e minúsculas', () => {
    expect(normalizeUsername('  Joao.Silva_1 ')).toBe('joao.silva_1');
  });

  it.each(['abc', 'a'.repeat(30), 'joao.silva_1'])('aceita %j', (u) => expect(isValidUsername(u)).toBe(true));
  it.each(['ab', 'a'.repeat(31), 'joão', 'jo ao', 'jo-ao', 'Joao', ''])('recusa %j', (u) => expect(isValidUsername(u)).toBe(false));
});

describe('bloqueio', () => {
  const now = new Date('2026-10-12T12:00:00.000Z');

  it('quarto erro ainda não bloqueia', () => {
    expect(nextPinFailure(3, now)).toEqual({ failed: 4, blockedUntil: null });
  });

  it('quinto erro bloqueia até now + 15 minutos', () => {
    expect(nextPinFailure(4, now)).toEqual({ failed: 5, blockedUntil: new Date(now.getTime() + QUINZE_MIN) });
  });

  it('bloqueio vale até o instante exato do fim', () => {
    const ate = new Date(now.getTime() + QUINZE_MIN);
    expect(isPinBlocked(null, now)).toBe(false);
    expect(isPinBlocked(ate, new Date(ate.getTime() - 1))).toBe(true);
    expect(isPinBlocked(ate, ate)).toBe(false);
  });
});

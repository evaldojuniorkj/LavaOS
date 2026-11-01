import { describe, expect, it } from 'vitest';
import { criarLimitador } from '@/lib/rate-limit';

describe('limitar', () => {
  it('rate limit bloqueia na 31ª requisição por IP/minuto', () => {
    const limitar = criarLimitador();
    for (let i = 0; i < 30; i++) expect(limitar('ip:1', 30, 60_000, 1000 + i)).toBe(true);
    expect(limitar('ip:1', 30, 60_000, 1100)).toBe(false);
    expect(limitar('ip:2', 30, 60_000, 1100)).toBe(true); // outra chave tem a própria cota
  });

  it('a janela vence e a cota volta', () => {
    const limitar = criarLimitador();
    expect(limitar('k', 1, 60_000, 0)).toBe(true);
    expect(limitar('k', 1, 60_000, 59_999)).toBe(false);
    expect(limitar('k', 1, 60_000, 60_000)).toBe(true);
  });

  it('memória limitada: chaves vencidas saem antes, e no teto a mais antiga é descartada', () => {
    const limitar = criarLimitador(3);
    limitar('a', 1, 1000, 0);
    limitar('b', 1, 5000, 0);
    limitar('c', 1, 5000, 0);
    expect(limitar('d', 1, 5000, 2000)).toBe(true); // 'a' venceu e saiu; 'b' e 'c' continuam
    expect(limitar('b', 1, 5000, 2000)).toBe(false);
    expect(limitar('e', 1, 5000, 2000)).toBe(true); // teto sem vencidas: descarta a mais antiga ('b')
    expect(limitar('c', 1, 5000, 2000)).toBe(false);
    expect(limitar('b', 1, 5000, 2000)).toBe(true); // 'b' foi descartada: recomeça
  });
});

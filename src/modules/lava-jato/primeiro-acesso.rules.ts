import { createHash, timingSafeEqual } from 'node:crypto';

const sha256 = (s: string) => createHash('sha256').update(s).digest();

/** Compara o código de instalação em tempo constante: os hashes têm o mesmo tamanho, então nem o comprimento vaza. */
export const codigoConfere = (digitado: string, esperado: string): boolean => timingSafeEqual(sha256(digitado), sha256(esperado));

import 'server-only';
import { hashPassword, verifyPassword } from 'better-auth/crypto';

// Mesmo hasher (scrypt) que o Better Auth usa para senhas; sem algoritmo próprio.
export const hashSecret = (secret: string): Promise<string> => hashPassword(secret);
export const verifySecret = (secret: string, hash: string): Promise<boolean> => verifyPassword({ hash, password: secret });

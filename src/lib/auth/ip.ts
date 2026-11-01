import { getIP } from 'better-auth/api';

// IP do cliente (limite PIN por origem e rate limit) só de X-Real-IP. Exige do proxy reverso: sobrescrever X-Real-IP
// com o endereço do socket (nginx: proxy_set_header X-Real-IP $remote_addr) e o app ouvir só nele (loopback).
// X-Forwarded-For não é lido: o cliente pode forjá-lo. Sem o header, produção fica sem IP (cota compartilhada).
// Sem `server-only`: o proxy também usa.
export const IP_ADDRESS = { ipAddressHeaders: ['x-real-ip'] };

/** Mesma extração do Better Auth (advanced.ipAddress) para as rotas fora dele. */
export const ipDoCliente = (headers: Headers): string => getIP(headers, { advanced: { ipAddress: IP_ADDRESS } }) ?? 'desconhecido';

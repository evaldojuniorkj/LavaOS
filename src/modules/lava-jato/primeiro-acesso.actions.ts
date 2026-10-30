'use server';

import { headers } from 'next/headers';
import { ipDoCliente } from '@/lib/auth/ip';
import { getServerEnv } from '@/lib/env';
import type { ActionResult } from '@/modules/equipe/equipe.actions';
import { primeiroAcesso } from './primeiro-acesso.service';

/** Pública: autoriza pelo código de instalação + sistema vazio (ver primeiroAcesso), não por requirePermission. */
export async function primeiroAcessoAction(input: unknown): Promise<ActionResult<null>> {
  return primeiroAcesso(input, { token: getServerEnv().LAVAOS_SETUP_TOKEN, ip: ipDoCliente(await headers()) });
}

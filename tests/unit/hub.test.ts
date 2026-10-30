import { describe, expect, it, vi } from 'vitest';
import { hub, type Mensagem } from '@/lib/realtime/hub';

const A = 'tenant-a';
const B = 'tenant-b';

describe('hub', () => {
  it('hub entrega só ao tenant correspondente', () => {
    const a: Mensagem[] = [];
    const b: Mensagem[] = [];
    const soOs1: Mensagem[] = [];
    const cancelar = [hub.assinar({ tenantId: A }, (e) => a.push(e)), hub.assinar({ tenantId: B }, (e) => b.push(e)), hub.assinar({ tenantId: A, osId: 'os-1' }, (e) => soOs1.push(e))];
    hub.emitir({ tenantId: A, osId: 'os-1', tipo: 'status' });
    hub.emitir({ tenantId: A, osId: 'os-2', tipo: 'valor' });
    hub.emitir({ tenantId: B, osId: 'os-1', tipo: 'itens' });
    hub.emitir({ tipo: 'resync' });
    expect(a).toEqual([{ tenantId: A, osId: 'os-1', tipo: 'status' }, { tenantId: A, osId: 'os-2', tipo: 'valor' }, { tipo: 'resync' }]);
    expect(b).toEqual([{ tenantId: B, osId: 'os-1', tipo: 'itens' }, { tipo: 'resync' }]);
    expect(soOs1).toEqual([{ tenantId: A, osId: 'os-1', tipo: 'status' }, { tipo: 'resync' }]);
    cancelar.forEach((c) => c());
  });

  it('cancelar assinatura para de entregar', () => {
    const recebidos: Mensagem[] = [];
    const cancelar = hub.assinar({ tenantId: A }, (e) => recebidos.push(e));
    hub.emitir({ tenantId: A, osId: 'os-1', tipo: 'status' });
    cancelar();
    hub.emitir({ tenantId: A, osId: 'os-1', tipo: 'responsavel' });
    expect(recebidos).toEqual([{ tenantId: A, osId: 'os-1', tipo: 'status' }]);
  });

  it('assinante que lança não impede a entrega aos demais', () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const recebidos: Mensagem[] = [];
    const cancelar = [
      hub.assinar({ tenantId: A }, () => {
        throw new Error('stream fechado');
      }),
      hub.assinar({ tenantId: A }, (e) => recebidos.push(e)),
    ];
    hub.emitir({ tenantId: A, osId: 'os-1', tipo: 'status' });
    expect(recebidos).toHaveLength(1);
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
    cancelar.forEach((c) => c());
  });
});

import { describe, expect, it } from 'vitest';
import { formatarReais, linkWhatsapp, mensagemEntrada, mensagemPronto } from '@/modules/clientes/whatsapp.rules';

describe('linkWhatsapp', () => {
  it('três formatos do mesmo número geram o mesmo link', () => {
    const links = ['(11) 98888-7777', '11988887777', '+5511988887777'].map((t) => linkWhatsapp(t, 'oi'));
    expect(links[0]).toBe('https://wa.me/5511988887777?text=oi');
    expect(new Set(links).size).toBe(1);
  });
  it("'123' retorna null", () => {
    expect(linkWhatsapp('123', 'oi')).toBeNull();
    expect(linkWhatsapp('', 'oi')).toBeNull();
  });
  it('mensagem é codificada (acentos, &, #, ? e quebra de linha)', () => {
    const msg = 'Olá São José & Cia #1?\nok 🚗';
    const url = new URL(linkWhatsapp('11988887777', msg)!);
    expect(url.host + url.pathname).toBe('wa.me/5511988887777');
    expect(url.search).not.toMatch(/[&#\s]|%0A.*\n/);
    expect(url.search).toContain('%26');
    expect(url.search).toContain('%23');
    expect(url.search).toContain('%3F');
    expect(url.search).toContain('%0A');
    expect(url.searchParams.get('text')).toBe(msg);
  });
});

describe('mensagens', () => {
  it('entrada traz lava jato, veículo, placa e link', () => {
    const m = mensagemEntrada({ lavaJato: 'Lava X', modelo: 'Gol', placa: 'ABC1D23', urlAcompanhar: 'https://x.com/acompanhar/tok' });
    expect(m).toContain('Lava X');
    expect(m).toContain('Gol (ABC1D23)');
    expect(m).toContain('https://x.com/acompanhar/tok');
  });
  it('pronto traz veículo e total; sem modelo usa só a placa', () => {
    const m = mensagemPronto({ lavaJato: 'Lava X', modelo: null, placa: 'ABC1D23', totalCentavos: 123456 });
    expect(m).toContain('ABC1D23');
    expect(m).not.toContain('(');
    expect(m).toContain('R$ 1.234,56');
  });
  it.each([[0, 'R$ 0,00'], [5, 'R$ 0,05'], [5000, 'R$ 50,00'], [100000, 'R$ 1.000,00'], [123456789, 'R$ 1.234.567,89']])('formatarReais(%i)', (c, t) => {
    expect(formatarReais(c)).toBe(t);
  });
});

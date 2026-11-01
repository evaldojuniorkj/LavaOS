import type { StatusOs } from '@/modules/ordens/ordens.rules';

/** Fundo levemente tingido e sombra na cor do status (amarelo aguardando, azul em lavagem, verde pronto); o texto do status continua sendo quem informa. */
const TINTA: Partial<Record<StatusOs, string>> = {
  aguardando: 'bg-[#fffaf0] shadow-[0_1px_2px_rgb(242_183_5/0.25),0_6px_18px_rgb(242_183_5/0.22)]',
  em_lavagem: 'bg-[#f2f9fd] shadow-[0_1px_2px_rgb(10_110_160/0.18),0_6px_18px_rgb(10_110_160/0.2)]',
  pronto: 'bg-[#f1faf6] shadow-[0_1px_2px_rgb(18_121_90/0.18),0_6px_18px_rgb(18_121_90/0.2)]',
};

export const tintaDoStatus = (status: StatusOs): string => TINTA[status] ?? 'bg-white shadow-cartao';

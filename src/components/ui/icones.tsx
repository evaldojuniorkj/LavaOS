/** Ícones de traço (24×24) para as barras de navegação; decorativos, o rótulo vem do texto ao lado. */
const base = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const IconeFila = () => (
  <svg {...base}>
    <path d="M8 6h12M8 12h12M8 18h12" />
    <circle cx="4" cy="6" r="1" />
    <circle cx="4" cy="12" r="1" />
    <circle cx="4" cy="18" r="1" />
  </svg>
);
export const IconeNova = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);
export const IconeClientes = () => (
  <svg {...base}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
    <path d="M16 4.7a3.5 3.5 0 0 1 0 6.6M18 14.8c1.9.7 3.1 2.4 3.5 5.2" />
  </svg>
);
export const IconeEquipe = () => (
  <svg {...base}>
    <rect x="4" y="3" width="16" height="18" rx="3" />
    <circle cx="12" cy="10" r="2.5" />
    <path d="M8 17c.5-2 2-3 4-3s3.5 1 4 3" />
  </svg>
);
export const IconeCatalogo = () => (
  <svg {...base}>
    <path d="M3 12.2V4.5A1.5 1.5 0 0 1 4.5 3h7.7a1.5 1.5 0 0 1 1.1.4l7.3 7.3a1.5 1.5 0 0 1 0 2.1l-7.6 7.6a1.5 1.5 0 0 1-2.1 0L3.4 13.3a1.5 1.5 0 0 1-.4-1.1z" />
    <circle cx="8" cy="8" r="1.2" />
  </svg>
);
export const IconePainel = () => (
  <svg {...base}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
  </svg>
);
export const IconeCaixa = () => (
  <svg {...base}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M6 9.5v5M18 9.5v5" />
  </svg>
);
export const IconeDespesas = () => (
  <svg {...base}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
    <path d="M9 8h6M9 12h6" />
  </svg>
);
export const IconeComissoes = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9" />
    <path d="M14.8 9.2c-.5-.9-1.6-1.4-2.8-1.4-1.6 0-2.8.9-2.8 2.1 0 2.8 5.8 1.4 5.8 4.2 0 1.2-1.3 2.1-3 2.1-1.3 0-2.4-.6-2.9-1.5M12 6v1.8M12 16.2V18" />
  </svg>
);
export const IconeMais = () => (
  <svg {...base}>
    <circle cx="5" cy="12" r="1.3" />
    <circle cx="12" cy="12" r="1.3" />
    <circle cx="19" cy="12" r="1.3" />
  </svg>
);

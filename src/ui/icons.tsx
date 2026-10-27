// Stroke icons from the design canvas. Decorative: the control around them carries the name.

import type { JSX } from 'preact';

const Svg = ({ children, size = 20 }: { children: JSX.Element | JSX.Element[]; size?: number }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    {children}
  </svg>
);

export const UndoIcon = () => (
  <Svg>
    <path d="M9 7 L4 12 L9 17 M4 12 h11 a5 5 0 0 1 0 10 h-2" />
  </Svg>
);

export const RedoIcon = () => (
  <Svg>
    <path d="M15 7 L20 12 L15 17 M20 12 h-11 a5 5 0 0 0 0 10 h2" />
  </Svg>
);

export const ListIcon = () => (
  <Svg>
    <path d="M5 6 h14 M5 12 h14 M5 18 h14" />
  </Svg>
);

export const WaveIcon = () => (
  <Svg>
    <path d="M3 12 h2 M7 8 v8 M11 5 v14 M15 9 v6 M19 11 v2" />
  </Svg>
);

export const MixIcon = () => (
  <Svg>
    <path d="M3 6 L21 18 M3 18 L21 6" />
  </Svg>
);

export const FolderIcon = () => (
  <Svg>
    <path d="M3 7 h7 l2 2 h9 v10 H3 Z" />
  </Svg>
);

export const SlidersIcon = () => (
  <Svg>
    <path d="M4 6 h10 M18 6 h2 M4 12 h4 M12 12 h8 M4 18 h12 M20 18 h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Svg>
);

export const CloseIcon = () => (
  <Svg>
    <path d="M6 6 L18 18 M18 6 L6 18" />
  </Svg>
);

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

export const DownloadIcon = () => (
  <Svg>
    <path d="M12 4 v11 M7 10 L12 15 L17 10 M5 20 h14" />
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

export const WarnIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M12 7 v6 M12 16.5 v0.3" />
  </Svg>
);

export const InfoIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M12 10.5 v6.5 M12 7.2 v0.3" />
  </Svg>
);

export const CloseIcon = () => (
  <Svg>
    <path d="M6 6 L18 18 M18 6 L6 18" />
  </Svg>
);

export const PlayIcon = () => (
  <Svg>
    <path d="M7 5 L19 12 L7 19 Z" />
  </Svg>
);

export const PauseIcon = () => (
  <Svg>
    <path d="M8 5 v14 M16 5 v14" />
  </Svg>
);

export const ZoomInIcon = () => (
  <Svg>
    <path d="M11 4 a7 7 0 1 0 0.01 0 M20 20 l-4 -4 M8 11 h6 M11 8 v6" />
  </Svg>
);

export const ZoomOutIcon = () => (
  <Svg>
    <path d="M11 4 a7 7 0 1 0 0.01 0 M20 20 l-4 -4 M8 11 h6" />
  </Svg>
);

export const FitIcon = () => (
  <Svg>
    <path d="M4 9 V4 h5 M15 4 h5 v5 M20 15 v5 h-5 M9 20 H4 v-5" />
  </Svg>
);

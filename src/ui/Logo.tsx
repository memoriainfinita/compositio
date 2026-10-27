// Logo «Encuentro»: two outlined circles, their meeting filled with the accent (spec, «Interfaz»).

export function Logo({ size = 26, muted = false }: { size?: number; muted?: boolean }) {
  return (
    <svg aria-hidden="true" class={muted ? 'logo logo-muted' : 'logo'} width={size} height={size} viewBox="0 0 100 100" fill="none">
      <circle cx="36" cy="50" r="28" stroke-width={muted ? 5 : 7} />
      <circle cx="64" cy="50" r="28" stroke-width={muted ? 5 : 7} />
      <path d="M50 25.7 A28 28 0 0 1 50 74.3 A28 28 0 0 1 50 25.7 Z" />
    </svg>
  );
}

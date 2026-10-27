// Popups, drawers and sheets on the native <dialog>: it keeps the focus inside, Esc closes it and
// the focus returns where it was.

import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
import { t } from '../i18n/index.ts';
import { CloseIcon } from './icons.tsx';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** popup: centred (full screen on phones); drawer: from the left; sheet: from the bottom. */
  variant?: 'popup' | 'drawer' | 'sheet';
  children: ComponentChildren;
}

export function Dialog({ open, onClose, title, variant = 'popup', children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      class={`dialog dialog-${variant}`}
      aria-labelledby={titleId}
      onClose={onClose}
      // A click on the backdrop lands on the dialog itself.
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div class="dialog-head">
        <h2 id={titleId} class="dialog-title">
          {title}
        </h2>
        <button type="button" class="icon-button" aria-label={t('dialog.close')} title={t('dialog.close')} onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <div class="dialog-body">{children}</div>
    </dialog>
  );
}

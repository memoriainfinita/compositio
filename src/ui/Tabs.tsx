// Tabs after the WAI-ARIA pattern: one tab in the Tab order, arrows, Home and End move and select.

import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';

export interface TabItem<T extends string> {
  id: T;
  label: ComponentChildren;
}

interface Props<T extends string> {
  label: string;
  idPrefix: string;
  tabs: readonly TabItem<T>[];
  selected: T;
  onSelect: (id: T) => void;
  children: ComponentChildren;
}

export function Tabs<T extends string>({ label, idPrefix, tabs, selected, onSelect, children }: Props<T>) {
  const list = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent) => {
    const i = tabs.findIndex((tab) => tab.id === selected);
    const last = tabs.length - 1;
    const next = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const tab = tabs[next];
    if (!tab) return;
    onSelect(tab.id);
    list.current?.querySelector<HTMLElement>(`#${idPrefix}-tab-${tab.id}`)?.focus();
  };

  return (
    <div class="tabs">
      <div ref={list} role="tablist" aria-label={label} class="tablist" onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tab.id}`}
            aria-selected={tab.id === selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={tab.id === selected ? 0 : -1}
            class="tab"
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${idPrefix}-panel`} aria-labelledby={`${idPrefix}-tab-${selected}`} tabIndex={0} class="tabpanel">
        {children}
      </div>
    </div>
  );
}

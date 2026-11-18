"use client";

import { CheckCircle2, X } from "lucide-react";
import { create } from "zustand";

interface ToastState {
  items: { id: number; text: string }[];
  push: (text: string) => void;
  drop: (id: number) => void;
}

let seq = 0;

export const useToast = create<ToastState>((set) => ({
  items: [],
  push: (text) => {
    const id = ++seq;
    set((s) => ({ items: [...s.items, { id, text }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), 5000);
  },
  drop: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

export function toast(text: string) {
  useToast.getState().push(text);
}

export function Toaster() {
  const { items, drop } = useToast();
  return (
    <div aria-live="polite" className="no-print fixed right-4 bottom-4 z-[60] flex flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} className="anim-fade flex max-w-sm items-start gap-2 rounded-xl bg-ink px-3.5 py-2.5 text-[13px] text-white shadow-lg">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[#7fd6a6]" aria-hidden />
          <span>{t.text}</span>
          <button onClick={() => drop(t.id)} aria-label="Dismiss" className="ml-1 text-white/70 hover:text-white">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

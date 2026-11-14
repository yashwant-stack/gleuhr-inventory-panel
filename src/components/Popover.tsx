"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/** A popup anchored to a button, rendered in a portal so no card or table can clip it. */
export function Popover({
  anchor,
  open,
  onClose,
  children,
  width,
  align = "start",
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  align?: "start" | "end";
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Position is written straight to the popup's style (no React state), on open and on scroll / resize.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchor.current;
      const el = ref.current;
      if (!a || !el) return;
      const r = a.getBoundingClientRect();
      const w = width ?? Math.max(r.width, 200);
      let left = align === "end" ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      el.style.top = `${r.bottom + 4}px`;
      el.style.left = `${left}px`;
      el.style.width = `${w}px`;
      el.style.maxHeight = `${Math.max(180, window.innerHeight - r.bottom - 12)}px`;
      el.style.visibility = "visible";
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, width, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchor]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      style={{ visibility: "hidden", top: 0, left: 0 }}
      className="anim-fade fixed z-50 overflow-auto rounded-xl border border-line bg-surface shadow-[0_8px_28px_rgba(28,27,25,0.14)] scroll-thin"
    >
      {children}
    </div>,
    document.body,
  );
}

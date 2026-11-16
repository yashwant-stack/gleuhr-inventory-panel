"use client";

// One hover / keyboard-focus tooltip for the whole panel. It explains any label it knows from the glossary
// (src/lib/glossary.ts): column headers, tiles, status chips, channel names, menu items and filters, plus an
// explicit `data-tip` on any element. Clickable rows say what a click does. A native `title` is shown the same
// way (disabled buttons get no hover events in browsers, so they keep the browser's own).
import { useEffect, useRef, useState } from "react";
import { describe } from "@/lib/glossary";

type Tip = { text: string; x: number; y: number; above: boolean };

const ROW_HINT = "Click for the full working of this row.";

function textOf(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

function find(target: Element): { el: Element; text: string } | null {
  // an explicit tip, or a native `title` (taken over, so the browser's own tooltip does not show as well)
  const explicit = target.closest("[data-tip], [title]");
  if (explicit) {
    const title = explicit.getAttribute("title");
    if (title) {
      explicit.setAttribute("data-tip", title);
      explicit.removeAttribute("title");
    }
    const text = explicit.getAttribute("data-tip") ?? "";
    if (text) return { el: explicit, text };
  }
  const nav = target.closest("nav a");
  if (nav) {
    const t = describe(textOf(nav).replace(/\s*\d+$/, ""), "nav");
    return t ? { el: nav, text: t } : null;
  }
  const btn = target.closest("button");
  if (btn) {
    const m = /^([^:]{2,24}):/.exec(textOf(btn));
    const t = m ? describe(m[1]!, "filter") : null;
    if (t) return { el: btn, text: t };
  }
  const th = target.closest("th");
  if (th) {
    const t = describe(textOf(th));
    return t ? { el: th, text: t } : null;
  }
  // a short label: the hovered element or one of its near parents
  let el: Element | null = target;
  for (let i = 0; el && i < 4; i++, el = el.parentElement) {
    const s = textOf(el);
    if (s.length > 40) break;
    const t = describe(s);
    if (t) return { el, text: t };
  }
  const row = target.closest("tr.clickable");
  return row ? { el: row, text: ROW_HINT } : null;
}

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const current = useRef<Element | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const hide = () => {
      if (timer.current) clearTimeout(timer.current);
      current.current = null;
      setTip(null);
    };
    const show = (target: EventTarget | null, delay: number) => {
      if (!(target instanceof Element)) return;
      const hit = find(target);
      if (!hit || !hit.text) return hide();
      if (hit.el === current.current) return;
      if (timer.current) clearTimeout(timer.current);
      current.current = hit.el;
      timer.current = setTimeout(() => {
        const r = hit.el.getBoundingClientRect();
        const above = r.bottom + 90 > window.innerHeight;
        const x = Math.min(Math.max(12, r.left + r.width / 2), window.innerWidth - 12);
        setTip({ text: hit.text, x, y: above ? r.top - 6 : r.bottom + 6, above });
      }, delay);
    };
    const over = (e: PointerEvent) => show(e.target, 350);
    const focus = (e: FocusEvent) => show(e.target, 0);
    const out = (e: PointerEvent) => {
      const to = e.relatedTarget;
      if (current.current && to instanceof Node && current.current.contains(to)) return;
      if (!(to instanceof Element) || find(to)?.el !== current.current) hide();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && hide();
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", hide);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", hide);
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[100] max-w-[300px] rounded-lg bg-ink px-2.5 py-1.5 text-[12px] leading-snug font-normal text-white shadow-lg"
      style={{ left: tip.x, top: tip.y, transform: `translate(-50%, ${tip.above ? "-100%" : "0"})` }}
    >
      {tip.text}
    </div>
  );
}

// Stands in for next/link in the one-file preview: same props the screens use, hash navigation.
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { hashFor, navigate } from "../router";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string; children?: ReactNode; prefetch?: boolean };

export default function Link({ href, onClick, children, prefetch: _prefetch, ...rest }: Props) {
  const path = href.split("?")[0] || "/";
  return (
    <a
      {...rest}
      href={`#${hashFor(path)}`}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}

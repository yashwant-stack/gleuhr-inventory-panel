// The preview page host blocks downloads, and the preview shows every export button switched off
// with the reason. So the preview build leaves the real download code (src/lib/csv.ts) out.
export function downloadCsv(_filename: string, _header: string[], _rows: (string | number)[][]): void {
  // Not reachable in the preview: the buttons that call this are disabled there.
}

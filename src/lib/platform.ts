// Where the panel is running. The full app (Next.js) can download files and print.
// The one-file preview published on claude.ai runs in a locked-down frame that blocks
// downloads and the print dialog, so those buttons are shown switched off there, with the reason.

export const IS_PREVIEW =
  typeof window !== "undefined" && (window as Window & { __GLEUHR_PREVIEW__?: boolean }).__GLEUHR_PREVIEW__ === true;

export const PREVIEW_NO_DOWNLOAD = "Downloads work in the full app. This preview link can’t save files.";
export const PREVIEW_NO_PRINT = "Download PDF works in the full app. This preview link can’t open the print dialog.";

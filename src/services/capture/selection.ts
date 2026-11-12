import type { CaptureNoticeCode } from '../../types';

const BLOCKED_PREFIXES = [
  'chrome:',
  'chrome-extension:',
  'edge:',
  'about:',
  'devtools:',
  'view-source:',
  'chrome-search:',
  'chrome-untrusted:',
];

const CAPTURE_HINT =
  'Select text on a regular web page, then right-click it and choose Save Selection to ClipCanvas.';

export function captureNoticeForUrl(
  url: string | null | undefined,
): { code: CaptureNoticeCode; message: string } | null {
  if (!url) {
    return {
      code: 'no-active-tab',
      message: `ClipCanvas could not find an active web page. ${CAPTURE_HINT}`,
    };
  }
  const lower = url.toLocaleLowerCase('en-US');
  if (
    lower.startsWith('https://chrome.google.com/webstore') ||
    lower.startsWith('https://chromewebstore.google.com')
  ) {
    return {
      code: 'restricted-page',
      message: `Chrome blocks extensions from reading text on the Chrome Web Store. ${CAPTURE_HINT}`,
    };
  }
  if (BLOCKED_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return {
      code: 'restricted-page',
      message: `Chrome does not allow extensions to read text on browser pages like this one. ${CAPTURE_HINT}`,
    };
  }
  return null;
}

export function injectionBlockedNotice(): { code: CaptureNoticeCode; message: string } {
  return {
    code: 'injection-blocked',
    message:
      'ClipCanvas could not read the selection on this page. Some PDFs, protected pages, and embedded viewers block extensions. Copy the text and create a note manually, or try another page.',
  };
}

export function emptySelectionNotice(): { code: CaptureNoticeCode; message: string } {
  return {
    code: 'empty-selection',
    message: `No text was selected. ${CAPTURE_HINT}`,
  };
}

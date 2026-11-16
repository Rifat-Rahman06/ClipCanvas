import type { CaptureOutcome } from '../../types';

export const CAPTURE_INSERT = 'clipcanvas:capture-insert';

/**
 * The content-script read request. The message name carries the serializer
 * version, so a page that still runs a content script from an older build
 * cannot answer a newer request. The service worker then injects `content.js`
 * and asks again, which upgrades the page without requiring a refresh.
 */
export const CAPTURE_READ_MESSAGE = 'clipcanvas:read-selection.v3';

/**
 * Bumped whenever the content-script selection serializer changes. The service
 * worker treats a response from an older version as unavailable, so a page
 * running a stale content script does not silently produce the old output.
 */
export const CAPTURE_SELECTION_VERSION = 3;

export interface CaptureInsertMessage {
  type: typeof CAPTURE_INSERT;
}

export interface CaptureInsertResponse {
  outcome: CaptureOutcome | null;
}

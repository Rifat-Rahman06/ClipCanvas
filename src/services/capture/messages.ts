import type { CaptureOutcome } from '../../types';

export const CAPTURE_INSERT = 'clipcanvas:capture-insert';

export interface CaptureInsertMessage {
  type: typeof CAPTURE_INSERT;
}

export interface CaptureInsertResponse {
  outcome: CaptureOutcome | null;
}

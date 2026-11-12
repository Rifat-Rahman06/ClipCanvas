import type { Attachment, AttachmentRecord, BackupAttachment } from '../../types';
import { createId, nowIso } from '../../lib/utils';
import { getDb } from './database';

const objectUrls = new Map<string, string>();

export async function createAttachment(input: {
  noteId: string;
  projectId: string;
  blob: Blob;
  width: number;
  height: number;
  mimeType?: string;
}): Promise<Attachment> {
  const db = await getDb();
  const record: AttachmentRecord = {
    id: createId(),
    noteId: input.noteId,
    projectId: input.projectId,
    mimeType: input.mimeType || input.blob.type || 'image/webp',
    width: Math.max(1, Math.round(input.width)),
    height: Math.max(1, Math.round(input.height)),
    byteSize: input.blob.size,
    createdAt: nowIso(),
    blob: input.blob,
  };
  await db.put('attachments', record);
  return withoutBlob(record);
}

export async function getAttachment(id: string): Promise<AttachmentRecord | undefined> {
  const db = await getDb();
  return db.get('attachments', id);
}

export async function getAttachmentUrl(id: string): Promise<string | null> {
  const cached = objectUrls.get(id);
  if (cached) return cached;
  const record = await getAttachment(id);
  if (!record) return null;
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  const url = URL.createObjectURL(record.blob);
  objectUrls.set(id, url);
  return url;
}

export async function getAttachmentsForNote(noteId: string): Promise<Attachment[]> {
  const db = await getDb();
  const records = await db.getAllFromIndex('attachments', 'by-note', noteId);
  return records.map(withoutBlob);
}

export async function getBackupAttachments(): Promise<BackupAttachment[]> {
  const db = await getDb();
  const records = await db.getAll('attachments');
  const backups: BackupAttachment[] = [];
  for (const record of records) {
    backups.push({
      ...withoutBlob(record),
      dataBase64: await blobToBase64(record.blob),
    });
  }
  return backups;
}

export async function deleteAttachment(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('attachments', id);
  revokeAttachmentUrl(id);
}

export function revokeAttachmentUrl(id: string): void {
  const url = objectUrls.get(id);
  if (!url) return;
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url);
  }
  objectUrls.delete(id);
}

export function revokeAttachmentUrls(ids: readonly string[]): void {
  for (const id of ids) revokeAttachmentUrl(id);
}

export function revokeAllAttachmentUrls(): void {
  revokeAttachmentUrls([...objectUrls.keys()]);
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBlob(dataBase64: string, mimeType: string): Blob {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

function withoutBlob(record: AttachmentRecord): Attachment {
  const { blob: _blob, ...attachment } = record;
  return attachment;
}

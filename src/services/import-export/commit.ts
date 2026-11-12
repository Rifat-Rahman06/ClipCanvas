import type {
  AppSettings,
  AttachmentRecord,
  Canvas,
  ImportMode,
  ImportResult,
  Note,
  Project,
  ValidatedBackup,
} from '../../types';
import { SCHEMA_VERSION } from '../../types';
import { createId, nowIso } from '../../lib/utils';
import { getDb, SETTINGS_KEY } from '../db/database';
import { defaultNoteLayout } from '../db/repository';
import { base64ToBlob, revokeAllAttachmentUrls } from '../db/attachments';
import { normalizeSettings } from '../db/settings';

function uniqueId(seen: Set<string>): string {
  let id = createId();
  while (seen.has(id)) id = createId();
  seen.add(id);
  return id;
}

/**
 * Commits a fully validated backup inside one IndexedDB transaction. If any
 * request fails, IndexedDB rolls the transaction back and the notebook is left
 * exactly as it was.
 */
export async function commitImport(
  backup: ValidatedBackup,
  mode: ImportMode,
): Promise<ImportResult> {
  const db = await getDb();
  const tx = db.transaction(
    ['projects', 'canvases', 'notes', 'settings', 'attachments'],
    'readwrite',
  );
  const projectStore = tx.objectStore('projects');
  const canvasStore = tx.objectStore('canvases');
  const noteStore = tx.objectStore('notes');
  const settingsStore = tx.objectStore('settings');
  const attachmentStore = tx.objectStore('attachments');

  const [
    existingProjects,
    existingCanvases,
    existingNotes,
    currentSettingsRecord,
    existingAttachmentIds,
  ] = await Promise.all([
    projectStore.getAll(),
    canvasStore.getAll(),
    noteStore.getAll(),
    settingsStore.get(SETTINGS_KEY),
    attachmentStore.getAllKeys(),
  ]);
  const currentSettings = normalizeSettings(currentSettingsRecord);
  const timestamp = nowIso();

  if (mode === 'replace') {
    await Promise.all([
      projectStore.clear(),
      canvasStore.clear(),
      noteStore.clear(),
      attachmentStore.clear(),
    ]);
    for (const project of backup.data.projects) {
      await projectStore.put(project);
    }
    for (const canvas of backup.data.canvases) {
      await canvasStore.put(canvas);
    }
    const layoutCounts = new Map<string, number>();
    for (const note of backup.data.notes) {
      const index = layoutCounts.get(note.canvasId) ?? 0;
      layoutCounts.set(note.canvasId, index + 1);
      await noteStore.put({
        ...note,
        layout: note.layout ?? defaultNoteLayout(index),
      });
    }
    for (const attachment of backup.attachments) {
      const { dataBase64, ...metadata } = attachment;
      const record: AttachmentRecord = {
        ...metadata,
        blob: base64ToBlob(dataBase64, metadata.mimeType),
      };
      await attachmentStore.put(record);
    }
    const settings = normalizeSettings({
      ...currentSettings,
      ...backup.data.settings,
      schemaVersion: SCHEMA_VERSION,
      lastImportAt: timestamp,
    });
    await settingsStore.put(settings, SETTINGS_KEY);
    await tx.done;
    revokeAllAttachmentUrls();

    return {
      mode,
      projectsAdded: backup.data.projects.length,
      canvasesAdded: backup.data.canvases.length,
      notesAdded: backup.data.notes.length,
      projectIdsRemapped: 0,
      canvasIdsRemapped: 0,
      noteIdsRemapped: 0,
      replacedProjects: existingProjects.length,
      replacedCanvases: existingCanvases.length,
      replacedNotes: existingNotes.length,
    };
  }

  const existingProjectIds = new Set(existingProjects.map((project) => project.id));
  const existingCanvasIds = new Set(existingCanvases.map((canvas) => canvas.id));
  const existingNoteIds = new Set(existingNotes.map((note) => note.id));

  const projectIdMap = new Map<string, string>();
  const projectsToAdd: Project[] = [];
  let projectIdsRemapped = 0;

  for (const importedProject of backup.data.projects) {
    let id = importedProject.id;
    if (existingProjectIds.has(id)) {
      id = uniqueId(existingProjectIds);
      projectIdsRemapped += 1;
    } else {
      existingProjectIds.add(id);
    }
    projectsToAdd.push({ ...importedProject, id });
    projectIdMap.set(importedProject.id, id);
  }

  const canvasIdMap = new Map<string, string>();
  const canvasesToAdd: Canvas[] = [];
  let canvasIdsRemapped = 0;
  for (const importedCanvas of backup.data.canvases) {
    const projectId = projectIdMap.get(importedCanvas.projectId);
    if (!projectId) {
      throw new Error('Import integrity error: a canvas could not be attached to its project.');
    }
    let id = importedCanvas.id;
    if (existingCanvasIds.has(id)) {
      id = uniqueId(existingCanvasIds);
      canvasIdsRemapped += 1;
    } else {
      existingCanvasIds.add(id);
    }
    canvasesToAdd.push({ ...importedCanvas, id, projectId });
    canvasIdMap.set(importedCanvas.id, id);
  }

  const attachmentIds = new Set(existingAttachmentIds);
  const attachmentIdMap = new Map<string, string>();
  for (const attachment of backup.attachments) {
    const id = attachmentIds.has(attachment.id)
      ? uniqueId(attachmentIds)
      : attachment.id;
    attachmentIds.add(id);
    attachmentIdMap.set(attachment.id, id);
  }

  const notesToAdd: Note[] = [];
  const noteIdMap = new Map<string, string>();
  const layoutCounts = new Map<string, number>();
  for (const note of existingNotes) {
    layoutCounts.set(note.canvasId, (layoutCounts.get(note.canvasId) ?? 0) + 1);
  }
  let noteIdsRemapped = 0;

  for (const importedNote of backup.data.notes) {
    const projectId = projectIdMap.get(importedNote.projectId);
    const canvasId = canvasIdMap.get(importedNote.canvasId);
    if (!projectId || !canvasId) {
      throw new Error('Import integrity error: a note could not be attached to its canvas.');
    }
    let id = importedNote.id;
    if (existingNoteIds.has(id)) {
      id = uniqueId(existingNoteIds);
      noteIdsRemapped += 1;
    } else {
      existingNoteIds.add(id);
    }
    const layoutIndex = layoutCounts.get(canvasId) ?? 0;
    layoutCounts.set(canvasId, layoutIndex + 1);
    noteIdMap.set(importedNote.id, id);
    let contentHtml = importedNote.contentHtml ?? '';
    for (const [oldAttachmentId, newAttachmentId] of attachmentIdMap) {
      if (oldAttachmentId === newAttachmentId) continue;
      contentHtml = contentHtml
        .split(`data-attachment-id="${oldAttachmentId}"`)
        .join(`data-attachment-id="${newAttachmentId}"`);
    }
    notesToAdd.push({
      ...importedNote,
      id,
      projectId,
      canvasId,
      contentHtml,
      layout: importedNote.layout ?? defaultNoteLayout(layoutIndex),
    });
  }

  for (const attachment of backup.attachments) {
    const noteId = noteIdMap.get(attachment.noteId);
    const projectId = projectIdMap.get(attachment.projectId);
    const id = attachmentIdMap.get(attachment.id);
    if (!noteId || !projectId || !id) {
      throw new Error('Import integrity error: an image could not be attached to its note.');
    }
    const { dataBase64, ...metadata } = attachment;
    await attachmentStore.add({
      ...metadata,
      id,
      noteId,
      projectId,
      blob: base64ToBlob(dataBase64, metadata.mimeType),
    });
  }

  for (const project of projectsToAdd) {
    await projectStore.add(project);
  }
  for (const canvas of canvasesToAdd) {
    await canvasStore.add(canvas);
  }
  for (const note of notesToAdd) {
    await noteStore.add(note);
  }

  const settings: AppSettings = {
    ...currentSettings,
    schemaVersion: SCHEMA_VERSION,
    lastImportAt: timestamp,
  };
  await settingsStore.put(settings, SETTINGS_KEY);
  await tx.done;

  return {
    mode,
    projectsAdded: projectsToAdd.length,
    canvasesAdded: canvasesToAdd.length,
    notesAdded: notesToAdd.length,
    projectIdsRemapped,
    canvasIdsRemapped,
    noteIdsRemapped,
    replacedProjects: 0,
    replacedCanvases: 0,
    replacedNotes: 0,
  };
}

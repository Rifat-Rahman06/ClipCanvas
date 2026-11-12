import { describe, expect, it } from 'vitest';
import {
  BackupValidationError,
  analyzeImport,
  createBackup,
  parseBackupJson,
  serializeBackup,
  validateBackup,
} from '../src/services/import-export/backup';
import { makeDataset } from './fixtures';
describe('backup creation and validation', () => {
  it('round-trips a complete notebook including project, canvas, and note relationships', () => {
    const dataset = makeDataset();
    const backup = createBackup(dataset, '2026-10-27T12:00:00.000Z');
    const json = serializeBackup(backup);
    const parsed = parseBackupJson(json);

    expect(parsed.data.projects).toHaveLength(2);
    expect(parsed.data.canvases).toHaveLength(2);
    expect(parsed.data.notes).toHaveLength(2);
    expect(parsed.data.notes[0].title).toBe('Attention is all you need');
    expect(parsed.data.notes[0].canvasId).toBe('canvas-1');
    expect(parsed.data.notes[0].projectId).toBe('project-1');
    expect(parsed.data.canvases[0].name).toBe('Literature map');
  });

  it('carries image attachments and derives rich fields for legacy notes', () => {
    const dataset = makeDataset();
    const backup = createBackup(dataset, '2026-10-27T12:00:00.000Z', [
      {
        id: 'attachment-1',
        noteId: 'note-1',
        projectId: 'project-1',
        mimeType: 'image/png',
        width: 120,
        height: 80,
        byteSize: 3,
        createdAt: '2026-10-27T12:00:00.000Z',
        dataBase64: 'YWJj',
      },
    ]);
    const validated = parseBackupJson(serializeBackup(backup));

    expect(validated.attachments).toHaveLength(1);
    expect(validated.attachments[0]).toMatchObject({
      id: 'attachment-1',
      noteId: 'note-1',
      projectId: 'project-1',
    });
    expect(validated.data.notes[0].contentHtml).toContain(
      'A transformer architecture based entirely on attention.',
    );
    expect(validated.data.notes[0].contentText).toContain('transformer architecture');
    expect(validated.data.canvases[0].viewport).toMatchObject({ x: 0, y: 0, zoom: 1 });
  });

  it('rejects malformed JSON and foreign files', () => {
    expect(() => parseBackupJson('{oops')).toThrow(BackupValidationError);
    expect(() => validateBackup({ schemaVersion: 1 })).toThrow(/not a ClipCanvas/i);
  });

  it('rejects orphaned notes and canvases', () => {
    const raw = createBackup(makeDataset()) as unknown as Record<string, unknown>;
    const data = raw.data as Record<string, unknown>;
    const notes = data.notes as Array<Record<string, unknown>>;
    notes[0].projectId = 'missing-project';
    expect(() => validateBackup(raw)).toThrow(/project that is not in the backup/i);

    const backup = createBackup(makeDataset()) as unknown as Record<string, unknown>;
    const data2 = backup.data as Record<string, unknown>;
    const canvases = data2.canvases as Array<Record<string, unknown>>;
    canvases[0].projectId = 'missing-project';
    expect(() => validateBackup(backup)).toThrow(/project that is not in the backup/i);
  });

  it('ignores legacy source fields and rejects newer schemas', () => {
    const raw = createBackup(makeDataset()) as unknown as Record<string, unknown>;
    const data = raw.data as Record<string, unknown>;
    const notes = data.notes as Array<Record<string, unknown>>;
    notes[0].sourceUrl = 'https://example.com/legacy';
    notes[0].sourceTitle = 'Legacy source';
    notes[0].capturedAt = '2026-10-27T10:00:00.000Z';
    const parsed = validateBackup(raw);
    expect(parsed.data.notes[0]).not.toHaveProperty('sourceUrl');
    expect(parsed.data.notes[0]).not.toHaveProperty('capturedAt');

    const newer = createBackup(makeDataset()) as unknown as Record<string, unknown>;
    newer.schemaVersion = 99;
    expect(() => validateBackup(newer)).toThrow(/newer|supports up to/i);
  });

  it('adds a default canvas to legacy backups that do not have one', () => {
    const raw = createBackup(makeDataset()) as unknown as {
      data: {
        canvases?: Array<Record<string, unknown>>;
        notes: Array<Record<string, unknown>>;
      };
    };
    delete raw.data.canvases;
    for (const note of raw.data.notes) delete note.canvasId;
    const parsed = validateBackup(raw);
    expect(parsed.data.canvases).toHaveLength(2);
    for (const note of parsed.data.notes) {
      expect(note.canvasId).toBeTruthy();
      expect(
        parsed.data.canvases.some(
          (canvas) => canvas.id === note.canvasId && canvas.projectId === note.projectId,
        ),
      ).toBe(true);
    }
  });

  it('reports merge conflicts without touching data', () => {
    const current = makeDataset();
    const imported = makeDataset();
    imported.projects[0].id = 'new-project';
    imported.canvases[1].id = 'new-canvas';
    imported.notes[0].id = 'new-note';
    const analysis = analyzeImport(imported, current);
    expect(analysis.projects).toBe(2);
    expect(analysis.canvases).toBe(2);
    expect(analysis.notes).toBe(2);
    expect(analysis.projectIdConflicts).toBe(1);
    expect(analysis.canvasIdConflicts).toBe(1);
    expect(analysis.noteIdConflicts).toBe(1);
  });

  it('rejects backups that are too large before reading them', async () => {
    const hugeFile = {
      size: 80 * 1024 * 1024,
      text: async () => '',
    } as File;
    const { readBackupFile } = await import('../src/services/import-export/backup');
    await expect(readBackupFile(hugeFile)).rejects.toThrow(/larger than/i);
  });
});

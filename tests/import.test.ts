import { beforeEach, describe, expect, it } from 'vitest';
import { createNote, createProject, getDataset } from '../src/services/db/repository';
import { resetDatabaseForTests } from '../src/services/db/database';
import { commitImport } from '../src/services/import-export/commit';
import {
  createBackup,
  parseBackupJson,
  serializeBackup,
  validateBackup,
} from '../src/services/import-export/backup';
import { makeDataset } from './fixtures';
import type { ValidatedBackup } from '../src/types';

beforeEach(async () => {
  await resetDatabaseForTests();
});

describe('backup import', () => {
  it('restores a backup into an empty notebook with all relationships intact', async () => {
    const backup = parseBackupJson(serializeBackup(createBackup(makeDataset())));
    const result = await commitImport(backup, 'replace');
    expect(result.projectsAdded).toBe(2);
    expect(result.canvasesAdded).toBe(2);
    expect(result.notesAdded).toBe(2);

    const dataset = await getDataset();
    expect(dataset.projects.map((project) => project.name)).toEqual([
      'Literature Review',
      'Research Ideas',
    ]);
    const note = dataset.notes.find((item) => item.id === 'note-1');
    expect(note?.content).toBe('A transformer architecture based entirely on attention.');
    const canvas = dataset.canvases.find((item) => item.id === note?.canvasId);
    expect(canvas?.projectId).toBe('project-1');
    expect(canvas?.name).toBe('Literature map');
    expect(dataset.settings.lastImportAt).toBeTruthy();
  });

  it('merges without overwriting existing projects, canvases, or notes', async () => {
    const existingProject = await createProject({
      name: 'Existing project',
      description: 'Must survive',
    });
    const existingNote = await createNote({
      projectId: existingProject.id,
      title: 'Existing note',
      content: 'Existing content',
    });
    const initial = await getDataset();
    const existingCanvas = initial.canvases.find(
      (canvas) => canvas.projectId === existingProject.id,
    );
    expect(existingCanvas).toBeTruthy();

    const incoming = makeDataset();
    // Collide project, canvas, and note IDs with the existing notebook.
    incoming.projects[0].id = existingProject.id;
    incoming.projects[0].name = 'Imported project copy';
    incoming.canvases[0].id = existingCanvas!.id;
    incoming.canvases[0].projectId = existingProject.id;
    incoming.notes[0].id = existingNote.id;
    incoming.notes[0].projectId = existingProject.id;
    incoming.notes[0].canvasId = existingCanvas!.id;
    incoming.notes[0].title = 'Imported note copy';

    const backup: ValidatedBackup = {
      exportedAt: new Date().toISOString(),
      appVersion: '1.0.0',
      schemaVersion: 3,
      data: incoming,
      attachments: [],
    };
    const result = await commitImport(backup, 'merge');
    expect(result.projectsAdded).toBe(2);
    expect(result.canvasesAdded).toBe(2);
    expect(result.notesAdded).toBe(2);
    expect(result.projectIdsRemapped).toBe(1);
    expect(result.canvasIdsRemapped).toBe(1);
    expect(result.noteIdsRemapped).toBe(1);

    const dataset = await getDataset();
    expect(dataset.projects).toHaveLength(3);
    expect(dataset.canvases).toHaveLength(3);
    expect(dataset.notes).toHaveLength(3);
    const originalProject = dataset.projects.find((project) => project.id === existingProject.id);
    expect(originalProject?.name).toBe('Existing project');
    const originalNote = dataset.notes.find((note) => note.id === existingNote.id);
    expect(originalNote?.title).toBe('Existing note');

    // Every imported note points at a canvas that exists and belongs to its project.
    const canvasById = new Map(dataset.canvases.map((canvas) => [canvas.id, canvas]));
    for (const note of dataset.notes) {
      const canvas = canvasById.get(note.canvasId);
      expect(canvas).toBeTruthy();
      expect(canvas?.projectId).toBe(note.projectId);
    }
  });

  it('gives legacy backups without canvases a default canvas per project', async () => {
    const raw = createBackup(makeDataset()) as unknown as {
      data: {
        canvases?: Array<Record<string, unknown>>;
        notes: Array<Record<string, unknown>>;
      };
    };
    delete raw.data.canvases;
    for (const note of raw.data.notes) delete note.canvasId;
    const backup = validateBackup(raw);
    const result = await commitImport(backup, 'merge');
    expect(result.canvasesAdded).toBe(2);

    const dataset = await getDataset();
    expect(dataset.canvases).toHaveLength(2);
    for (const note of dataset.notes) {
      expect(
        dataset.canvases.some(
          (canvas) => canvas.id === note.canvasId && canvas.projectId === note.projectId,
        ),
      ).toBe(true);
    }
  });

  it('replace mode clears old content only after validation succeeds', async () => {
    const project = await createProject({ name: 'Old project' });
    await createNote({ projectId: project.id, title: 'Old note', content: 'old' });

    expect(() => parseBackupJson('{"format":"clipcanvas-research-notebook","schemaVersion":1,"data":{}}')).toThrow();
    const unchanged = await getDataset();
    expect(unchanged.projects[0].name).toBe('Old project');
    expect(unchanged.notes[0].title).toBe('Old note');

    const backup = parseBackupJson(serializeBackup(createBackup(makeDataset())));
    const result = await commitImport(backup, 'replace');
    expect(result.replacedProjects).toBe(1);
    expect(result.replacedCanvases).toBe(1);
    expect(result.replacedNotes).toBe(1);

    const dataset = await getDataset();
    expect(dataset.projects.map((item) => item.name)).toEqual([
      'Literature Review',
      'Research Ideas',
    ]);
    expect(dataset.notes.map((note) => note.title)).toEqual([
      'Attention is all you need',
      'Notes on evaluation',
    ]);
  });
});

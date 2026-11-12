import { beforeEach, describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import {
  createCanvas,
  createNote,
  createProject,
  createProjectWithNote,
  deleteCanvas,
  deleteNote,
  deleteProject,
  getDataset,
  getSettings,
  updateNote,
  updateNoteLayout,
  updateProject,
  updateSettings,
} from '../src/services/db/repository';
import { createAttachment, getAttachment } from '../src/services/db/attachments';
import {
  closeDatabaseForTests,
  DB_NAME,
  getDb,
  requestPersistentStorage,
  resetDatabaseForTests,
} from '../src/services/db/database';

beforeEach(async () => {
  await resetDatabaseForTests();
});

describe('notebook repository', () => {
  it('migrates legacy v1 records into the canvas and rich-text model', async () => {
    await resetDatabaseForTests();
    const legacy = await openDB(DB_NAME, 1, {
      upgrade(db) {
        const projects = db.createObjectStore('projects', { keyPath: 'id' });
        projects.createIndex('by-updated', 'updatedAt');
        const notes = db.createObjectStore('notes', { keyPath: 'id' });
        notes.createIndex('by-project', 'projectId');
        notes.createIndex('by-updated', 'updatedAt');
        const tags = db.createObjectStore('tags', { keyPath: 'id' });
        tags.createIndex('by-normalized-name', 'normalizedName', { unique: true });
        db.createObjectStore('settings');
      },
    });
    const timestamp = '2025-01-01T00:00:00.000Z';
    await legacy.put('projects', {
      id: 'legacy-project',
      name: 'Legacy project',
      description: '',
      tagIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await legacy.put('notes', {
      id: 'legacy-note',
      projectId: 'legacy-project',
      title: 'Old note',
      content: 'Legacy **markdown**',
      tagIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    legacy.close();

    const db = await getDb();
    const migrated = await db.get('notes', 'legacy-note');
    expect(migrated?.contentHtml).toContain('<strong>markdown</strong>');
    expect(migrated?.layout).toMatchObject({ width: 430, height: 340 });
    const canvas = await db.get('canvases', migrated?.canvasId ?? '');
    expect(canvas?.projectId).toBe('legacy-project');
    expect(canvas?.name).toBe('Main canvas');
  });

  it('creates projects with a default canvas and stores notes inside it', async () => {
    const project = await createProject({
      name: 'ML Research',
      description: 'Papers and ideas',
    });
    const note = await createNote({
      projectId: project.id,
      title: 'Retrieval augmented generation',
      content: 'A promising approach. See [[survey]].',
    });

    const dataset = await getDataset();
    expect(dataset.projects).toHaveLength(1);
    expect(dataset.canvases).toHaveLength(1);
    expect(dataset.notes).toHaveLength(1);
    expect(dataset.canvases[0].projectId).toBe(project.id);
    expect(dataset.notes[0].projectId).toBe(project.id);
    expect(dataset.notes[0].canvasId).toBe(dataset.canvases[0].id);
    expect(dataset.notes[0].title).toBe('Retrieval augmented generation');
    expect(note.canvasId).toBe(dataset.canvases[0].id);
  });

  it('supports multiple named canvases per project', async () => {
    const project = await createProject({ name: 'Book' });
    const canvas = await createCanvas({ projectId: project.id, name: 'Chapter 2 map' });
    const note = await createNote({
      projectId: project.id,
      canvasId: canvas.id,
      title: 'Chapter note',
      content: 'In the second canvas.',
    });
    const dataset = await getDataset();
    expect(dataset.canvases.map((item) => item.name).sort()).toEqual([
      'Chapter 2 map',
      'Main canvas',
    ]);
    expect(note.canvasId).toBe(canvas.id);
    expect(dataset.notes[0].canvasId).toBe(canvas.id);
  });

  it('keeps canvas image notes marked as images when their content changes', async () => {
    const project = await createProject({ name: 'Visual board' });
    const note = await createNote({
      projectId: project.id,
      title: '',
      kind: 'image',
      layout: { x: 120, y: 80, width: 348, height: 264, zIndex: 1 },
    });
    await updateNote(note.id, {
      contentHtml: '<img data-attachment-id="attachment-1" alt="Pasted image">',
      contentText: '',
      content: '',
    });
    const dataset = await getDataset();
    expect(dataset.notes[0].kind).toBe('image');
    expect(dataset.notes[0].contentHtml).toContain('data-attachment-id="attachment-1"');
  });

  it('creates a project, canvas, and first note atomically', async () => {
    const { project, canvas, note } = await createProjectWithNote(
      { name: 'PhD Opportunities' },
      {
        title: 'Supervisor notes',
        content: 'Follow up in November.',
      },
    );
    const dataset = await getDataset();
    expect(dataset.projects.map((item) => item.id)).toEqual([project.id]);
    expect(dataset.canvases.map((item) => item.id)).toEqual([canvas.id]);
    expect(dataset.notes[0].id).toBe(note.id);
    expect(dataset.notes[0].canvasId).toBe(canvas.id);
  });

  it('moves notes between projects and canvases and deletes projects with their notes only', async () => {
    const first = await createProject({ name: 'First' });
    const second = await createProject({ name: 'Second' });
    const secondCanvas = (await getDataset()).canvases.find(
      (canvas) => canvas.projectId === second.id,
    );
    const moved = await createNote({ projectId: first.id, title: 'Moved', content: 'x' });
    const doomed = await createNote({ projectId: first.id, title: 'Doomed', content: 'y' });
    const kept = await createNote({ projectId: second.id, title: 'Kept', content: 'z' });

    const updated = await updateNote(moved.id, { projectId: second.id });
    expect(updated.projectId).toBe(second.id);
    expect(updated.canvasId).toBe(secondCanvas?.id);

    const { deletedNoteIds } = await deleteProject(first.id);
    expect(deletedNoteIds).toEqual([doomed.id]);

    const dataset = await getDataset();
    expect(dataset.projects.map((project) => project.id)).toEqual([second.id]);
    expect(dataset.canvases.every((canvas) => canvas.projectId === second.id)).toBe(true);
    expect(dataset.notes.map((note) => note.id).sort()).toEqual([kept.id, moved.id].sort());
    expect(dataset.notes.find((note) => note.id === moved.id)?.projectId).toBe(second.id);
  });

  it('deletes a note without touching its project, canvas, or siblings', async () => {
    const project = await createProject({ name: 'Keep' });
    const one = await createNote({ projectId: project.id, title: 'One' });
    const two = await createNote({ projectId: project.id, title: 'Two' });
    await deleteNote(one.id);
    const dataset = await getDataset();
    expect(dataset.projects).toHaveLength(1);
    expect(dataset.canvases).toHaveLength(1);
    expect(dataset.notes.map((note) => note.id)).toEqual([two.id]);
  });

  it('deletes a canvas and its notes without touching sibling canvases', async () => {
    const project = await createProject({ name: 'Project' });
    const extra = await createCanvas({ projectId: project.id, name: 'Scratch' });
    const kept = await createNote({ projectId: project.id, title: 'Kept' });
    const doomed = await createNote({
      projectId: project.id,
      canvasId: extra.id,
      title: 'Doomed',
    });

    const result = await deleteCanvas(extra.id);
    expect(result.deletedNoteIds).toEqual([doomed.id]);

    const dataset = await getDataset();
    expect(dataset.canvases.map((canvas) => canvas.id)).not.toContain(extra.id);
    expect(dataset.notes.map((note) => note.id)).toEqual([kept.id]);
  });

  it('rejects invalid relationships', async () => {
    await expect(
      createNote({ projectId: 'missing', title: 'Orphan' }),
    ).rejects.toThrow(/project no longer exists/i);

    const first = await createProject({ name: 'First' });
    const second = await createProject({ name: 'Second' });
    const foreignCanvas = (await getDataset()).canvases.find(
      (canvas) => canvas.projectId === second.id,
    );
    await expect(
      createNote({
        projectId: first.id,
        canvasId: foreignCanvas?.id,
        title: 'Wrong canvas',
      }),
    ).rejects.toThrow(/not part of this project/i);
  });

  it('updates project metadata and enforces names', async () => {
    const project = await createProject({ name: 'Draft' });
    const updated = await updateProject(project.id, {
      name: 'Final project',
      description: 'A description',
    });
    expect(updated.name).toBe('Final project');
    expect(updated.description).toBe('A description');
    await expect(updateProject(project.id, { name: '   ' })).rejects.toThrow(/empty/i);
  });

  it('preserves data across database reconnects', async () => {
    const project = await createProject({ name: 'Persistent' });
    await createNote({ projectId: project.id, title: 'Survives' });
    const db = await getDb();
    db.close();
    await closeDatabaseForTests();
    const dataset = await getDataset();
    expect(dataset.projects[0].name).toBe('Persistent');
    expect(dataset.canvases[0].projectId).toBe(project.id);
    expect(dataset.notes[0].title).toBe('Survives');
  });

  it('defaults and clamps the editor text size setting', async () => {
    expect((await getSettings()).editorFontSize).toBe(16);

    await updateSettings({ editorFontSize: 99 });
    expect((await getSettings()).editorFontSize).toBe(22);

    await updateSettings({ editorFontSize: 5 });
    expect((await getSettings()).editorFontSize).toBe(13);

    await updateSettings({ editorFontSize: 18.6 });
    expect((await getSettings()).editorFontSize).toBe(19);
  });

  it('stores rich content, layouts, and cascades image attachments', async () => {
    const first = await createProject({ name: 'First' });
    const second = await createProject({ name: 'Second' });
    const note = await createNote({
      projectId: first.id,
      title: 'Rich note',
      content: 'A **legacy** note.',
    });
    expect(note.contentHtml).toContain('<strong>legacy</strong>');
    expect(note.layout).toMatchObject({ x: 48, y: 72, width: 430, height: 340 });

    const resized = await updateNoteLayout(note.id, {
      x: 120,
      y: 140,
      width: 500,
      height: 420,
      zIndex: 4,
      heightLocked: true,
    });
    expect(resized.layout).toMatchObject({
      x: 120,
      y: 140,
      width: 500,
      height: 420,
      heightLocked: true,
    });

    const attachment = await createAttachment({
      noteId: note.id,
      projectId: first.id,
      blob: new Blob(['image bytes'], { type: 'image/png' }),
      width: 12,
      height: 8,
    });
    expect((await getAttachment(attachment.id))?.blob.size).toBe(11);

    const moved = await updateNote(note.id, { projectId: second.id });
    expect(moved.layout).toMatchObject({ x: 48, y: 72, zIndex: 1 });
    expect((await getAttachment(attachment.id))?.projectId).toBe(second.id);

    await deleteNote(note.id);
    expect(await getAttachment(attachment.id)).toBeUndefined();
  });

  it('handles persistent storage requests without throwing', async () => {
    await expect(requestPersistentStorage()).resolves.toBeTypeOf('boolean');
  });
});

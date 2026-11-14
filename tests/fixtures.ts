import type { NotebookDataset } from '../src/types';

export function makeDataset(): NotebookDataset {
  return {
    projects: [
      {
        id: 'project-1',
        name: 'Literature Review',
        description: 'Papers worth revisiting',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-04T00:00:00.000Z',
      },
      {
        id: 'project-2',
        name: 'Research Ideas',
        description: '',
        createdAt: '2026-01-05T00:00:00.000Z',
        updatedAt: '2026-01-05T00:00:00.000Z',
      },
    ],
    canvases: [
      {
        id: 'canvas-1',
        projectId: 'project-1',
        name: 'Literature map',
        viewport: { x: 0, y: 0, zoom: 1 },
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-04T00:00:00.000Z',
      },
      {
        id: 'canvas-2',
        projectId: 'project-2',
        name: 'Early ideas',
        viewport: { x: 0, y: 0, zoom: 1 },
        createdAt: '2026-01-05T00:00:00.000Z',
        updatedAt: '2026-01-05T00:00:00.000Z',
      },
    ],
    notes: [
      {
        id: 'note-1',
        projectId: 'project-1',
        canvasId: 'canvas-1',
        title: 'Attention is all you need',
        content: 'A transformer architecture based entirely on attention.',
        createdAt: '2026-02-01T10:00:00.000Z',
        updatedAt: '2026-02-01T10:05:00.000Z',
      },
      {
        id: 'note-2',
        projectId: 'project-2',
        canvasId: 'canvas-2',
        title: 'Notes on evaluation',
        content: 'Try a small held-out benchmark.',
        createdAt: '2026-02-02T10:00:00.000Z',
        updatedAt: '2026-02-02T10:00:00.000Z',
      },
    ],
    settings: {
      schemaVersion: 3,
      lastBackupAt: '2026-02-03T00:00:00.000Z',
      lastImportAt: null,
      editorMode: 'write',
      editorFontSize: 16,
      autosaveDelaySeconds: 1,
      singleClickZoom: 1,
      touchpadZoomSensitivity: 1,
      defaultNoteWidth: 430,
      highlightColor: '#f6e27a',
      sidebarCollapsed: false,
    },
  };
}

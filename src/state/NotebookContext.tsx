import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  AppSettings,
  Canvas,
  CanvasInput,
  CanvasViewport,
  Note,
  NoteInput,
  NoteLayout,
  NotePatch,
  NotebookDataset,
  Project,
  ProjectInput,
  UpdateNoteOptions,
} from '../types';
import {
  createCanvas as createCanvasInDb,
  createNote as createNoteInDb,
  createProject as createProjectInDb,
  createProjectWithNote as createProjectWithNoteInDb,
  deleteCanvas as deleteCanvasInDb,
  deleteNote as deleteNoteInDb,
  deleteProject as deleteProjectInDb,
  getDataset,
  updateCanvas as updateCanvasInDb,
  updateCanvasViewport as updateCanvasViewportInDb,
  updateNote as updateNoteInDb,
  updateNoteLayout as updateNoteLayoutInDb,
  updateProject as updateProjectInDb,
  updateSettings as updateSettingsInDb,
} from '../services/db/repository';
import { requestPersistentStorage } from '../services/db/database';

interface NotebookContextValue {
  data: NotebookDataset | null;
  loading: boolean;
  loadError: string | null;
  refresh: () => Promise<NotebookDataset>;
  retryLoad: () => void;
  createProject: (input: ProjectInput) => Promise<Project>;
  updateProject: (id: string, patch: Partial<ProjectInput>) => Promise<Project>;
  deleteProject: (id: string) => Promise<{ deletedNoteIds: string[] }>;
  createCanvas: (input: CanvasInput) => Promise<Canvas>;
  updateCanvas: (id: string, patch: { name?: string }) => Promise<Canvas>;
  updateCanvasViewport: (id: string, viewport: CanvasViewport) => Promise<Canvas>;
  deleteCanvas: (id: string) => Promise<{ deletedNoteIds: string[] }>;
  createNote: (input: NoteInput) => Promise<Note>;
  createProjectWithNote: (
    project: ProjectInput,
    note: Omit<NoteInput, 'projectId' | 'canvasId'>,
  ) => Promise<{ project: Project; canvas: Canvas; note: Note }>;
  updateNote: (
    id: string,
    patch: NotePatch,
    options?: UpdateNoteOptions,
  ) => Promise<Note>;
  updateNoteLayout: (id: string, layout: NoteLayout) => Promise<Note>;
  deleteNote: (id: string) => Promise<Note>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
}

const NotebookContext = createContext<NotebookContextValue | null>(null);

export function NotebookProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<NotebookDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadSequence = useRef(0);
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const dataset = await getDataset();
    if (sequence !== refreshSequence.current) return dataset;
    setData(dataset);
    return dataset;
  }, []);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError(null);
    try {
      const dataset = await getDataset();
      if (sequence !== loadSequence.current) return;
      setData(dataset);
      setLoading(false);
      void requestPersistentStorage();
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setLoadError(error instanceof Error ? error.message : 'ClipCanvas could not load your notebook.');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // The capture popup and the side panel are separate documents that share
    // one IndexedDB database. Re-read when this window regains focus so a
    // selection saved from the popup shows up without reloading the extension.
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'hidden') return;
      void refresh().catch(() => undefined);
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refresh]);

  const retryLoad = useCallback(() => {
    void load();
  }, [load]);

  const createProject = useCallback(async (input: ProjectInput) => {
    const project = await createProjectInDb(input);
    // Project creation also creates its first canvas, so re-read to keep both
    // collections in sync without duplicating that transaction here.
    const dataset = await getDataset();
    setData(dataset);
    return project;
  }, []);

  const updateProject = useCallback(
    async (id: string, patch: Partial<ProjectInput>) => {
      const project = await updateProjectInDb(id, patch);
      setData((current) =>
        current
          ? {
              ...current,
              projects: current.projects.map((item) => (item.id === id ? project : item)),
            }
          : current,
      );
      return project;
    },
    [],
  );

  const deleteProject = useCallback(async (id: string) => {
    const result = await deleteProjectInDb(id);
    const removed = new Set(result.deletedNoteIds);
    setData((current) =>
      current
        ? {
            ...current,
            projects: current.projects.filter((project) => project.id !== id),
            canvases: current.canvases.filter((canvas) => canvas.projectId !== id),
            notes: current.notes.filter((note) => !removed.has(note.id)),
          }
        : current,
    );
    return result;
  }, []);

  const createCanvas = useCallback(async (input: CanvasInput) => {
    const canvas = await createCanvasInDb(input);
    // Creating a canvas without an explicit project can also create the
    // implicit internal project, so refresh the full dataset.
    const dataset = await getDataset();
    setData(dataset);
    return canvas;
  }, []);

  const updateCanvas = useCallback(async (id: string, patch: { name?: string }) => {
    const canvas = await updateCanvasInDb(id, patch);
    setData((current) =>
      current
        ? {
            ...current,
            canvases: current.canvases.map((item) => (item.id === id ? canvas : item)),
          }
        : current,
    );
    return canvas;
  }, []);

  const updateCanvasViewport = useCallback(
    async (id: string, viewport: CanvasViewport) => {
      const canvas = await updateCanvasViewportInDb(id, viewport);
      setData((current) =>
        current
          ? {
              ...current,
              canvases: current.canvases.map((item) => (item.id === id ? canvas : item)),
            }
          : current,
      );
      return canvas;
    },
    [],
  );

  const deleteCanvas = useCallback(async (id: string) => {
    const result = await deleteCanvasInDb(id);
    const removed = new Set(result.deletedNoteIds);
    setData((current) =>
      current
        ? {
            ...current,
            canvases: current.canvases.filter((canvas) => canvas.id !== id),
            notes: current.notes.filter((note) => !removed.has(note.id)),
          }
        : current,
    );
    return result;
  }, []);

  const createNote = useCallback(async (input: NoteInput) => {
    const note = await createNoteInDb(input);
    setData((current) =>
      current ? { ...current, notes: [note, ...current.notes] } : current,
    );
    return note;
  }, []);

  const createProjectWithNote = useCallback(
    async (projectInput: ProjectInput, noteInput: Omit<NoteInput, 'projectId' | 'canvasId'>) => {
      const result = await createProjectWithNoteInDb(projectInput, noteInput);
      setData((current) =>
        current
          ? {
              ...current,
              projects: [...current.projects, result.project],
              canvases: [...current.canvases, result.canvas],
              notes: [result.note, ...current.notes],
            }
          : current,
      );
      return result;
    },
    [],
  );

  const updateNote = useCallback(
    async (id: string, patch: NotePatch, options?: UpdateNoteOptions) => {
      const note = await updateNoteInDb(id, patch);
      if (options?.publish === false) return note;

      setData((current) => {
        if (!current) return current;
        const previous = current.notes.find((item) => item.id === id);
        return {
          ...current,
          notes: current.notes.map((item) => (item.id === id ? note : item)),
          projects: current.projects.map((project) =>
            project.id === note.projectId || project.id === previous?.projectId
              ? { ...project, updatedAt: new Date().toISOString() }
              : project,
          ),
        };
      });
      return note;
    },
    [],
  );

  const updateNoteLayout = useCallback(async (id: string, layout: NoteLayout) => {
    const note = await updateNoteLayoutInDb(id, layout);
    setData((current) =>
      current
        ? {
            ...current,
            notes: current.notes.map((item) => (item.id === id ? note : item)),
          }
        : current,
    );
    return note;
  }, []);

  const deleteNote = useCallback(async (id: string) => {
    const note = await deleteNoteInDb(id);
    setData((current) =>
      current ? { ...current, notes: current.notes.filter((item) => item.id !== id) } : current,
    );
    return note;
  }, []);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const settings = await updateSettingsInDb(patch);
    setData((current) => (current ? { ...current, settings } : current));
    return settings;
  }, []);

  const value = useMemo<NotebookContextValue>(
    () => ({
      data,
      loading,
      loadError,
      refresh,
      retryLoad,
      createProject,
      updateProject,
      deleteProject,
      createCanvas,
      updateCanvas,
      updateCanvasViewport,
      deleteCanvas,
      createNote,
      createProjectWithNote,
      updateNote,
      updateNoteLayout,
      deleteNote,
      updateSettings,
    }),
    [
      data,
      loading,
      loadError,
      refresh,
      retryLoad,
      createProject,
      updateProject,
      deleteProject,
      createCanvas,
      updateCanvas,
      updateCanvasViewport,
      deleteCanvas,
      createNote,
      createProjectWithNote,
      updateNote,
      updateNoteLayout,
      deleteNote,
      updateSettings,
    ],
  );

  return <NotebookContext.Provider value={value}>{children}</NotebookContext.Provider>;
}

export function useNotebook(): NotebookContextValue {
  const context = useContext(NotebookContext);
  if (!context) throw new Error('useNotebook must be used inside NotebookProvider');
  return context;
}

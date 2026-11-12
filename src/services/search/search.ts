import type {
  Note,
  NotebookDataset,
  Project,
  SearchFilters,
  SearchResults,
} from '../../types';
import { textFromMarkdown, truncate } from '../../lib/utils';

const MAX_NOTE_RESULTS = 100;
const MAX_PROJECT_RESULTS = 20;
const SNIPPET_LENGTH = 190;

export interface SearchIndex {
  notes: Array<{
    note: Note;
    project: Project;
    titleFold: string;
    contentFold: string;
    contentText: string;
    projectFold: string;
    combinedFold: string;
    updatedAt: number;
  }>;
  projects: Array<{
    project: Project;
    nameFold: string;
    descriptionFold: string;
    combinedFold: string;
  }>;
}

export function foldText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSearchIndex(projects: Project[], notes: Note[]): SearchIndex {
  const projectById = new Map(projects.map((project) => [project.id, project]));

  const indexedProjects = projects.map((project) => {
    const nameFold = foldText(project.name);
    const descriptionFold = foldText(project.description);
    return {
      project,
      nameFold,
      descriptionFold,
      combinedFold: `${nameFold} ${descriptionFold}`,
    };
  });

  const indexedNotes = notes.flatMap((note) => {
    const project = projectById.get(note.projectId);
    if (!project) return [];
    const titleFold = foldText(note.title);
    const contentText = note.contentText ?? textFromMarkdown(note.content);
    const contentFold = foldText(contentText);
    const projectFold = foldText(`${project.name} ${project.description}`);
    return [
      {
        note,
        project,
        titleFold,
        contentFold,
        contentText,
        projectFold,
        combinedFold: `${titleFold} ${contentFold} ${projectFold}`,
        updatedAt: new Date(note.updatedAt).getTime(),
      },
    ];
  });

  return { notes: indexedNotes, projects: indexedProjects };
}

function matchesAllTokens(haystack: string, tokens: string[]): boolean {
  return tokens.every((token) => haystack.includes(token));
}

function occurrenceScore(haystack: string, query: string, base: number): number {
  if (!query || !haystack) return 0;
  const index = haystack.indexOf(query);
  if (index < 0) return 0;
  if (index === 0) return base + 25;
  if (haystack === query) return base + 40;
  return base;
}

function scoreTokens(haystack: string, tokens: string[], perToken: number): number {
  if (tokens.length === 0) return 0;
  const present = tokens.filter((token) => haystack.includes(token)).length;
  return present === tokens.length ? tokens.length * perToken : 0;
}

function makeSnippet(source: string, tokens: string[], query: string): string {
  // Snippets are plain text, so flatten Markdown syntax before slicing.
  const cleaned = textFromMarkdown(source);
  if (!cleaned) return '';
  if (tokens.length === 0) return truncate(cleaned, SNIPPET_LENGTH);

  const lower = cleaned.toLocaleLowerCase('en-US');
  let index = query ? lower.indexOf(query.toLocaleLowerCase('en-US')) : -1;
  if (index < 0) {
    for (const token of tokens) {
      const found = lower.indexOf(token);
      if (found >= 0 && (index < 0 || found < index)) index = found;
    }
  }
  if (index < 0) return truncate(cleaned, SNIPPET_LENGTH);

  const start = Math.max(0, index - Math.floor(SNIPPET_LENGTH * 0.32));
  const end = Math.min(cleaned.length, start + SNIPPET_LENGTH);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < cleaned.length ? '…' : '';
  return `${prefix}${cleaned.slice(start, end).trim()}${suffix}`;
}

export function searchNotebook(
  index: SearchIndex,
  rawQuery: string,
  filters: SearchFilters,
): SearchResults {
  const query = rawQuery.trim();
  const foldedQuery = foldText(query);
  const tokens = foldedQuery ? foldedQuery.split(' ').filter(Boolean) : [];

  const noteResults = index.notes.flatMap((entry) => {
    if (filters.projectId && entry.note.projectId !== filters.projectId) return [];
    if (tokens.length > 0 && !matchesAllTokens(entry.combinedFold, tokens)) return [];

    let score = 0;
    const matchedFields: Array<'title' | 'content' | 'project'> = [];
    if (foldedQuery) {
      score += occurrenceScore(entry.titleFold, foldedQuery, 90);
      score += occurrenceScore(entry.contentFold, foldedQuery, 48);
      score += occurrenceScore(entry.projectFold, foldedQuery, 32);
      score += scoreTokens(entry.titleFold, tokens, 14);
      score += scoreTokens(entry.contentFold, tokens, 5);
      if (entry.titleFold.includes(foldedQuery)) matchedFields.push('title');
      if (entry.contentFold.includes(foldedQuery)) matchedFields.push('content');
      if (entry.projectFold.includes(foldedQuery)) matchedFields.push('project');
      if (score === 0) return [];
    } else {
      matchedFields.push('content');
    }

    let snippetField: 'content' | 'title' | 'project' = 'content';
    let snippet = makeSnippet(entry.contentText, tokens, query);
    if (
      !snippet ||
      (foldedQuery &&
        !entry.contentFold.includes(foldedQuery) &&
        !tokens.some((token) => entry.contentFold.includes(token)))
    ) {
      if (foldedQuery && entry.titleFold.includes(foldedQuery)) {
        snippetField = 'title';
        snippet = makeSnippet(entry.note.title, tokens, query);
      } else if (foldedQuery && entry.projectFold.includes(foldedQuery)) {
        snippetField = 'project';
        snippet = makeSnippet(
          `${entry.project.name}${entry.project.description ? ` — ${entry.project.description}` : ''}`,
          tokens,
          query,
        );
      } else if (entry.contentText.trim()) {
        snippet = makeSnippet(entry.contentText, [], query);
      }
    }

    return [{ note: entry.note, project: entry.project, score, snippet, snippetField, matchedFields }];
  });

  const projectResults = index.projects.flatMap((entry) => {
    if (filters.projectId && entry.project.id !== filters.projectId) return [];
    if (tokens.length > 0 && !matchesAllTokens(entry.combinedFold, tokens)) return [];

    let score = 0;
    const matchedFields: Array<'name' | 'description'> = [];
    if (foldedQuery) {
      score += occurrenceScore(entry.nameFold, foldedQuery, 70);
      score += occurrenceScore(entry.descriptionFold, foldedQuery, 25);
      score += scoreTokens(entry.nameFold, tokens, 10);
      if (entry.nameFold.includes(foldedQuery)) matchedFields.push('name');
      if (entry.descriptionFold.includes(foldedQuery)) matchedFields.push('description');
      if (score === 0) return [];
    } else {
      matchedFields.push('name');
    }

    const snippet =
      (foldedQuery && entry.descriptionFold.includes(foldedQuery)) ||
      (!foldedQuery && entry.project.description)
        ? makeSnippet(entry.project.description, tokens, query)
        : '';

    return [{ project: entry.project, score, snippet, matchedFields }];
  });

  noteResults.sort(
    (a, b) => b.score - a.score || b.note.updatedAt.localeCompare(a.note.updatedAt),
  );
  projectResults.sort((a, b) => b.score - a.score || a.project.name.localeCompare(b.project.name));

  return {
    query,
    notes: noteResults.slice(0, MAX_NOTE_RESULTS),
    projects: projectResults.slice(0, MAX_PROJECT_RESULTS),
    totalNotes: noteResults.length,
    totalProjects: projectResults.length,
  };
}

export function createSearchIndex(dataset: NotebookDataset): SearchIndex {
  return buildSearchIndex(dataset.projects, dataset.notes);
}

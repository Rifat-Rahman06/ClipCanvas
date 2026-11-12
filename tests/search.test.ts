import { describe, expect, it } from 'vitest';
import { buildSearchIndex, searchNotebook } from '../src/services/search/search';
import { makeDataset } from './fixtures';

function setup() {
  const dataset = makeDataset();
  return {
    dataset,
    index: buildSearchIndex(dataset.projects, dataset.notes),
  };
}

describe('notebook search', () => {
  it('finds matches in note content and returns a highlighted snippet', () => {
    const { index } = setup();
    const results = searchNotebook(index, 'transformer', {
      projectId: null,
    });
    expect(results.notes).toHaveLength(1);
    expect(results.notes[0].note.id).toBe('note-1');
    expect(results.notes[0].snippet.toLowerCase()).toContain('transformer');
    expect(results.notes[0].matchedFields).toContain('content');
  });

  it('finds notes by title, project name, and description', () => {
    const { index } = setup();

    expect(searchNotebook(index, 'evaluation', { projectId: null }).notes[0].note.id).toBe(
      'note-2',
    );

    const byProject = searchNotebook(index, 'research ideas', {
      projectId: null,
    });
    expect(byProject.notes.map((result) => result.note.id)).toContain('note-2');
    expect(byProject.projects.map((result) => result.project.id)).toContain('project-2');

    const byDescription = searchNotebook(index, 'papers worth', {
      projectId: null,
    });
    expect(byDescription.notes.map((result) => result.note.id)).toContain('note-1');
    expect(byDescription.projects[0].project.id).toBe('project-1');
  });

  it('requires every query token to match and is case/diacritic tolerant', () => {
    const { index } = setup();
    expect(searchNotebook(index, 'ATTENTION architecture', { projectId: null }).notes)
      .toHaveLength(1);
    expect(searchNotebook(index, 'attention benchmark', { projectId: null }).notes)
      .toHaveLength(0);
    expect(searchNotebook(index, 'BENCHMARK', { projectId: null }).notes[0].note.id).toBe(
      'note-2',
    );
  });

  it('filters by project', () => {
    const { index } = setup();
    const projectFiltered = searchNotebook(index, '', {
      projectId: 'project-2',
    });
    expect(projectFiltered.notes.map((result) => result.note.id)).toEqual(['note-2']);
  });

  it('returns an empty, explicit result set when nothing matches', () => {
    const { index } = setup();
    const results = searchNotebook(index, 'quantum basket weaving', {
      projectId: null,
    });
    expect(results.notes).toHaveLength(0);
    expect(results.projects).toHaveLength(0);
    expect(results.totalNotes).toBe(0);
  });

  it('returns plain-text snippets without Markdown syntax', () => {
    const dataset = makeDataset();
    dataset.notes[0].content =
      '## Spotlight\n\nThe **transformer** relies on attention.\n\n| Layer | Cost |\n| --- | --- |\n| Self-attention | High |';
    const index = buildSearchIndex(dataset.projects, dataset.notes);
    const [result] = searchNotebook(index, 'transformer', {
      projectId: null,
    }).notes;

    expect(result.snippet).toContain('transformer');
    expect(result.snippet).not.toContain('**');
    expect(result.snippet).not.toContain('##');
    expect(result.snippet).not.toContain('---');
    expect(result.snippet).not.toContain('|');
  });
});

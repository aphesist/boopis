/* What the presence line says a bot is doing, from the tool name the engine reports (the owner's "using fetch fetch", 0.1.9). */
import { describe, expect, it } from 'vitest';
import { toolWords } from './tool-words';

describe('the tool a bot is in, in words', () => {
  it('says a connected server’s tool once when the server is named after it (the engine reports mcp__fetch__fetch)', () => {
    expect(toolWords('mcp__fetch__fetch')).toBe('using fetch');
  });
  it('keeps the server’s name when the tool’s name says something else', () => {
    expect(toolWords('mcp__github__create_issue')).toBe('using github create issue');
    expect(toolWords('mcp__linear-app__search_issues')).toBe('using linear app search issues');
  });
  it('drops the server’s name when the tool’s name already starts with it', () => {
    expect(toolWords('mcp__github__github_search')).toBe('using github search');
    expect(toolWords('mcp__brave_search__brave_web_search')).toBe('using brave web search');
  });
  it('reads a server whose name has underscores of its own (the double underscore is the boundary)', () => {
    expect(toolWords('mcp__google_drive__list_files')).toBe('using google drive list files');
  });
  it('says the engine’s own tools in words, and anything else by its name', () => {
    expect(toolWords('read_file')).toBe('reading a file');
    expect(toolWords('terminal')).toBe('in the terminal');
    expect(toolWords('browser_click')).toBe('in the browser');
    expect(toolWords('custom_lookup')).toBe('using custom lookup');
    expect(toolWords('mcp_legacy_tool')).toBe('using legacy tool');
  });
  it('says nothing for no tool', () => {
    expect(toolWords(null)).toBe('');
    expect(toolWords('  ')).toBe('');
  });
});

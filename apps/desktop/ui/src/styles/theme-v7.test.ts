// @vitest-environment jsdom
/* The v7 appearance (styles/theme-v7.ts): a saved appearance is read leniently, a change is saved and painted on every root that
   follows the theme, Light and Dark choose the v6 theme's light and dark preset, and the v6 theme moved another way is followed. */
import { beforeEach, describe, expect, it } from 'vitest';
import { appearance, followTheme, sanitizeAppearance, setAppearance, startThemeV7 } from './theme-v7';
import { themeApi } from './theme';
import { KEYS, readJSON } from '../core/settings';

beforeEach(() => { localStorage.clear(); });

describe('the v7 appearance', () => {
  it('reads a saved appearance leniently: what is not one of the choices is the default', () => {
    expect(sanitizeAppearance({ mode: 'light', accent: '#2B72E5', radii: 'c', shadow: 'b', botColour: false })).toEqual({ mode: 'light', accent: '#2b72e5', radii: 'c', shadow: 'b', botColour: false });
    expect(sanitizeAppearance({ mode: 'sepia', accent: 'blue', radii: 'x', shadow: 9 })).toEqual({ mode: 'dark', accent: null, radii: 'b', shadow: 'a', botColour: true });
    expect(sanitizeAppearance(null).botColour).toBe(true);
  });

  it('saves a change and paints it on every root that follows the theme, the accent derived for the scheme', () => {
    startThemeV7();
    const root = followTheme(document.createElement('div'));
    expect(root.getAttribute('data-ui')).toBe('v7');
    setAppearance({ accent: '#2b72e5', radii: 'c' });
    expect(readJSON<Record<string, unknown>>(KEYS.appearance)).toMatchObject({ accent: '#2b72e5', radii: 'c' });
    expect(root.getAttribute('data-accent')).toBe('#2b72e5');
    expect(root.getAttribute('data-radii')).toBe('c');
    expect(root.style.getPropertyValue('--accent')).toBe('#2b72e5');
    setAppearance({ accent: null, radii: 'b' });
    expect(root.hasAttribute('data-accent')).toBe(false);
    expect(root.style.getPropertyValue('--accent')).toBe('');
  });

  it('Light and Dark choose the v6 theme\'s light and dark preset, and the roots follow the scheme', () => {
    startThemeV7();
    const root = followTheme(document.createElement('div'));
    setAppearance({ mode: 'light' });
    expect(themeApi.scheme()).toBe('light');
    expect(root.getAttribute('data-theme')).toBe('light');
    setAppearance({ mode: 'dark' });
    expect(themeApi.scheme()).toBe('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  it('follows the v6 theme moved another way (the light and dark key): the roots and the saved mode', () => {
    startThemeV7();
    const root = followTheme(document.createElement('div'));
    setAppearance({ mode: 'dark' });
    themeApi.preset('bone');
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(appearance().mode).toBe('light');
  });
});

import { describe, expect, it } from 'vitest';
import { describeDesktop, resolveControls } from './window';

const on = (platform: 'linux' | 'windows' | 'macos' | 'other', tiling = false) => ({ platform, tiling });

describe('which title-bar controls show', () => {
  it('automatic: close alone on a tiling window manager, all three on a floating desktop and on Windows', () => {
    expect(resolveControls('auto', on('linux', true))).toBe('close');
    expect(resolveControls('auto', on('linux'))).toBe('all');
    expect(resolveControls('auto', on('windows'))).toBe('all');
  });
  it('automatic on macOS follows the platform: the same three, in its order', () => {
    expect(resolveControls('auto', on('macos'))).toBe('mac');
  });
  it('a person\'s choice beats the guess, both ways', () => {
    expect(resolveControls('all', on('linux', true))).toBe('all');
    expect(resolveControls('close', on('linux'))).toBe('close');
    expect(resolveControls('close', on('macos'))).toBe('close');
  });
  it('without facts (the page, or a host that did not answer) nothing is hidden on a guess', () => {
    expect(resolveControls('auto', null)).toBe('all');
    expect(resolveControls('close', null)).toBe('close');
  });
  it('the settings row says what was found', () => {
    expect(describeDesktop({ desktop: 'Hyprland', tiling: true })).toContain('Hyprland, a tiling window manager');
    expect(describeDesktop({ desktop: 'GNOME', tiling: false })).toContain('GNOME');
    expect(describeDesktop({ desktop: null, tiling: false })).toContain('not recognised');
    expect(describeDesktop(null)).toContain('not the desktop app');
  });
});

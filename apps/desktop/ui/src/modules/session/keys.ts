import { isMac } from '../../core/dom';
/** true while the platform's command key is held (mod+ combinations belong to the shell) */
export const modKeyOf = (e: KeyboardEvent): boolean => (isMac ? e.metaKey : e.ctrlKey);

/* The Sessions inbox's sections, pure (board S17; SESSION-TAB.md 9): Needs you, Working, Pinned, Recent. */
import type { SessionSummary } from '../../data';

export type Section = 'needs' | 'working' | 'pinned' | 'recent';
export const SECTION_TITLES: Readonly<Record<Section, string>> = { needs: 'Needs you', working: 'Working', pinned: 'Pinned', recent: 'Recent' };
export const SECTIONS: readonly Section[] = ['needs', 'working', 'pinned', 'recent'];
/** which section a session is in: an approval stops it (Needs you); a running one works, also with a question open */
export const sectionOf = (s: SessionSummary): Section => (s.needs === 'approval' ? 'needs' : s.running ? 'working' : s.needs ? 'needs' : s.pinned ? 'pinned' : 'recent');
/** what it waits on you for, as its badge says it */
export const needWord = (s: SessionSummary): string => (s.needs === 'approval' ? 'Approval' : s.needs === 'question' ? 'Question' : '');

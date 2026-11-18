/* what the session's files tell each other: the list and the details panel redraw when `changed()` fires */
import { emit } from '../../core/bus';

const subs = new Set<() => void>();
export const onChanged = (fn: () => void): void => { subs.add(fn); };
export const changed = (): void => { subs.forEach((f) => f()); };
/** how many things in the Session tab wait on the user */
export const setAttention = (count: number): void => emit('hx:attention', { source: 'session', count, tab: 'session' });

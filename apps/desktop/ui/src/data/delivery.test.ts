import { describe, expect, it } from 'vitest';
import { deliveryParts, deliveryWords } from './delivery';

const rooms = [{ id: 'g-paper-past-', name: 'paper past' }, { id: 'g-news-ab12', name: 'news' }];
const as = (p: string): string => (p === 'kai' ? 'Kai' : p);

describe('where a job\'s result goes, in words', () => {
  it('names the room, who hosts it, and links the room', () => {
    expect(deliveryWords('room:g-paper-past-@kai', rooms, as)).toBe('posts to paper past (hosted by Kai)');
    expect(deliveryParts('room:g-paper-past-@kai', rooms)[1]).toEqual({ text: 'paper past', room: 'g-paper-past-' });
    expect(deliveryWords('room:g-news-ab12', rooms)).toBe('posts to news');
  });
  it('shows a room that is not a group as it was written', () => {
    expect(deliveryWords('room:g-gone-1@kai', rooms)).toBe('posts to room:g-gone-1@kai (not one of your groups)');
    expect(deliveryParts('room:g-gone-1@kai', rooms).every((p) => p.room === undefined)).toBe(true);
  });
  it('says local and origin, and shows anything else as written', () => {
    expect(deliveryWords('local', rooms)).toBe('saved on this computer, sent nowhere');
    expect(deliveryWords('origin', rooms)).toBe('replies where it was made');
    expect(deliveryWords('telegram:12345', rooms)).toBe('delivers to telegram:12345');
    expect(deliveryWords('room:not a token', rooms)).toBe('delivers to room:not a token');
  });
  it('joins several targets', () => {
    expect(deliveryWords('local, room:g-news-ab12', rooms)).toBe('saved on this computer, sent nowhere and posts to news');
    expect(deliveryWords('room:g-news-ab12,room:g-paper-past-@kai,telegram', rooms, as)).toBe('posts to news, paper past (hosted by Kai) and delivers to telegram');
  });
  it('says nothing for a job that names no target', () => {
    for (const d of [undefined, null, '', '  ,']) expect(deliveryParts(d, rooms)).toEqual([]);
  });
});

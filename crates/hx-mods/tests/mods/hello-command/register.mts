// A command mod: `$.command.register` in `session.start`, answers in `command.run`.
const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

export function register(on: any): void {
  on('session.start', async ($: any, e: unknown, next: (e: unknown) => Promise<unknown>) => {
    await $.command.register({ name: 'hello', description: 'Greet someone', argumentHint: '[name]' });
    await $.command.register({ name: 'fingerprint', description: 'SHA-256 of the text', argumentHint: '<text>' });
    return next(e);
  });

  on('command.run', { name: 'hello' }, async (_$: any, e: { args: string }) => ({
    text: `Hello, ${e.args.trim() || 'world'}!`,
  }));

  // An array matcher: either name reaches this hook.
  on('command.run', { name: ['fingerprint', 'fp'] }, async (_$: any, e: { args: string }) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(e.args));
    return { text: toHex(digest) };
  });
}

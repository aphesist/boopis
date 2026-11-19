import { describe, expect, it } from 'vitest';
import type { FormSpec } from '../../data';
import { FORM_KINDS, PERMISSION, answerText, formT, hasCancel, holdForm, optLabel, receiptText, secretFields, validateForm, valuesOf } from './form-model';

const spec = (props: Record<string, unknown>, required: string[] = [], extra: Partial<FormSpec> = {}): FormSpec => ({ id: 'f', kind: 'question', title: 't', schema: { properties: props as never, required }, ...extra });

describe('the kinds are templates', () => {
  it('has all ten kinds of docs/FORMS.md, each with its words', () => {
    expect(Object.keys(FORM_KINDS).sort()).toEqual(['approval', 'choice', 'connector', 'credential', 'feedback', 'permission', 'plan', 'question', 'setup', 'signin']);
    expect(formT({ kind: 'credential' }).submit).toBe('Save key');
    expect(formT({ kind: 'plan' }).cancel).toBe('Reject');
  });
  it('asks for the hold on an approval and a connector, and lets a form say otherwise', () => {
    expect(holdForm({ kind: 'approval' })).toBe(true);
    expect(holdForm({ kind: 'connector' })).toBe(true);
    expect(holdForm({ kind: 'question' })).toBe(false);
    expect(holdForm({ kind: 'question', submit: { hold: true } })).toBe(true);
    expect(holdForm({ kind: 'approval', submit: { hold: false } })).toBe(false);
  });
  it('has no cancel on feedback or when the form says so', () => {
    expect(hasCancel({ kind: 'feedback' })).toBe(false);
    expect(hasCancel({ kind: 'question', cancel: false })).toBe(false);
    expect(hasCancel({ kind: 'question' })).toBe(true);
  });
  it('says a permission receipt in the scope the user chose', () => {
    expect(receiptText(spec({}, [], { kind: 'permission' }), '', 'session')).toBe(PERMISSION['session']?.[1]);
    expect(receiptText(spec({}, [], { kind: 'credential', provider: 'OpenAI' }), '', '')).toBe('Saved to your keychain. The OpenAI provider is connected');
    expect(receiptText(spec({}, [], { kind: 'question' }), 'yes', '')).toBe('Answered: yes');
  });
  it('names an option by its enumNames when there is one', () => {
    expect(optLabel({ enum: ['a', 'b'], enumNames: ['Alpha', 'Beta'] }, 'b')).toBe('Beta');
    expect(optLabel({ enum: ['a'] }, 'a')).toBe('a');
    expect(optLabel({ enum: ['a'] }, 'zzz')).toBe('zzz');
  });
});

describe('validation, field by field', () => {
  it('asks for what is required, in words that say what to do', () => {
    const d = spec({ name: { type: 'string', title: 'Name' }, pick: { type: 'string', enum: ['a'], title: 'Pick' }, file: { 'x-upload': true, title: 'File' }, key: { type: 'string', 'x-secret': true, title: 'Key' } }, ['name', 'pick', 'file', 'key']);
    expect(validateForm(d, {}, {}).map((e) => e.msg)).toEqual(['Enter name', 'Choose pick', 'Add a file', 'Enter key']);
    expect(validateForm(d, { name: 'x', pick: 'a', file: { name: 'f' } }, { key: 'k' })).toEqual([]);
  });
  it('leaves an optional empty field alone and an empty list empty', () => {
    expect(validateForm(spec({ a: { type: 'string' } }), {}, {})).toEqual([]);
    expect(validateForm(spec({ a: { type: 'string', enum: ['x'], 'x-multi': true } }, ['a']), { a: [] }, {}).map((e) => e.msg)).toEqual(['Choose a']);
  });
  it('checks numbers: a number, a whole number, a range', () => {
    const d = spec({ n: { type: 'integer', title: 'Minutes', minimum: 1, maximum: 60 } });
    expect(validateForm(d, { n: 'abc' }, {})[0]?.msg).toBe('Enter a number');
    expect(validateForm(d, { n: '2.5' }, {})[0]?.msg).toBe('Use a whole number');
    expect(validateForm(d, { n: '0' }, {})[0]?.msg).toBe('Use a number from 1 to 60');
    expect(validateForm(d, { n: '61' }, {})).toHaveLength(1);
    expect(validateForm(d, { n: '30' }, {})).toEqual([]);
  });
  it('checks length, pattern (its own error words first) and the formats', () => {
    const d = spec({
      a: { type: 'string', title: 'A', minLength: 3 }, b: { type: 'string', title: 'B', maxLength: 2 }, c: { type: 'string', title: 'C', pattern: '^x', 'x-error': 'must start with x' },
      e: { type: 'string', format: 'email', title: 'E' }, u: { type: 'string', format: 'uri', title: 'U' }
    });
    const errs = validateForm(d, { a: 'ab', b: 'abc', c: 'y', e: 'nope', u: 'ftp://x' }, {});
    expect(errs.map((e) => e.name)).toEqual(['a', 'b', 'c', 'e', 'u']);
    expect(errs[2]?.msg).toBe('must start with x');
    expect(validateForm(d, { a: 'abc', b: 'ab', c: 'xy', e: 'a@b.co', u: 'https://x.dev' }, {})).toEqual([]);
  });
  it('treats a pattern that is not a regular expression as no match, never as a crash', () => {
    expect(validateForm(spec({ a: { type: 'string', title: 'A', pattern: '(' } }), { a: 'x' }, {})).toHaveLength(1);
  });
  it('wants a sign-in done before it lets the form go', () => {
    const d = spec({ s: { 'x-signin': { provider: 'Linear' } } }, ['s']);
    expect(validateForm(d, {}, {})[0]?.msg).toBe('Sign in to Linear first');
    expect(validateForm(d, {}, {}, new Set(['s']))).toEqual([]);
  });
  it('reads a secret as present or not and never looks at its content beyond the schema', () => {
    const d = spec({ k: { type: 'string', title: 'Key', 'x-secret': true, pattern: '^sk-' } }, ['k']);
    expect(validateForm(d, {}, {})[0]?.msg).toBe('Enter key');
    expect(validateForm(d, {}, { k: 'abc' })).toHaveLength(1);
    expect(validateForm(d, {}, { k: 'sk-1' })).toEqual([]);
    expect(secretFields(d)).toEqual(['k']);
  });
});

describe('what a submit carries', () => {
  it('sends the non-secret values, numbers as numbers, defaults the user left alone, and never a secret or a sign-in', () => {
    const d = spec({ g: { type: 'string', default: 'npm test' }, t: { type: 'integer', default: 5 }, n: { type: 'number' }, k: { type: 'string', 'x-secret': true }, s: { 'x-signin': {} }, o: { type: 'string' } }, ['g']);
    expect(valuesOf(d, { n: '2.5', k: 'secret', o: '' })).toEqual({ g: 'npm test', t: 5, n: 2.5 });
  });
  it('says the answer back for the receipt: a choice, several, a teammate, a switch, a file; never a secret', () => {
    const d = spec({ k: { 'x-secret': true, type: 'string' }, r: { type: 'string', enum: ['a', 'b'], enumNames: ['Alpha', 'Beta'] } });
    expect(answerText(d, { k: 'shh', r: 'b' }, () => null)).toBe('Beta');
    expect(answerText(spec({ m: { type: 'string', enum: ['a', 'b'], 'x-multi': true, enumNames: ['A', 'B'] } }), { m: ['a', 'b'] }, () => null)).toBe('A, B');
    expect(answerText(spec({ t: { 'x-picker': 'teammate' } }), { t: 'nina' }, (id) => (id === 'nina' ? 'Nina' : null))).toBe('Nina');
    expect(answerText(spec({ b: { type: 'boolean', title: 'Network' } }), { b: false }, () => null)).toBe('Network off');
    expect(answerText(spec({ f: { 'x-upload': true } }), { f: { name: 'log.txt' } }, () => null)).toBe('log.txt');
    expect(answerText(d, { k: 'shh' }, () => null)).toBe('');
  });
});

/* The conversation's pieces: the call-number entry, the request, steps, the blank (14.5 to 14.9). */
import { fileChip, html, ui } from '@boopis/ui';
import { put, stage, forced, line } from '../../story';
import type { Story } from '../../types';
import { LONG_NAME, LONG_TITLE, MULTILINE, PARAGRAPH, RTL, STEPS_SEED, UNBROKEN } from '../../fixtures';

const CONV = { url: '/v6/design-system/index.html#c-conversation', crop: '#c-conversation' };
const W = 720;

const blankTypical = stage(['typical', 'variant'], ({ root }) => { put(root, '<p>Keeping ' + html.code('prorate') + ' ' + html.blank({}) + ' that forwards to ' + html.code('prorateCents') + '.</p>', '<p>Keeping it ' + html.blank({ answer: 'as a deprecated alias' }) + '.</p>'); }, { width: 608 });

export default [
  {
    id: 'composer/entry', title: 'Call-number entry', area: 'composer', kind: 'component', covers: ['ui.entry'], mock: CONV,
    states: {
      typical: stage(['typical', 'variant'], ({ root }) => {
        put(root, ui.entry({ kind: 'user', who: 'you', callno: ['14:01'], body: html.request('proration drifts by a cent on long invoices. move src/billing to integer cents.') }),
          ui.entry({ kind: 'agent', callno: ['qwen3-coder', '→ sonnet 5.5', '3m 42s', '$0.37'], steps: { count: 6, id: 'lab-steps' }, body: '<p>' + html.inline(PARAGRAPH) + '</p>' }),
          ui.entry({ kind: 'bot', who: 'nina', callno: ['14:08'], body: '<p>Tests are green on billing/cents.</p>' }),
          ui.entry({ kind: 'mod', who: html.mod('sunset'), callno: ['14:09'], body: '<p>A mod wrote this row.</p>' }));
      }, { width: W }),
      'a sent message with files': stage(['variant'], ({ root }) => {
        const chips = '<div class="ss-attached">' + [fileChip('invoices-sample.csv', { kind: 'file' }), fileChip('screenshot.png', { kind: 'image' }), fileChip('src/billing', { kind: 'folder' }), fileChip(UNBROKEN, { kind: 'file' })].map((n) => n.outerHTML).join('') + '</div>';
        put(root, ui.entry({ kind: 'user', who: 'you', callno: ['14:01'], body: html.request('what is wrong with these totals?') + chips }));
      }, { width: W }),
      long: stage(['long'], ({ root }) => { put(root, ui.entry({ kind: 'bot', who: LONG_NAME, callno: ['14:08', 'claude-sonnet-5-5-20261101-extended-context-preview'], body: '<p>' + UNBROKEN + ' ' + LONG_TITLE + '</p>' })); }, { width: W }),
      empty: stage(['empty'], ({ root }) => { put(root, ui.entry({ kind: 'agent', callno: ['sonnet 5.5'], body: '' })); }, { width: W }),
      rtl: stage(['rtl'], ({ root }) => { put(root, ui.entry({ kind: 'user', who: 'you', callno: ['14:01'], body: html.request(RTL) })); }, { width: W, dir: 'rtl' })
    }
  },
  {
    id: 'composer/request', title: 'Request', area: 'composer', kind: 'component', covers: ['ui.request'], mock: CONV,
    states: {
      typical: stage(['typical'], ({ root }) => { put(root, ui.request('refactor the proration helpers in src/billing to use integer cents, run the tests, then open a PR.')); }, { width: 608 }),
      long: stage(['long'], ({ root }) => { put(root, ui.request(UNBROKEN + ' ' + MULTILINE)); }, { width: 608 }),
      empty: stage(['empty'], ({ root }) => { put(root, ui.request('')); }, { width: 608 })
    }
  },
  {
    id: 'composer/steps', title: 'Steps', area: 'composer', kind: 'component', covers: ['ui.steps'], mock: CONV,
    states: {
      typical: stage(['typical', 'variant'], ({ root }) => { put(root, ui.steps({ items: STEPS_SEED })); }, { width: 608 }),
      empty: stage(['empty'], ({ root }) => { put(root, ui.steps({ items: [] })); }, { width: 608 }),
      many: stage(['many'], ({ root }) => { put(root, ui.steps({ items: Array.from({ length: 120 }, (_, i) => ({ title: 'step ' + i, time: i + 's', kind: i % 23 === 0 ? 'fail' as const : 'step' as const })) })); }, { width: 608 }),
      error: stage(['error'], ({ root }) => { put(root, ui.steps({ items: [{ title: 'npm test', mono: true, kind: 'fail', meta: ['invoice.test.ts', 'rolled back'], time: '4.2s' }, { title: 'escalated to sonnet 5.5', kind: 'escalate', time: '' }] })); }, { width: 608 }),
      long: stage(['long'], ({ root }) => { put(root, ui.steps({ items: [{ title: UNBROKEN, mono: true, meta: [LONG_TITLE, UNBROKEN], time: '12m 04s' }] })); }, { width: 608 })
    }
  },
  {
    id: 'composer/blank', title: 'Blank', area: 'composer', kind: 'component', covers: ['ui.blank'], mock: CONV,
    states: {
      typical: blankTypical, ...forced(blankTypical, '.ui-blank'),
      long: stage(['long'], ({ root }) => { line(root, ui.blank({ answer: LONG_TITLE + ' ' + UNBROKEN })); }, { width: 608 }),
      empty: stage(['empty'], ({ root }) => { line(root, ui.blank({})); })
    }
  }
] satisfies Story[];

// The mod the UI's recording is made with: a pane with a button, a select, code and markdown; a band row with progress
// dots; three toasts; a question; a theme; a log line.
import { Box, Text, Button, Select, Code, Markdown } from 'claude-code';

const OUT = [' PASS  money.test.ts', ' FAIL  invoice.test.ts  › rounds per line item', ' PASS  cents.test.ts'];

export function register(on) {
  let running, filter;

  on('session.start', async ($, e, next) => {
    running = $.state.atom(false);
    filter = $.state.atom('all');
    await $.ui.open({ id: 'tests', title: 'Tests' });
    await $.ui.status('1 failing');
    await $.ui.toast('1 test failing');
    await $.ui.toast('Indexed 296 files');
    await $.ui.toast('Context is at 78%');
    console.warn('the cache for money.test.ts is stale');
    await $.theme.set({ colors: { '--bg-2': '#201e31', '--text': '#e7e4f2', '--brass': '#b8a4f0' }, label: 'Dusk' });
    return next(e);
  });

  on('ui.render', { component: 'Pane', id: 'tests' }, async ($) => {
    const busy = $.state.read(running), mode = $.state.read(filter);
    const rerun = () => { if (!$.state.read(running)) $.state.update(running, () => true); };
    const pick = (v) => $.state.update(filter, () => v);
    const ask = () => { void $.ui.ask('Which tests should I re-run?', { header: 'Run', options: ['The failing test', 'The billing suite', 'Everything'] }); };
    const shown = mode === 'failing' ? OUT.filter((l) => l.includes('FAIL')) : OUT;
    return (
      <Box flexDirection="column" gap={3}>
        <Box justifyContent="space-between" alignItems="center" gap={2}>
          <Text bold>{busy ? 'Running tests' : '3 tests, 1 failing'}</Text>
          <Button onPress={rerun} label={busy ? 'Running' : 'Re-run'} disabled={busy} />
        </Box>
        <Box alignItems="center" gap={2}>
          <Select options={[{ label: 'All tests', value: 'all' }, { label: 'Failing only', value: 'failing' }]} value={mode} onSelect={pick} label="Show" />
          <Text size="xs" color="subtle">{`${shown.length} shown`}</Text>
        </Box>
        <Code source={shown.join('\n')} path="npm test" wrap />
        <Markdown text={'The failure is in `invoice.test.ts`. [Open the run](https://ci.example.com/runs/4182)'} />
        <Button onPress={ask} label="Ask which to run" />
      </Box>
    );
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const busy = $.state.read(running);
    return (
      <Box alignItems="center" justifyContent="space-between" gap={2} flexGrow={1}>
        <Text wrap="truncate" color={busy ? 'warning' : 'success'}>{busy ? 'Running tests' : e.props.isWorking ? 'Waiting for the turn' : 'Tests idle'}</Text>
        {busy ? <Box role="progressbar" dots={8} label="Running tests" /> : null}
      </Box>
    );
  });
}

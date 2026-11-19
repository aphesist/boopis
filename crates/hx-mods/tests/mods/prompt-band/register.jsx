// A band above the prompt that reads `e.props.isWorking`, and two hooks that throw: one with no
// handler (the chain skips it) and one with `.catch` (the handler answers).
import { Box, Text } from 'claude-code';

export function register(on) {
  // Registered first, so it runs first, throws, and is skipped; the band below still draws.
  on('ui.render', { component: 'AbovePrompt' }, async () => {
    throw new Error('boom');
  });

  on('ui.render', { component: 'AbovePrompt' }, async (_$, e) => (
    <Box>
      <Text color={e.props.isWorking ? 'warning' : 'success'}>{e.props.isWorking ? 'Working' : 'Idle'}</Text>
    </Box>
  ));

  on('ui.render', { component: 'AbovePromptList' }, async () => {
    throw new Error('boom');
  }).catch(async (_$, e, next) => (
    <Text dimColor>{`recovered from a ${next.error} (hook called next: ${next.called})`}</Text>
  ));
}

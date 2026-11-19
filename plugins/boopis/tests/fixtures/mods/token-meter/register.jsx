// The mod the UI's recording is made with: a chart pane, a status line and a log line.
import { Box, Text, Svg } from 'claude-code';

const TURNS = [[6.1, 1.2], [9.4, 2.0], [4.2, 0.9], [11.8, 3.1]];

function chart() {
  const max = 18, H = 84, bw = 12;
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 112">' +
    `<line x1="0" y1="${H}.5" x2="300" y2="${H}.5" stroke="subtle" stroke-width="1"/>`;
  TURNS.forEach(([input, output], i) => {
    const x = 20 + i * 34, hi = Math.round((input / max) * H), ho = Math.round((output / max) * H);
    svg += `<rect x="${x}" y="${H - hi}" width="${bw}" height="${hi}" rx="2" fill="claude"/>` +
      `<rect x="${x + bw + 2}" y="${H - ho}" width="${bw}" height="${ho}" rx="2" fill="#7aa2f7"/>` +
      `<text x="${x + bw}" y="104" text-anchor="middle" font-size="11">${i + 1}</text>`;
  });
  return svg + '</svg>';
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.ui.open({ id: 'usage', title: 'Token usage' });
    await $.ui.status('12.4k tokens this turn');
    console.log('token-meter is watching this session');
    return next(e);
  });
  on('ui.render', { component: 'Pane', id: 'usage' }, async () => (
    <Box flexDirection="column" gap={3}>
      <Box justifyContent="space-between" alignItems="baseline">
        <Text bold>This session</Text>
        <Text mono tabular size="xs" color="subtle">{'48.2k tokens'}</Text>
      </Box>
      <Svg svg={chart()} label="Tokens per turn, input and output, turns 1 to 4" />
      <Box gap={3}>
        <Box gap={1} alignItems="center"><Box width={1} height={1} backgroundColor="claude" /><Text size="xs" color="subtle">input</Text></Box>
        <Box gap={1} alignItems="center"><Box width={1} height={1} backgroundColor="#7aa2f7" /><Text size="xs" color="subtle">output</Text></Box>
      </Box>
    </Box>
  ));
}

import { Box, Button, Text } from 'claude-code';

export function Counter(props: { count: number; ticks: number; onIncrement: () => void }) {
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{`Count: ${props.count}`}</Text>
      <Text dimColor>{`Ticks: ${props.ticks}`}</Text>
      <Button onPress={props.onIncrement}>Increment</Button>
    </Box>
  );
}

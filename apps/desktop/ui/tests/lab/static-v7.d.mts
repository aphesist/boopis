export interface StaticFinding { check: string; area: string; file: string; line: number; msg: string; snippet: string; key: string }
export function scanV7(): StaticFinding[];

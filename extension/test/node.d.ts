// The few node:test and node:assert APIs the tests use, to avoid @types/node.
declare module 'node:test' {
  export function test(name: string, run: () => void | Promise<void>): void;
}

declare module 'node:assert/strict' {
  const assert: {
    equal(actual: unknown, expected: unknown): void;
    deepEqual(actual: unknown, expected: unknown): void;
    throws(run: () => unknown, expected?: (error: unknown) => boolean): void;
    rejects(promise: Promise<unknown>, expected?: (error: unknown) => boolean): Promise<void>;
  };
  export default assert;
}

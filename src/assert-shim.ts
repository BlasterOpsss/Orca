function assert(value: unknown, message?: string | Error): void {
  if (!value) throw message instanceof Error ? message : new Error(message ?? "Assertion failed");
}
assert.ok = assert;
assert.strict = assert;
export default assert;
export { assert as ok };

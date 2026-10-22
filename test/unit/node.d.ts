// The parts of Node's test modules the unit tests use, declared here so the
// typecheck needs no Node type definitions for the extension's own code.

declare module "node:test" {
	export const test: (name: string, fn: () => unknown) => void
}

declare module "node:assert/strict" {
	const assert: {
		ok(value: unknown, message?: string): void
		equal(actual: unknown, expected: unknown, message?: string): void
		deepEqual(actual: unknown, expected: unknown, message?: string): void
	}

	export default assert
}

// Externally-resolvable promise.
//
// Replaces the legacy global Promise proxy, which wrapped every promise
// construction on the page just to expose $resolve/$reject. The method names are
// kept so existing call sites read the same.

export type DeferredPromise<T = void> = Promise<T> & {
	$resolve: (value: T | PromiseLike<T>) => void
	$reject: (reason?: unknown) => void
}

export const deferredPromise = <T = void>(): DeferredPromise<T> => {
	const { promise, resolve, reject } = Promise.withResolvers<T>()

	return Object.assign(promise, { $resolve: resolve, $reject: reject })
}

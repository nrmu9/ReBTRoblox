// Externally-resolvable promise.
//
// Replaces the legacy global Promise proxy, which wrapped every promise
// construction on the page just to expose $resolve/$reject. The method names are
// kept so existing call sites read the same.

export type DeferredPromise<T = any> = Promise<T> & {
	$resolve: (value?: T | PromiseLike<T>) => void
	$reject: (reason?: any) => void
}

export const deferredPromise = <T = any>(): DeferredPromise<T> => {
	const { promise, resolve, reject } = Promise.withResolvers<T>()

	return Object.assign(promise, { $resolve: resolve as any, $reject: reject })
}

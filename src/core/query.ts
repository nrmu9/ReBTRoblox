// Selectors may start with > to mean "direct child of this element", which the
// legacy $ API supported by rewriting them to :scope.

const LEADING_CHILD = /(^|,)\s*(?=>)/g

export const scopeSelector = (selector: string): string => selector.replace(LEADING_CHILD, "$&:scope")

export const find = <T extends Element = Element>(self: ParentNode, selector: string): T | null =>
	self.querySelector<T>(scopeSelector(selector))

export const findAll = <T extends Element = Element>(self: ParentNode, selector: string): NodeListOf<T> =>
	self.querySelectorAll<T>(scopeSelector(selector))

/** Document-wide query, the bare $(selector) / $.all(selector) of the legacy API. */
export const query = <T extends Element = Element>(selector: string): T | null => find<T>(document, selector)
export const queryAll = <T extends Element = Element>(selector: string): NodeListOf<T> => findAll<T>(document, selector)

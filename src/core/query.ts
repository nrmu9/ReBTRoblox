// Selectors may start with > to mean "direct child of this element", which the
// legacy $ API supported by rewriting them to :scope.

const LEADING_CHILD = /(^|,)\s*(?=>)/g

export const scopeSelector = (selector: string): string => selector.replace(LEADING_CHILD, "$&:scope")

export const find = <T extends Element = Element>(self: ParentNode, selector: string): T | null =>
	self.querySelector<T>(scopeSelector(selector))

export const findAll = <T extends Element = Element>(self: ParentNode, selector: string): NodeListOf<T> =>
	self.querySelectorAll<T>(scopeSelector(selector))

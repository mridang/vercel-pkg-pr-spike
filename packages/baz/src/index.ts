/** Identifier of this workspace package, exported for diagnostics. */
export const PKG = '@mridang/baz' as const

/** Return a constant marker string so callers can confirm baz loaded. */
export const baz = (): string => 'baz!'

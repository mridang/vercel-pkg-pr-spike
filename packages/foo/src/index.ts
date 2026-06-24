/** Identifier of this workspace package, exported for diagnostics. */
export const PKG = '@mridang/foo' as const

/**
 * Build a friendly greeting addressed to {@link name}.
 *
 * @param name - The greeted party. Inserted verbatim.
 * @returns The greeting string.
 */
export const greet = (name: string): string => `hello, ${name} from foo`

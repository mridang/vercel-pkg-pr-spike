import { greet } from "@mridang/foo";

/** Identifier of this workspace package, exported for diagnostics. */
export const PKG = "@mridang/bar" as const;

/**
 * Build a louder version of {@link greet}'s output by upper-casing
 * every character.
 *
 * @param name - Passed through to {@link greet}.
 * @returns The uppercased greeting string.
 */
export const loudGreet = (name: string): string => greet(name).toUpperCase();

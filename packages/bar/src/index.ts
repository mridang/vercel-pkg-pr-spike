import { greet } from '@mridang/foo'

export const loudGreet = (name: string): string => greet(name).toUpperCase()
export const PKG = '@mridang/bar'

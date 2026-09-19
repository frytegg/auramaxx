/**
 * The twelve avatars, shared by the phone, the régie and the projector. Index is what travels
 * over the wire and what the contract stores, so the ORDER is the data — never reorder this list
 * without migrating what is already on chain.
 */
export const AVATARS = ['🦊', '🐸', '👽', '🤖', '🐙', '🦈', '🔥', '💎', '🍄', '👾', '🦍', '🌀'] as const

export function avatarOf(index: number): string {
  return AVATARS[index % AVATARS.length] ?? AVATARS[0]
}

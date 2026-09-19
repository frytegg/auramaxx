/**
 * The player avatars, shared by the phone, the régie and the projector: pictures built by
 * web/scripts/make_avatars.py from the (gitignored) /avatar folder into /avatars/<index>.webp.
 *
 * The index is what travels over the wire and what the contract stores, so the ORDER is the data:
 * new avatars go at the end, never reorder. There are six; any index without a picture (including
 * the old emoji indices, 0-11, already on chain) wraps onto one that exists, so no player is ever
 * shown without a face. The server clamps joins to the same count (AVATAR_SLOTS in game.ts).
 */
/** Pictures in web/public/avatars. Keep it in step with make_avatars.py and the server's AVATAR_SLOTS. */
export const AVATAR_COUNT = 6

export function avatarIndex(index: number): number {
  const n = Math.floor(Number(index))
  if (!Number.isFinite(n) || n < 0) return 0
  return n % AVATAR_COUNT
}

export function avatarSrc(index: number): string {
  return `${import.meta.env.BASE_URL}avatars/${avatarIndex(index)}.webp`
}

// the picture fills whatever box it is put in, as a circle; the box sets the size
const FILL = 'display:block;width:100%;height:100%;object-fit:cover;border-radius:50%'

/** For DOM code. The alt stays empty: the player's name always sits next to the picture. */
export function avatarImg(index: number): HTMLImageElement {
  const img = document.createElement('img')
  img.className = 'avatar-img'
  img.src = avatarSrc(index)
  img.alt = ''
  img.decoding = 'async'
  img.draggable = false
  img.style.cssText = FILL
  return img
}

/** The same picture as markup for template strings. Only constants go in, never anything typed. */
export function avatarHtml(index: number): string {
  return `<img class="avatar-img" src="${avatarSrc(index)}" alt="" decoding="async" draggable="false" style="${FILL}">`
}

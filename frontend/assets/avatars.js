// Aura Max — shared avatar illustrations.
// Six original goofy faces. Reused by the onboarding avatar picker AND by
// the end-of-game podium/leaderboard, so whatever avatar a player picks at
// the start follows them all the way to the moment that matters most.

const DRAWS = [
  () => `
    <circle cx="20" cy="20" r="18" fill="#FF2E9E"></circle>
    <circle cx="14" cy="17" r="4.2" fill="#170013"></circle>
    <circle cx="27" cy="16" r="4.2" fill="#170013"></circle>
    <circle cx="15" cy="16" r="1.3" fill="#FFFFFF"></circle>
    <circle cx="28" cy="15" r="1.3" fill="#FFFFFF"></circle>
    <path d="M12 25 Q20 34 28 25" fill="none" stroke="#170013" stroke-width="2.4" stroke-linecap="round"></path>
    <ellipse cx="20" cy="29" rx="3.4" ry="4.5" fill="#FF7A9B"></ellipse>`,
  () => `
    <circle cx="20" cy="20" r="18" fill="#FF6FC4"></circle>
    <path d="M10 16 Q13.5 13 17 16" fill="none" stroke="#170013" stroke-width="2.2" stroke-linecap="round"></path>
    <circle cx="26" cy="16" r="4.4" fill="#170013"></circle>
    <circle cx="27" cy="15" r="1.3" fill="#FFFFFF"></circle>
    <path d="M11 25 Q20 32 29 24" fill="none" stroke="#170013" stroke-width="2.4" stroke-linecap="round"></path>
    <rect x="18" y="26" width="4" height="4" fill="#FFFFFF"></rect>`,
  () => `
    <circle cx="20" cy="20" r="18" fill="#D946A8"></circle>
    <path d="M9 11 L17 14" fill="none" stroke="#170013" stroke-width="2" stroke-linecap="round"></path>
    <path d="M31 11 L23 14" fill="none" stroke="#170013" stroke-width="2" stroke-linecap="round"></path>
    <circle cx="14" cy="18" r="5" fill="#170013"></circle>
    <circle cx="26" cy="18" r="5" fill="#170013"></circle>
    <circle cx="14" cy="18" r="1.6" fill="#FFFFFF"></circle>
    <circle cx="26" cy="18" r="1.6" fill="#FFFFFF"></circle>
    <ellipse cx="20" cy="29" rx="4.5" ry="3.4" fill="#170013"></ellipse>`,
  () => `
    <circle cx="20" cy="20" r="18" fill="#B34DFF"></circle>
    <path d="M10 17 Q14 13 18 17" fill="none" stroke="#170013" stroke-width="2.4" stroke-linecap="round"></path>
    <path d="M22 17 Q26 13 30 17" fill="none" stroke="#170013" stroke-width="2.4" stroke-linecap="round"></path>
    <path d="M10 24 Q20 33 30 24 Q20 30 10 24" fill="#170013"></path>
    <rect x="17" y="24.5" width="6" height="3" fill="#FFFFFF"></rect>`,
  () => `
    <circle cx="20" cy="20" r="18" fill="#7C3AED"></circle>
    <circle cx="15" cy="17" r="4" fill="#170013"></circle>
    <circle cx="25" cy="17" r="4" fill="#170013"></circle>
    <circle cx="16.5" cy="17" r="1.2" fill="#FFFFFF"></circle>
    <circle cx="23.5" cy="17" r="1.2" fill="#FFFFFF"></circle>
    <path d="M13 27 Q20 24 27 27" fill="none" stroke="#170013" stroke-width="2.4" stroke-linecap="round"></path>
    <circle cx="11" cy="23" r="1.1" fill="#170013" opacity="0.5"></circle>
    <circle cx="29" cy="23" r="1.1" fill="#170013" opacity="0.5"></circle>`,
  () => `
    <circle cx="20" cy="20" r="18" fill="#FF8FD4"></circle>
    <path d="M9 16 Q13 12 17 16" fill="none" stroke="#170013" stroke-width="2.2" stroke-linecap="round"></path>
    <circle cx="25" cy="17" r="4.4" fill="#170013"></circle>
    <circle cx="26.2" cy="16" r="1.3" fill="#FFFFFF"></circle>
    <path d="M11 24 Q17 31 24 26" fill="none" stroke="#170013" stroke-width="2.4" stroke-linecap="round"></path>
    <ellipse cx="27" cy="30" rx="3" ry="4" fill="#FF7A9B" transform="rotate(20 27 30)"></ellipse>`,
];

export const AVATAR_COUNT = DRAWS.length;

export function avatarSvg(index, size = 40) {
  const draw = DRAWS[((index % DRAWS.length) + DRAWS.length) % DRAWS.length];
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">${draw()}</svg>`;
}

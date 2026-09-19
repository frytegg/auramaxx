// Aura Max — stackable "jeton" mise widget.
//
// Tap a chip to add its value to the stack (tap 200 twice -> 400 total).
// "Annuler" undoes the last chip added. "ALL" replaces the stack with the
// player's full balance and is itself undoable.
//
// >>> INTEGRATION POINT <<<
// `onChange` fires on every change with { total, stack, isAll }. Wire it to:
//   - validate `total` against the player's real on-chain / backend balance
//     (this file assumes a flat maxBalance, e.g. 1000 $AURA for the demo)
//   - lock the stake in once the round starts (disable the widget)
//   - eventually submit the stake as a transaction / pool entry on Monad

const CHIP_VALUES = [100, 200, 500, 1000];
const CHIP_COLORS = { 100: '#FF8FD4', 200: '#FF2E9E', 500: '#B34DFF', 1000: '#2B0F52' };
const CHIP_TEXT_COLOR = { 100: '#170013', 200: '#170013', 500: '#FFFFFF', 1000: '#FFD166' };

function chipSvg(value, size) {
  const bg = value === 1000 ? '#FFD166' : '#FFFFFF';
  const fontSize = value === 1000 ? 13 : 16;
  const y = value === 1000 ? 37 : 38;
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="30" fill="${bg}"></circle>
      <circle cx="32" cy="32" r="30" fill="none" stroke="${bg}" stroke-width="6" stroke-dasharray="5 6"></circle>
      <circle cx="32" cy="32" r="22" fill="${CHIP_COLORS[value]}"></circle>
      <circle cx="32" cy="32" r="22" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.5"></circle>
      <text x="32" y="${y}" text-anchor="middle" font-family="'Anton', sans-serif" font-size="${fontSize}" fill="${CHIP_TEXT_COLOR[value]}">${value}</text>
    </svg>`;
}

function allChipSvg(size) {
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="30" fill="#FFFFFF"></circle>
      <circle cx="32" cy="32" r="30" fill="none" stroke="#FFFFFF" stroke-width="6" stroke-dasharray="5 6"></circle>
      <circle cx="32" cy="32" r="22" fill="#FFB020"></circle>
      <circle cx="32" cy="32" r="22" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.5"></circle>
      <text x="32" y="37" text-anchor="middle" font-family="'Anton', sans-serif" font-size="14" fill="#170013">ALL</text>
    </svg>`;
}

export function createMiseWidget(root, { chipSize = 54, maxBalance = 1000, initialStack = [200], onChange } = {}) {
  let stack = [...initialStack];
  let isAll = false;

  root.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:13px;color:var(--text-dim);">Ta mise</span>
        <button type="button" class="undo-btn" data-action="undo" aria-label="Annuler la dernière mise">
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4.6 6.4C5.6 4.4 7.7 3.1 10 3.4C12.9 3.8 14.9 6.5 14.5 9.4C14.1 12 11.7 13.9 9.1 13.6C7.1 13.4 5.4 12 4.7 10.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>
            <path d="M4.6 3.4L4.6 6.6L7.6 6.9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
          Annuler
        </button>
      </div>
      <span class="font-display" data-role="total" style="font-size:22px;color:var(--text);text-align:center;"></span>
      <div data-role="stack" style="min-height:26px;display:flex;align-items:center;justify-content:center;"></div>
      <div style="display:flex;justify-content:space-between;">
        ${CHIP_VALUES.map((v) => `<button type="button" class="chip-btn" data-add="${v}" aria-label="Ajouter ${v} $AURA">${chipSvg(v, chipSize)}</button>`).join('')}
        <button type="button" class="chip-btn" data-action="all" aria-label="Tout miser">${allChipSvg(chipSize)}</button>
      </div>
    </div>`;

  const totalEl = root.querySelector('[data-role="total"]');
  const stackEl = root.querySelector('[data-role="stack"]');
  const undoBtn = root.querySelector('[data-action="undo"]');

  const sum = () => stack.reduce((a, b) => a + b, 0);

  function render() {
    const total = isAll ? maxBalance : sum();
    totalEl.textContent = total + ' $AURA';

    if (isAll) {
      stackEl.innerHTML = `<div style="width:26px;height:26px;border-radius:50%;background:#FFB020;display:flex;align-items:center;justify-content:center;font-family:'Anton',sans-serif;font-size:8px;color:#170013;">ALL</div>`;
    } else if (stack.length > 0) {
      stackEl.innerHTML = `<div style="display:flex;">${stack
        .map((v, i) => `<div class="stack-chip" style="background:${CHIP_COLORS[v]};margin-left:${i === 0 ? '0' : '-10px'};"></div>`)
        .join('')}</div>`;
    } else {
      stackEl.innerHTML = `<span style="font-size:11px;color:var(--text-faint);">Aucune mise pour l'instant</span>`;
    }

    undoBtn.disabled = !(isAll || stack.length > 0);

    if (onChange) onChange({ total, stack: [...stack], isAll });
  }

  root.querySelectorAll('[data-add]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = Number(btn.dataset.add);
      if (isAll) {
        isAll = false;
        stack = [v];
      } else if (sum() + v <= maxBalance) {
        stack = [...stack, v];
      } else {
        return;
      }
      render();
    });
  });

  root.querySelector('[data-action="all"]').addEventListener('click', () => {
    isAll = true;
    render();
  });

  undoBtn.addEventListener('click', () => {
    if (isAll) isAll = false;
    else stack = stack.slice(0, -1);
    render();
  });

  render();

  return { getState: () => ({ total: isAll ? maxBalance : sum(), stack: [...stack], isAll }) };
}

// Aura Max — live round UP/DOWN toggle with countdown + flip-flop cooldown.
//
// Players can swap camps at any time during the round, but each swap starts
// a short cooldown (default 4s) before they can swap again.
//
// >>> INTEGRATION POINT <<<
// `timeLeft` here just counts down locally from whatever you pass in. In
// production this must be driven by a server-synced round clock (e.g. a
// WebSocket "round:tick"/"round:phase" event broadcast to every phone AND
// the projector), otherwise phones will drift out of sync with each other
// and with the two reveal thresholds (t=10s, t=20s) and freeze (t=30s).
// `onCampChange` is where you'd send the player's current camp to the
// backend / smart contract in real time.

export function createRoundToggle(root, {
  initialCamp = 'up',
  initialTimeLeft = 30,
  roundLength = 30,
  cooldownSeconds = 4,
  onCampChange,
  onTick,
} = {}) {
  let camp = initialCamp;
  let timeLeft = initialTimeLeft;
  let cooldownLeft = 0;

  const upBtn = root.querySelector('[data-camp="up"]');
  const downBtn = root.querySelector('[data-camp="down"]');
  const timeEl = root.querySelector('[data-role="time"]');
  const progressEl = root.querySelector('[data-role="progress"]');
  const cooldownEl = root.querySelector('[data-role="cooldown"]');

  function render() {
    const onCooldown = cooldownLeft > 0;
    [upBtn, downBtn].forEach((btn) => {
      if (!btn) return;
      const isActive = btn.dataset.camp === camp;
      btn.classList.toggle('active', isActive);
      btn.classList.toggle('disabled', onCooldown);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    if (timeEl) timeEl.textContent = timeLeft + 's';
    if (progressEl) progressEl.style.width = Math.round(((roundLength - timeLeft) / roundLength) * 100) + '%';
    if (cooldownEl) {
      cooldownEl.textContent = onCooldown
        ? `Tu pourras rebasculer dans ${cooldownLeft}s`
        : 'Tu peux changer de camp à tout moment';
      cooldownEl.style.color = onCooldown ? 'var(--magenta-soft)' : 'var(--text-faint)';
    }
  }

  function pick(next) {
    if (cooldownLeft > 0) return;
    camp = next;
    cooldownLeft = cooldownSeconds;
    render();
    if (onCampChange) onCampChange(camp);
  }

  if (upBtn) upBtn.addEventListener('click', () => pick('up'));
  if (downBtn) downBtn.addEventListener('click', () => pick('down'));

  const interval = setInterval(() => {
    timeLeft = Math.max(0, timeLeft - 1);
    cooldownLeft = Math.max(0, cooldownLeft - 1);
    render();
    if (onTick) onTick(timeLeft);
    if (timeLeft <= 0) clearInterval(interval);
  }, 1000);

  render();

  return {
    stop: () => clearInterval(interval),
    getCamp: () => camp,
  };
}

# Aura Max — Front-end (Monad Blitz Paris, 19 sept 2026)

Pari-mutuel gamifié pour une salle de hackathon. Ce dossier contient le
**front-end statique** — HTML/CSS/JS vanilla, aucune dépendance à builder —
converti à partir des maquettes Cowork Design vers du code réellement
exécutable dans n'importe quel navigateur ou repo.

## Structure

```
index.html              sommaire de démo, liens vers tous les écrans
assets/
  style.css              tokens de couleur, polices, styles partagés (boutons, toggles, chips)
  chip-mise.js            widget de mise empilable (jetons 100/200/500/1000/ALL + Annuler)
  round-timer.js          toggle UP/DOWN avec countdown + cooldown de 4s
telephone/                écrans joueur (390×844)
  onboarding.html          choix avatar + pseudo, 1000 $AURA offerts
  warmup.html              question BTC 1 — mise classique
  mise.html                écran Aura Max — mise sur le round
  toggle.html              round en cours, 30s, toggle UP/DOWN
  reveal.html              reveal #1 (t=10s), multiplicateur en avant
  resultat.html            résultat perso post-round
projo/                    écrans vidéoprojecteur salle (1600×900)
  ambiant.html             countdown ambiant pendant le round
  reveal.html              reveal plein écran (réutilisé pour #1 et #2)
  freeze.html              freeze + grille des joueurs gagnants/perdants
operateur/
  index.html               panneau de régie — contrôle des 4 étapes du round
                            + résolution manuelle des questions d'échauffement
```

Ouvre `index.html` dans un navigateur pour naviguer entre tous les écrans.
Aucun build, aucune install — tout est HTML/CSS/JS natif (les deux modules
JS partagés utilisent `<script type="module">`, supporté nativement).

## Ce qui est déjà fait

- Toute l'identité visuelle (fond `#0B0710`, magenta `#FF2E9E`, Anton +
  Space Grotesk, glow/animations) reprise à l'identique des maquettes.
- Le mécanisme de mise empilable (tap 200 deux fois → 400, "Annuler",
  visualisation en pile de jetons) est un vrai composant JS réutilisable
  (`assets/chip-mise.js`), pas une simulation figée.
- Le toggle UP/DOWN avec cooldown de 4s et countdown réel est aussi un
  composant réutilisable (`assets/round-timer.js`).
- Les 10 écrans (6 téléphone, 3 projo, 1 régie) sont tous fonctionnels en
  isolation, avec la navigation entre écrans téléphone déjà câblée.

## Ce qu'il reste à brancher (pour Claude Code / la suite du build)

Chaque fichier contient des commentaires `>>> INTEGRATION POINT <<<` aux
endroits précis où une vraie donnée / logique backend doit remplacer les
valeurs statiques de démo. En résumé :

1. **Synchronisation temps réel** — chaque écran a aujourd'hui son propre
   `setInterval` local. Il faut un round clock serveur (WebSocket
   recommandé) qui pousse `round:phase` / `round:tick` à tous les
   téléphones + aux 2 écrans projo + au panneau régie, pour qu'ils comptent
   exactement ensemble (reveals à t=10s/t=20s, freeze à t=30s).
2. **Pool & cotes** — les multiplicateurs (`×1,8`, `×2,6`) et les
   répartitions UP/DOWN (`44%/56%`, `62%/38%`) sont statiques. Ils doivent
   venir du calcul réel du pool pari-mutuel côté serveur/contrat.
3. **Wallet & mise on-chain (Monad testnet)** — `chip-mise.js` expose déjà
   `onChange({ total, stack, isAll })` à chaque changement de mise ; c'est
   le point d'entrée pour soumettre la mise (transaction ou entrée de pool).
4. **Résolution des rounds** — le panneau régie (`operateur/index.html`)
   déclenche aujourd'hui juste des changements d'état visuel locaux ; il
   doit émettre les événements réels qui font avancer round + paiements
   (pas d'oracle on-chain prévu — résolution manuelle assumée, comme dans
   la maquette).
5. **Résultat perso** (`telephone/resultat.html`) — toutes les valeurs
   (camp gagnant, gain, solde) sont statiques ; à remplacer par le payload
   de règlement du round, y compris le cas perdant (non designé dans la
   maquette au-delà de l'état gagnant).
6. **Avatars & pseudo** (`telephone/onboarding.html`) — stockés en
   `sessionStorage` pour la démo ; à remplacer par la vraie session/auth
   joueur.

Aucune dépendance crypto/jargon n'a été introduite dans l'UI — le ton
"jetons/$AURA", zéro jargon technique, reste intact, conformément au brief
original.

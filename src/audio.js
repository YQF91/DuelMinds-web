/* =============================================================================
 * DUELMINDS — SONS
 * =============================================================================
 *
 * RÔLE DU FICHIER
 * Produire les bruitages du duel. Aucun fichier n'est chargé : les sons sont
 * SYNTHÉTISÉS par le navigateur. Le projet reste entièrement en texte et se
 * partage par un simple lien.
 *
 * COMMENT ON FABRIQUE UN SON
 * Une forme d'onde donne la couleur (`square` claque, `sine` est doux,
 * `sawtooth` gronde, du bruit blanc fait une détonation), une enveloppe donne
 * la vie : le volume monte vite puis retombe. Sans enveloppe, on entendrait un
 * bip continu au lieu d'un coup de feu.
 *
 * CONTRAINTE MOBILE
 * iOS et Android refusent de jouer un son tant que l'utilisateur n'a pas
 * touché l'écran. Le contexte audio n'est donc créé qu'au premier appui.
 *
 * RÈGLE : le son n'est jamais indispensable. Toute erreur est avalée — un
 * navigateur sans Web Audio doit rester parfaitement jouable.
 *
 * DÉPENDANCES : aucune
 * ========================================================================== */

(function (root) {
  "use strict";

  const DUELMINDS = (root.DUELMINDS = root.DUELMINDS || {});

  let ctx = null;
  let enabled = true;

  function ensureContext() {
    if (!enabled) return null;
    try {
      if (!ctx) {
        const Ctor = root.AudioContext || root.webkitAudioContext;
        if (!Ctor) { enabled = false; return null; }
        ctx = new Ctor();
      }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    } catch (e) {
      enabled = false;
      return null;
    }
  }

  /** Une note qui glisse d'une fréquence à une autre, puis s'éteint. */
  function tone(ac, { type, from, to, gain, duration, delay = 0 }) {
    const t = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const amp = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (to && to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(amp);
    amp.connect(ac.destination);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  /** Une bouffée de bruit blanc — la détonation. */
  function noise(ac, { gain, duration, delay = 0 }) {
    const t = ac.currentTime + delay;
    const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * duration), ac.sampleRate);
    const data = buffer.getChannelData(0);
    // Le bruit décroît sur sa propre durée : « impact » plutôt que « souffle ».
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const src = ac.createBufferSource();
    const amp = ac.createGain();
    src.buffer = buffer;
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(amp);
    amp.connect(ac.destination);
    src.start(t);
  }

  /* ---------------------------------------------------------------------------
   * LA BANQUE DE SONS
   * Une recette par événement. Pour retoucher un bruitage, c'est ici.
   * ------------------------------------------------------------------------ */
  const RECIPES = {
    // Coup de feu : détonation sèche plus une résonance grave
    shoot: (ac) => {
      noise(ac, { gain: 0.28, duration: 0.18 });
      tone(ac, { type: "square", from: 180, to: 50, gain: 0.16, duration: 0.22 });
    },
    // Super tir : plus long, plus grave, avec une queue de réverbération
    super: (ac) => {
      noise(ac, { gain: 0.34, duration: 0.3 });
      tone(ac, { type: "sawtooth", from: 140, to: 32, gain: 0.24, duration: 0.5 });
      tone(ac, { type: "square", from: 90, to: 40, gain: 0.14, duration: 0.7, delay: 0.08 });
    },
    // Protection : une note montante, métallique et rassurante
    defend: (ac) => tone(ac, { type: "triangle", from: 480, to: 720, gain: 0.13, duration: 0.22 }),
    // Charge : le barillet qu'on remplit
    charge: (ac) => {
      tone(ac, { type: "sine", from: 280, to: 700, gain: 0.10, duration: 0.18 });
      noise(ac, { gain: 0.06, duration: 0.06, delay: 0.16 });
    },
    // Deux balles qui se percutent
    clash: (ac) => {
      noise(ac, { gain: 0.22, duration: 0.2 });
      tone(ac, { type: "square", from: 900, to: 1400, gain: 0.12, duration: 0.12 });
      tone(ac, { type: "square", from: 1200, to: 600, gain: 0.10, duration: 0.18, delay: 0.05 });
    },
    // Manche perdue : chute longue
    down: (ac) => tone(ac, { type: "sawtooth", from: 160, to: 32, gain: 0.20, duration: 0.75 }),
    // Manche gagnée : deux notes qui montent
    win: (ac) => {
      tone(ac, { type: "triangle", from: 523, to: 523, gain: 0.11, duration: 0.16 });
      tone(ac, { type: "triangle", from: 784, to: 784, gain: 0.11, duration: 0.28, delay: 0.14 });
    },
    // Duel remporté : petit arpège de fin
    victory: (ac) => {
      [392, 523, 659, 784].forEach((f, i) =>
        tone(ac, { type: "triangle", from: f, to: f, gain: 0.10, duration: 0.3, delay: i * 0.09 }));
    },
    // Appui sur un bouton
    click: (ac) => tone(ac, { type: "square", from: 620, to: 620, gain: 0.05, duration: 0.04 }),
  };

  /** Joue un bruitage. Ne lève jamais d'erreur. */
  function play(name) {
    const ac = ensureContext();
    if (!ac || !RECIPES[name]) return;
    try { RECIPES[name](ac); } catch (e) { /* le son reste facultatif */ }
  }

  /** Vibration du téléphone. Ignorée là où ce n'est pas géré. */
  function vibrate(pattern) {
    if (!root.navigator || !root.navigator.vibrate) return;
    try { root.navigator.vibrate(pattern); } catch (e) { /* facultatif */ }
  }

  DUELMINDS.audio = { play, vibrate };
})(typeof globalThis !== "undefined" ? globalThis : window);

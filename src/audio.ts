// ─── audio.ts ─────────────────────────────────────────────────────────────────
// Procedural sound effects using the Web Audio API.
// All sounds are synthesised from oscillators and noise buffers — no audio
// asset files needed.  AudioContext creation is deferred until the first user
// gesture so browsers don't block playback.
// ──────────────────────────────────────────────────────────────────────────────

export class AudioManager {
  private ctx: AudioContext | null = null;
  private _muted = false;

  get muted(): boolean { return this._muted; }
  set muted(v: boolean) { this._muted = v; }

  /** Lazily creates (or resumes) the AudioContext on first use. */
  private getCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /**
   * Schedules a single oscillator tone with exponential frequency sweep and
   * an exponential gain decay.
   *
   * @param type       OscillatorType ('sine' | 'square' | 'sawtooth' | 'triangle')
   * @param freqStart  Start frequency in Hz
   * @param freqEnd    End frequency in Hz (must be > 0)
   * @param duration   Duration in seconds
   * @param gainPeak   Peak gain (amplitude 0–1)
   * @param when       Offset from AudioContext.currentTime (seconds)
   */
  private tone(
    type: OscillatorType,
    freqStart: number, freqEnd: number,
    duration: number,
    gainPeak: number,
    when = 0,
  ): void {
    if (this._muted) return;
    try {
      const ctx = this.getCtx();
      const t = ctx.currentTime + when;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freqStart, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t + duration);
      gain.gain.setValueAtTime(gainPeak, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + duration + 0.02);
    } catch { /* non-fatal */ }
  }

  /**
   * Schedules a white-noise burst filtered through a low-pass filter.
   * Used for explosion-like sounds.
   */
  private noise(duration: number, gainPeak: number, cutoff: number, when = 0): void {
    if (this._muted) return;
    try {
      const ctx = this.getCtx();
      const t   = ctx.currentTime + when;
      const sr  = ctx.sampleRate;
      const len = Math.ceil(sr * duration);
      const buf = ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src    = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain   = ctx.createGain();
      src.buffer = buf;
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cutoff, t);
      filter.frequency.exponentialRampToValueAtTime(40, t + duration);
      gain.gain.setValueAtTime(gainPeak, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      src.start(t);
    } catch { /* non-fatal */ }
  }

  // ── Public sound events ───────────────────────────────────────────────────

  /** Short blip when a projectile hits an enemy. */
  hit(): void { this.tone('square',    440, 200, 0.05, 0.10); }

  /** Descending crunch when a regular enemy dies. */
  enemyDeath(): void { this.tone('sawtooth', 320, 70, 0.14, 0.18); }

  /** Harsh buzz when the player takes damage. */
  playerHit(): void { this.tone('sawtooth', 180, 90, 0.22, 0.28); }

  /** Soft ascending chime for gem collection. */
  gemPickup(): void { this.tone('sine',      900, 1400, 0.07, 0.07); }

  /** Brief tick for burn / poison damage-over-time. */
  dotTick(): void { this.tone('sawtooth', 260, 120, 0.07, 0.04); }

  /** Deep drone when the Gravity Well activates. */
  gravityWell(): void { this.tone('sine', 60, 30, 0.55, 0.18); }

  /** Standard explosion (plasma bomb, missiles). */
  explosion(): void {
    this.noise(0.30, 0.28, 600);
    this.tone('sawtooth', 160, 40, 0.28, 0.14);
  }

  /** Larger explosion when the Gravity Well detonates. */
  gravityDetonate(): void {
    this.noise(0.45, 0.38, 900);
    this.tone('sawtooth', 220, 50, 0.40, 0.20);
  }

  /** Big impact sound when the boss dies. */
  bossDeath(): void {
    this.noise(0.60, 0.45, 800);
    this.tone('sawtooth', 140, 35, 0.55, 0.30);
  }

  /** Two-note ominous chord when a boss spawns. */
  bossSpawn(): void {
    this.tone('sawtooth',  80, 130, 0.45, 0.32);
    this.tone('sawtooth', 110, 170, 0.45, 0.22, 0.06);
  }

  /** Rising four-note jingle on level-up. */
  levelUp(): void {
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone('triangle', f, f * 1.02, 0.12, 0.18, i * 0.10));
  }

  /** Descending arpeggio on game over. */
  gameOver(): void {
    [440, 370, 311, 262].forEach((f, i) =>
      this.tone('sawtooth', f, f * 0.48, 0.32, 0.20, i * 0.18));
  }

  /** Short ascending fanfare on the title screen. */
  titleJingle(): void {
    [261, 330, 392, 523, 659].forEach((f, i) =>
      this.tone('triangle', f, f, 0.16, 0.15, i * 0.12));
  }
}

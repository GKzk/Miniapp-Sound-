// Modern Cyber-Winamp Web Audio Engine
// Supports 10-Band Graphic Equalizer, Stereo VU meters, Master Volume, Balance/Pan, and Full-Track Generation

export interface EqBandConfig {
  frequency: number;
  label: string;
  gain: number; // in dB (-12 to +12)
}

export const DEFAULT_EQ_BANDS: EqBandConfig[] = [
  { frequency: 60, label: '60Hz', gain: 3 },
  { frequency: 170, label: '170Hz', gain: 4 },
  { frequency: 310, label: '310Hz', gain: 1 },
  { frequency: 600, label: '600Hz', gain: -1 },
  { frequency: 1000, label: '1kHz', gain: 0 },
  { frequency: 3000, label: '3kHz', gain: 2 },
  { frequency: 6000, label: '6kHz', gain: 3 },
  { frequency: 12000, label: '12kHz', gain: 4 },
  { frequency: 14000, label: '14kHz', gain: 3 },
  { frequency: 16000, label: '16kHz', gain: 2 },
];

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private masterGain: GainNode | null = null;
  private pannerNode: StereoPannerNode | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private preampNode: GainNode | null = null;

  private isRunning: boolean = false;
  private timerId: number | null = null;
  private currentBpm: number = 130;
  private currentPreset: string = 'uk_garage';
  private step: number = 0;

  private volume: number = 0.85;
  private pan: number = 0; // -1 to +1
  private eqEnabled: boolean = true;
  private isFullTrackMode: boolean = true;
  private trackDurationSeconds: number = 192; // 3:12
  private playbackStartTime: number = 0;
  private currentElapsedSeconds: number = 0;
  private playbackRate: number = 1.0;
  private isBassBoost: boolean = false;
  private isSpatialStereo: boolean = false;
  private bassBoostFilter: BiquadFilterNode | null = null;

  // External audio element stream fallback
  private audioEl: HTMLAudioElement | null = null;
  private audioSourceNode: MediaElementAudioSourceNode | null = null;
  private isStreamingAudio: boolean = false;

  private initContext() {
    if (!this.ctx) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioContextClass();

      // Master gain
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);

      // Stereo panner
      if (this.ctx.createStereoPanner) {
        this.pannerNode = this.ctx.createStereoPanner();
        this.pannerNode.pan.setValueAtTime(this.pan, this.ctx.currentTime);
      }

      // Preamp gain
      this.preampNode = this.ctx.createGain();
      this.preampNode.gain.setValueAtTime(1.0, this.ctx.currentTime);

      // 10-Band EQ Filters
      this.eqFilters = DEFAULT_EQ_BANDS.map((band, idx) => {
        const filter = this.ctx!.createBiquadFilter();
        if (idx === 0) {
          filter.type = 'lowshelf';
        } else if (idx === DEFAULT_EQ_BANDS.length - 1) {
          filter.type = 'highshelf';
        } else {
          filter.type = 'peaking';
          filter.Q.value = 1.4;
        }
        filter.frequency.value = band.frequency;
        filter.gain.value = band.gain;
        return filter;
      });

      // Chain EQ in series
      let previousNode: AudioNode = this.preampNode;
      for (const filter of this.eqFilters) {
        previousNode.connect(filter);
        previousNode = filter;
      }

      // Analyser Node
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.75;

      // Bass Boost Filter (+6dB sub shelf at 80Hz)
      this.bassBoostFilter = this.ctx.createBiquadFilter();
      this.bassBoostFilter.type = 'lowshelf';
      this.bassBoostFilter.frequency.value = 80;
      this.bassBoostFilter.gain.value = this.isBassBoost ? 6 : 0;

      // Connect EQ chain -> Bass Boost -> Master Gain -> Panner -> Analyser -> Destination
      previousNode.connect(this.bassBoostFilter);
      this.bassBoostFilter.connect(this.masterGain);

      if (this.pannerNode) {
        this.masterGain.connect(this.pannerNode);
        this.pannerNode.connect(this.analyser);
      } else {
        this.masterGain.connect(this.analyser);
      }
      this.analyser.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public getAnalyser(): AnalyserNode | null {
    this.initContext();
    return this.analyser;
  }

  public getVolume(): number {
    return this.volume;
  }

  public setVolume(val: number) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
    if (this.audioEl) {
      this.audioEl.volume = this.volume;
    }
  }

  public getPan(): number {
    return this.pan;
  }

  public setPan(val: number) {
    this.pan = Math.max(-1, Math.min(1, val));
    if (this.pannerNode && this.ctx) {
      this.pannerNode.pan.setValueAtTime(this.pan, this.ctx.currentTime);
    }
  }

  public setEqBand(index: number, gainDb: number) {
    this.initContext();
    if (this.eqFilters[index] && this.ctx) {
      this.eqFilters[index].gain.setValueAtTime(
        this.eqEnabled ? gainDb : 0,
        this.ctx.currentTime
      );
    }
  }

  public setPreamp(gainDb: number) {
    this.initContext();
    if (this.preampNode && this.ctx) {
      const linear = Math.pow(10, gainDb / 20);
      this.preampNode.gain.setValueAtTime(linear, this.ctx.currentTime);
    }
  }

  public toggleEq(enabled: boolean, currentGains: number[]) {
    this.eqEnabled = enabled;
    this.initContext();
    if (!this.ctx) return;
    this.eqFilters.forEach((filter, i) => {
      filter.gain.setValueAtTime(enabled ? currentGains[i] : 0, this.ctx!.currentTime);
    });
  }

  public isAudioReal(): boolean {
    return this.isStreamingAudio;
  }

  public getPlaybackRate(): number {
    return this.playbackRate;
  }

  public setPlaybackRate(rate: number) {
    this.playbackRate = Math.max(0.6, Math.min(1.5, rate));
    if (this.audioEl) {
      this.audioEl.playbackRate = this.playbackRate;
    }
    // If synth timer running, update interval to match new pitch/tempo
    if (!this.isStreamingAudio && this.isRunning && this.timerId !== null) {
      clearInterval(this.timerId);
      const effectiveBpm = this.currentBpm * this.playbackRate;
      const intervalMs = (60 / effectiveBpm / 4) * 1000;
      this.timerId = window.setInterval(() => {
        if (!this.isRunning || !this.ctx) return;
        const elapsed = this.getCurrentElapsed();
        if (elapsed >= this.trackDurationSeconds) {
          this.seek(0);
        }
        this.triggerMultiPartStep(this.step % 16, Math.floor(this.step / 16));
        this.step++;
      }, intervalMs);
    }
  }

  public toggleBassBoost(): boolean {
    this.isBassBoost = !this.isBassBoost;
    this.initContext();
    if (this.bassBoostFilter && this.ctx) {
      this.bassBoostFilter.gain.setValueAtTime(
        this.isBassBoost ? 6.5 : 0,
        this.ctx.currentTime
      );
    }
    return this.isBassBoost;
  }

  public isBassBoostActive(): boolean {
    return this.isBassBoost;
  }

  public toggleSpatialStereo(): boolean {
    this.isSpatialStereo = !this.isSpatialStereo;
    this.initContext();
    if (this.pannerNode && this.ctx) {
      // Subtle stereo widening trick
      this.pannerNode.pan.setValueAtTime(
        this.isSpatialStereo ? 0.2 : this.pan,
        this.ctx.currentTime
      );
    }
    return this.isSpatialStereo;
  }

  public isSpatialStereoActive(): boolean {
    return this.isSpatialStereo;
  }

  public getWaveformData(dataArray: Uint8Array): void {
    if (this.analyser) {
      this.analyser.getByteTimeDomainData(dataArray);
    }
  }

  public isFullMode(): boolean {
    return this.isFullTrackMode;
  }

  public setFullMode(full: boolean) {
    this.isFullTrackMode = full;
    if (this.isStreamingAudio && this.audioEl && !isNaN(this.audioEl.duration) && this.audioEl.duration > 0) {
      this.trackDurationSeconds = this.audioEl.duration;
    } else {
      this.trackDurationSeconds = full ? 192 : 30;
    }
  }

  public getTrackDuration(): number {
    if (this.isStreamingAudio && this.audioEl && !isNaN(this.audioEl.duration) && this.audioEl.duration > 0) {
      return this.audioEl.duration;
    }
    return this.trackDurationSeconds;
  }

  public getCurrentElapsed(): number {
    if (!this.isRunning) return this.currentElapsedSeconds;
    if (this.isStreamingAudio && this.audioEl) {
      return this.audioEl.currentTime || 0;
    }
    const elapsed = this.currentElapsedSeconds + (Date.now() - this.playbackStartTime) / 1000;
    return Math.min(this.trackDurationSeconds, elapsed);
  }

  public seek(seconds: number) {
    const maxDur = this.getTrackDuration();
    const clamped = Math.max(0, Math.min(maxDur, seconds));
    this.currentElapsedSeconds = clamped;
    this.playbackStartTime = Date.now();

    if (this.isStreamingAudio && this.audioEl) {
      try {
        this.audioEl.currentTime = clamped;
      } catch (err) {
        console.warn('Seek error on audio element:', err);
      }
    } else {
      // Calculate approximate step based on BPM
      const beatSeconds = 60 / this.currentBpm;
      const step16Seconds = beatSeconds / 4;
      this.step = Math.floor(clamped / step16Seconds);
    }
  }

  public playTrack(bpm: number, preset: string = 'uk_garage', audioUrl?: string) {
    this.initContext();
    this.stop();

    this.currentBpm = Math.max(70, Math.min(170, bpm));
    this.currentPreset = preset;
    this.isRunning = true;
    this.playbackStartTime = Date.now();
    this.currentElapsedSeconds = 0;

    // Helper to start procedural synth if no real audio
    const startSynthFallback = () => {
      this.isStreamingAudio = false;
      if (this.timerId !== null) clearInterval(this.timerId);
      const intervalMs = (60 / this.currentBpm / 4) * 1000;
      this.timerId = window.setInterval(() => {
        if (!this.isRunning || !this.ctx) return;
        const elapsed = this.getCurrentElapsed();
        if (elapsed >= this.trackDurationSeconds) {
          this.seek(0);
        }
        this.triggerMultiPartStep(this.step % 16, Math.floor(this.step / 16));
        this.step++;
      }, intervalMs);
    };

    // If a direct audioUrl is provided, stream real music through Web Audio EQ
    if (audioUrl) {
      try {
        if (!this.audioEl) {
          this.audioEl = new Audio();
          this.audioEl.crossOrigin = 'anonymous';
          this.audioSourceNode = this.ctx!.createMediaElementSource(this.audioEl);
          this.audioSourceNode.connect(this.preampNode!);
        }

        this.audioEl.src = audioUrl;
        this.audioEl.volume = this.volume;
        this.audioEl.playbackRate = this.playbackRate;
        this.isStreamingAudio = true;

        this.audioEl.onloadedmetadata = () => {
          if (this.audioEl && !isNaN(this.audioEl.duration)) {
            this.trackDurationSeconds = this.audioEl.duration;
          }
        };

        this.audioEl.onerror = () => {
          console.warn('Real audio stream load error, switching to procedural synth fallback');
          startSynthFallback();
        };

        this.audioEl.play().catch((err) => {
          console.warn('Autoplay prevented or stream issue:', err);
          startSynthFallback();
        });
      } catch (err) {
        console.warn('MediaElementSource error, falling back to synth:', err);
        startSynthFallback();
      }
    } else {
      startSynthFallback();
    }
  }

  public stop() {
    this.isRunning = false;
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.currentTime = 0;
    }
    this.step = 0;
    this.currentElapsedSeconds = 0;
  }

  public pause() {
    if (!this.isRunning) return;
    this.currentElapsedSeconds = this.getCurrentElapsed();
    this.isRunning = false;
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.audioEl) {
      this.audioEl.pause();
    }
  }

  public resume() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.playbackStartTime = Date.now();

    if (this.isStreamingAudio && this.audioEl) {
      this.audioEl.play().catch(() => {});
    } else {
      const intervalMs = (60 / this.currentBpm / 4) * 1000;
      this.timerId = window.setInterval(() => {
        if (!this.isRunning || !this.ctx) return;
        this.triggerMultiPartStep(this.step % 16, Math.floor(this.step / 16));
        this.step++;
      }, intervalMs);
    }
  }

  // Multi-part song progression structure:
  // bar < 4: Intro / Atmospheric buildup
  // bar 4 - 12: Main beat enters
  // bar 12 - 28: Full Climax (bass drop, lead synths, chords)
  // bar 28 - 36: Breakdown (filtered pad & vocal textures, no kick)
  // bar 36 - 52: Second Drop (maximum energy, full percussion & Reese bass)
  // bar 52+: Outro fade
  private triggerMultiPartStep(step16: number, bar: number) {
    if (!this.ctx || !this.preampNode) return;
    const now = this.ctx.currentTime;
    const isBreakdown = (bar >= 28 && bar < 36);
    const isIntro = bar < 4;

    const master = this.ctx.createGain();
    master.gain.setValueAtTime(0.24, now);
    master.connect(this.preampNode);

    switch (this.currentPreset) {
      case 'uk_garage': {
        // Kick on 0 and 7 (unless breakdown)
        if (!isBreakdown && (step16 === 0 || step16 === 7)) {
          this.playKick(now, master, 115, 42);
        }
        // Crisp Rimshot on 4, 12
        if (!isIntro && (step16 === 4 || step16 === 12)) {
          this.playSnare(now, master, 270, 0.14);
        }
        // Swung 16th hats with ghost hits
        if (!isBreakdown && (step16 % 2 === 0 || step16 === 3 || step16 === 11)) {
          const velocity = step16 % 4 === 2 ? 0.35 : 0.18;
          this.playHiHat(now, master, 0.05, velocity);
        }
        // Sub Reese Bass / Organ stabs
        if (!isIntro && (step16 === 0 || step16 === 6 || step16 === 10)) {
          const bassNotes = [130.81, 146.83, 116.54, 98.0]; // C3, D3, Bb2, G2
          const note = bassNotes[(Math.floor(bar / 2)) % bassNotes.length];
          this.playBass(now, master, note, 0.3, 'sawtooth');
        }
        // Lush Chords on bar start
        if (step16 === 0) {
          this.playChord(now, master, [261.63, 311.13, 392.0, 466.16], 1.2); // Cm7
        }
        break;
      }

      case 'dark_wave': {
        // Post-punk driving 8th kick
        if (!isBreakdown && (step16 === 0 || step16 === 8)) {
          this.playKick(now, master, 125, 45);
        }
        // Goth gated reverb snare on 4, 12
        if (step16 === 4 || step16 === 12) {
          this.playSnare(now, master, 240, 0.28);
        }
        // Cold hi-hats on offbeats
        if (step16 % 2 === 1) {
          this.playHiHat(now, master, 0.08, 0.22);
        }
        // Driving Coldwave 16th bassline
        if (!isBreakdown && step16 % 2 === 0) {
          const coldNotes = [110.0, 110.0, 130.81, 98.0]; // A2, A2, C3, G2
          const note = coldNotes[(step16 / 2 + bar) % coldNotes.length];
          this.playBass(now, master, note, 0.18, 'sawtooth');
        }
        break;
      }

      case 'phonk': {
        // Heavy distorted kick
        if (!isBreakdown && (step16 === 0 || step16 === 8)) {
          this.playKick(now, master, 140, 36, 0.38);
        }
        // Hard Memphis snare on 4, 12
        if (step16 === 4 || step16 === 12) {
          this.playSnare(now, master, 340, 0.24);
        }
        // Rapid 16th hats
        this.playHiHat(now, master, 0.04, 0.22);
        // Distorted Phonk cowbell
        if (!isBreakdown && (step16 === 0 || step16 === 3 || step16 === 6 || step16 === 10 || step16 === 14)) {
          const cowbells = [587.33, 659.25, 698.46, 523.25];
          const pitch = cowbells[(step16 + bar) % cowbells.length];
          this.playCowbell(now, master, pitch);
        }
        // 808 Sub glide on downbeat
        if (!isBreakdown && step16 === 0) {
          this.play808Glide(now, master, 48.99); // G1
        }
        break;
      }

      case 'downtempo':
      case 'lofi_hiphop': {
        // Dusty relaxed kick on 0, 10
        if (!isBreakdown && (step16 === 0 || step16 === 10)) {
          this.playKick(now, master, 90, 38, 0.25);
        }
        // Snare with vinyl noise on 4, 12
        if (step16 === 4 || step16 === 12) {
          this.playSnare(now, master, 180, 0.18);
        }
        // Lazy swung hats
        if (step16 % 4 === 2 || step16 === 7 || step16 === 15) {
          this.playHiHat(now, master, 0.06, 0.15);
        }
        // Warm Rhodes chords on bar starts
        if (step16 === 0) {
          this.playRhodesChord(now, master, [220.0, 261.63, 329.63, 392.0]); // Am7
        }
        // Deep round bass
        if (!isBreakdown && (step16 === 0 || step16 === 6)) {
          this.playBass(now, master, 110.0, 0.4, 'sine');
        }
        break;
      }

      default: {
        // Minimal Techno four-on-the-floor
        if (!isBreakdown && step16 % 4 === 0) {
          this.playKick(now, master, 120, 48, 0.35);
        }
        if (step16 === 4 || step16 === 12) {
          this.playSnare(now, master, 220, 0.14);
        }
        if (step16 % 4 === 2) {
          this.playHiHat(now, master, 0.08, 0.25);
        }
        if (!isBreakdown && step16 % 2 === 1) {
          this.playBass(now, master, 65.41, 0.15, 'sawtooth');
        }
      }
    }
  }

  // Instrument sound generators
  private playKick(time: number, output: GainNode, startFreq: number, endFreq: number, gainVal = 0.32) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.frequency.setValueAtTime(startFreq, time);
    osc.frequency.exponentialRampToValueAtTime(endFreq, time + 0.12);

    gain.gain.setValueAtTime(gainVal, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);

    osc.connect(gain);
    gain.connect(output);

    osc.start(time);
    osc.stop(time + 0.24);
  }

  private playSnare(time: number, output: GainNode, toneFreq: number, duration: number) {
    if (!this.ctx) return;
    // Tonal body
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(toneFreq, time);
    osc.frequency.exponentialRampToValueAtTime(80, time + duration);
    oscGain.gain.setValueAtTime(0.2, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(oscGain);
    oscGain.connect(output);
    osc.start(time);
    osc.stop(time + duration);

    // White noise snap
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1000;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.25, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(output);
    noise.start(time);
    noise.stop(time + duration);
  }

  private playHiHat(time: number, output: GainNode, duration: number, volume: number) {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7500;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    noise.start(time);
    noise.stop(time + duration);
  }

  private playBass(time: number, output: GainNode, freq: number, duration: number, type: OscillatorType) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(550, time);
    filter.frequency.exponentialRampToValueAtTime(220, time + duration);

    gain.gain.setValueAtTime(0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(output);

    osc.start(time);
    osc.stop(time + duration);
  }

  private play808Glide(time: number, output: GainNode, baseFreq: number) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq * 2.2, time);
    osc.frequency.exponentialRampToValueAtTime(baseFreq, time + 0.12);

    gain.gain.setValueAtTime(0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.85);

    osc.connect(gain);
    gain.connect(output);

    osc.start(time);
    osc.stop(time + 0.9);
  }

  private playCowbell(time: number, output: GainNode, freq: number) {
    if (!this.ctx) return;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const bandpass = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc1.type = 'square';
    osc2.type = 'square';
    osc1.frequency.setValueAtTime(freq, time);
    osc2.frequency.setValueAtTime(freq * 1.48, time);

    bandpass.type = 'bandpass';
    bandpass.frequency.value = freq * 1.2;
    bandpass.Q.value = 3.0;

    gain.gain.setValueAtTime(0.24, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.28);

    osc1.connect(bandpass);
    osc2.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(output);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + 0.3);
    osc2.stop(time + 0.3);
  }

  private playChord(time: number, output: GainNode, freqs: number[], duration: number) {
    if (!this.ctx) return;
    freqs.forEach((freq) => {
      const osc = this.ctx!.createOscillator();
      const filter = this.ctx!.createBiquadFilter();
      const gain = this.ctx!.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, time);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1200, time);
      filter.frequency.exponentialRampToValueAtTime(450, time + duration);

      gain.gain.setValueAtTime(0.06, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(output);

      osc.start(time);
      osc.stop(time + duration);
    });
  }

  private playRhodesChord(time: number, output: GainNode, freqs: number[]) {
    if (!this.ctx) return;
    freqs.forEach((freq) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);

      gain.gain.setValueAtTime(0.08, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 1.8);

      osc.connect(gain);
      gain.connect(output);

      osc.start(time);
      osc.stop(time + 1.9);
    });
  }
}

export const soundEngine = new SoundEngine();

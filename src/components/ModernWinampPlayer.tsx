import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Sliders,
  Disc,
  ExternalLink,
  Repeat,
  Shuffle,
  Sparkles,
  Zap,
  Radio,
  Activity,
  BarChart2,
  Gauge,
  Flame,
} from 'lucide-react';
import { Track } from '../types';
import { soundEngine } from '../utils/audioEngine';
import { WinampEqualizer } from './WinampEqualizer';

interface ModernWinampPlayerProps {
  track: Track;
  onNext: () => void;
  onPrev: () => void;
  trackIndex: number;
  totalTracks: number;
  onOpenPlaylist?: () => void;
  onOpenStoryModal?: () => void;
}

export const ModernWinampPlayer: React.FC<ModernWinampPlayerProps> = ({
  track,
  onNext,
  onPrev,
  trackIndex,
  totalTracks,
  onOpenPlaylist,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(192); // default 3:12
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [pan, setPan] = useState(0);
  const [isRepeat, setIsRepeat] = useState(true);
  const [isShuffle, setIsShuffle] = useState(false);
  const [showEq, setShowEq] = useState(false);
  const [timeMode, setTimeMode] = useState<'elapsed' | 'remaining'>('elapsed');

  // New DSP sound engine controls
  const [isBassBoost, setIsBassBoost] = useState<boolean>(() => soundEngine.isBassBoostActive());
  const [isSpatial, setIsSpatial] = useState<boolean>(() => soundEngine.isSpatialStereoActive());
  const [playbackRate, setPlaybackRateState] = useState<number>(() => soundEngine.getPlaybackRate());
  const [visualizerMode, setVisualizerMode] = useState<'bars' | 'wave' | 'vu'>('bars');

  // Spectrum analyzer and VU meter states
  const [spectrumBars, setSpectrumBars] = useState<number[]>(new Array(16).fill(10));
  const [vuLeft, setVuLeft] = useState(20);
  const [vuRight, setVuRight] = useState(20);

  const animRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Sync mode with sound engine
  useEffect(() => {
    soundEngine.setFullMode(true);
    setDuration(soundEngine.getTrackDuration());
  }, []);

  // When track changes
  useEffect(() => {
    setCurrentTime(0);
    if (isPlaying) {
      soundEngine.playTrack(track.bpm, track.synthPreset, track.audioUrl);
    }
  }, [track.id]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      soundEngine.stop();
    };
  }, []);

  // Visualizer and Time update loop
  useEffect(() => {
    if (!isPlaying || isPaused) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }

    const updateLoop = () => {
      const elapsed = soundEngine.getCurrentElapsed();
      setCurrentTime(elapsed);

      // Auto advance or loop if finished
      if (elapsed >= duration && duration > 0) {
        if (isRepeat) {
          soundEngine.seek(0);
        } else {
          onNext();
        }
      }

      // Read analyser data
      const analyser = soundEngine.getAnalyser();
      if (analyser) {
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        // 16 spectrum bars
        const step = Math.floor(bufferLength / 16);
        const bars = Array.from({ length: 16 }).map((_, i) => {
          const val = dataArray[i * step] || 25;
          return Math.max(8, (val / 255) * 100);
        });
        setSpectrumBars(bars);

        // Approximate stereo VU
        const bassVal = (dataArray[1] || 40) / 255;
        const midVal = (dataArray[8] || 30) / 255;
        setVuLeft(Math.min(100, Math.max(15, bassVal * 110)));
        setVuRight(Math.min(100, Math.max(15, midVal * 105)));

        // Live Waveform Oscilloscope rendering
        if (visualizerMode === 'wave' && canvasRef.current) {
          const cvs = canvasRef.current;
          const ctx = cvs.getContext('2d');
          if (ctx) {
            const timeData = new Uint8Array(128);
            soundEngine.getWaveformData(timeData);
            ctx.clearRect(0, 0, cvs.width, cvs.height);

            // Subtle neon glow effect
            ctx.shadowBlur = 6;
            ctx.shadowColor = '#06b6d4';
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#22d3ee';
            ctx.beginPath();

            const sliceWidth = cvs.width / 128;
            let x = 0;
            for (let i = 0; i < 128; i++) {
              const v = timeData[i] / 128.0;
              const y = (v * cvs.height) / 2;
              if (i === 0) {
                ctx.moveTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }
              x += sliceWidth;
            }
            ctx.stroke();
            ctx.shadowBlur = 0; // reset
          }
        }
      } else {
        // Fallback simulation
        const t = Date.now() / 150;
        setSpectrumBars((prev) =>
          prev.map((_, i) => 15 + 75 * Math.abs(Math.sin(t + i * 0.45)))
        );
        setVuLeft(30 + 50 * Math.abs(Math.sin(t)));
        setVuRight(30 + 50 * Math.abs(Math.cos(t)));
      }

      animRef.current = requestAnimationFrame(updateLoop);
    };

    animRef.current = requestAnimationFrame(updateLoop);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [isPlaying, isPaused, duration, isRepeat, onNext, visualizerMode]);

  // Transport handlers
  const handlePlay = () => {
    if (isPaused) {
      soundEngine.resume();
      setIsPaused(false);
      setIsPlaying(true);
    } else {
      soundEngine.playTrack(track.bpm, track.synthPreset, track.audioUrl);
      setIsPlaying(true);
      setIsPaused(false);
    }
  };

  const handlePause = () => {
    soundEngine.pause();
    setIsPaused(true);
  };

  const handleStop = () => {
    soundEngine.stop();
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentTime(0);
    setSpectrumBars(new Array(16).fill(5));
    setVuLeft(5);
    setVuRight(5);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setCurrentTime(val);
    soundEngine.seek(val);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setVolume(val);
    if (isMuted) setIsMuted(false);
    soundEngine.setVolume(val);
  };

  const handleToggleMute = () => {
    if (isMuted) {
      soundEngine.setVolume(volume);
      setIsMuted(false);
    } else {
      soundEngine.setVolume(0);
      setIsMuted(true);
    }
  };

  const handlePanChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setPan(val);
    soundEngine.setPan(val);
  };

  // DSP Controls
  const handleToggleBassBoost = () => {
    const active = soundEngine.toggleBassBoost();
    setIsBassBoost(active);
  };

  const handleToggleSpatial = () => {
    const active = soundEngine.toggleSpatialStereo();
    setIsSpatial(active);
  };

  const handleSetRate = (rate: number) => {
    soundEngine.setPlaybackRate(rate);
    setPlaybackRateState(rate);
  };

  // Format mm:ss
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const displayTime =
    timeMode === 'elapsed'
      ? formatTime(currentTime)
      : `-${formatTime(Math.max(0, duration - currentTime))}`;

  return (
    <div id="speed-sound-winamp-player" className="w-full flex flex-col gap-2.5 select-none">
      {/* MAIN WINAMP CHASSIS */}
      <div className="relative w-full rounded-2xl bg-gradient-to-b from-[#111427] via-[#0b0e1b] to-[#070912] border border-[#262f55] p-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.85)] font-mono">
        {/* Ambient Top Glow in Violet & Cyan */}
        <div
          className="absolute -top-10 left-1/2 -translate-x-1/2 w-80 h-20 rounded-full filter blur-2xl opacity-25 pointer-events-none transition-colors duration-700"
          style={{ backgroundColor: track.coverColor || '#8b5cf6' }}
        />

        {/* 1. TOP TITLEBAR */}
        <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-white/10 text-[10px] text-zinc-400">
          <div className="flex items-center gap-2 font-bold tracking-widest">
            <div className="w-2.5 h-2.5 rounded-sm bg-gradient-to-r from-violet-500 to-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.7)] animate-pulse" />
            <span className="text-white tracking-wider">SPEED OF SOUND</span>
            <span className="text-zinc-600">//</span>
            <span className="text-cyan-400">
              TRK {String(trackIndex + 1).padStart(2, '0')}/{String(totalTracks).padStart(2, '0')}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Visualizer Mode Switcher */}
            <div className="flex items-center bg-black/60 rounded p-0.5 border border-white/10 text-[8px] font-bold">
              <button
                onClick={() => setVisualizerMode('bars')}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  visualizerMode === 'bars'
                    ? 'bg-cyan-500 text-black shadow-[0_0_6px_rgba(6,182,212,0.6)]'
                    : 'text-zinc-400 hover:text-white'
                }`}
                title="16-полосный спектральный анализатор"
              >
                BARS
              </button>
              <button
                onClick={() => setVisualizerMode('wave')}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  visualizerMode === 'wave'
                    ? 'bg-cyan-500 text-black shadow-[0_0_6px_rgba(6,182,212,0.6)]'
                    : 'text-zinc-400 hover:text-white'
                }`}
                title="Осциллограф звуковой волны"
              >
                WAVE
              </button>
              <button
                onClick={() => setVisualizerMode('vu')}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  visualizerMode === 'vu'
                    ? 'bg-cyan-500 text-black shadow-[0_0_6px_rgba(6,182,212,0.6)]'
                    : 'text-zinc-400 hover:text-white'
                }`}
                title="Аналоговые пиковые VU-метры"
              >
                VU
              </button>
            </div>

            {/* EQ Toggle Button */}
            <button
              onClick={() => setShowEq(!showEq)}
              className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase transition-all border ${
                showEq
                  ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white border-violet-400 shadow-[0_0_10px_rgba(139,92,246,0.4)]'
                  : 'bg-zinc-900/80 text-zinc-400 hover:text-white border-white/10'
              }`}
              title="Открыть 10-полосный эквалайзер"
            >
              EQ
            </button>

            {/* Playlist Toggle */}
            {onOpenPlaylist && (
              <button
                onClick={onOpenPlaylist}
                className="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-zinc-900/80 text-zinc-300 hover:text-white border border-white/10 transition-colors"
                title="Показать треклист"
              >
                PL
              </button>
            )}
          </div>
        </div>

        {/* 2. SAPPHIRE / VIOLET OLED DISPLAY PANEL */}
        <div className="relative rounded-xl bg-black/95 border border-cyan-500/30 p-3 mb-3 shadow-[inset_0_0_25px_rgba(6,182,212,0.12),0_0_15px_rgba(139,92,246,0.15)] overflow-hidden">
          {/* Subtle CRT scanline overlay */}
          <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(14,18,36,0)_50%,rgba(0,0,0,0.45)_50%)] bg-[length:100%_4px] opacity-40" />

          {/* Top LCD Row: Track Marquee + Real Album Artwork */}
          <div className="relative flex items-center gap-2.5 bg-zinc-950/80 rounded-lg p-1.5 mb-2.5 border border-white/10">
            {/* Artwork Thumbnail (Retina 600x600 or procedural cover) */}
            <div className="relative w-11 h-11 rounded-md overflow-hidden shrink-0 border border-cyan-500/30 bg-zinc-900 shadow-[0_0_8px_rgba(6,182,212,0.3)]">
              {track.artworkUrl ? (
                <img
                  src={track.artworkUrl}
                  alt={track.title}
                  className="w-full h-full object-cover"
                  crossOrigin="anonymous"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center text-white"
                  style={{ backgroundColor: track.coverColor || '#8b5cf6' }}
                >
                  <Disc className={`w-5 h-5 ${isPlaying && !isPaused ? 'animate-spin' : ''}`} />
                </div>
              )}
            </div>

            {/* Marquee Info */}
            <div className="flex-1 overflow-hidden">
              <div
                className={`whitespace-nowrap text-xs font-bold text-cyan-300 tracking-wider ${
                  isPlaying ? 'animate-marquee' : ''
                }`}
              >
                {trackIndex + 1}. {track.artist.toUpperCase()} — {track.title.toUpperCase()} ({track.bpm} BPM // {track.genres.join(', ')}) *** SPEED OF SOUND EDITORIAL ***
              </div>
              <div className="text-[10px] text-violet-400 font-medium truncate mt-0.5">
                {track.curatorReason || `${track.bpm} BPM • ${track.previewNote || 'Curated Electronic Selection'}`}
              </div>
            </div>
          </div>

          {/* Middle LCD Row: Time Display + Bitrate + Visualizer */}
          <div className="flex items-center justify-between gap-3">
            {/* Digital Clock */}
            <div
              onClick={() => setTimeMode(timeMode === 'elapsed' ? 'remaining' : 'elapsed')}
              className="cursor-pointer group flex flex-col shrink-0"
              title="Нажмите для переключения (Прошедшее / Оставшееся время)"
            >
              <span className="text-[9px] text-cyan-400/80 uppercase tracking-wider flex items-center gap-1">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isPlaying && !isPaused ? 'bg-cyan-400 animate-ping' : 'bg-zinc-600'
                  }`}
                />
                {timeMode === 'elapsed' ? 'ELAPSED' : 'REMAIN'}
              </span>
              <span className="text-2xl font-black text-cyan-300 tracking-widest drop-shadow-[0_0_10px_rgba(6,182,212,0.7)]">
                {displayTime}
              </span>
            </div>

            {/* Audio Specs Badges */}
            <div className="flex flex-col gap-0.5 text-[8.5px] text-zinc-400 font-bold border-l border-white/10 pl-2 shrink-0">
              <span className="text-cyan-400 flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" />
                {track.audioUrl ? '320k AAC' : 'DSP SYNTH'}
              </span>
              <span>44.1 kHz</span>
              <span className="text-violet-400">{playbackRate !== 1.0 ? `${playbackRate}x PITCH` : 'STEREO'}</span>
            </div>

            {/* Dynamic Center Visualizer (Spectrum Bars, Oscilloscope Wave, or Large VU) */}
            <div className="flex-1 flex items-center justify-center h-10 px-1 bg-zinc-950/70 rounded border border-white/5 overflow-hidden">
              {visualizerMode === 'wave' ? (
                <canvas
                  ref={canvasRef}
                  width={140}
                  height={38}
                  className="w-full h-full object-contain"
                />
              ) : visualizerMode === 'bars' ? (
                <div className="flex items-end justify-between gap-0.5 w-full h-full py-0.5">
                  {spectrumBars.map((height, i) => (
                    <div key={i} className="flex-1 flex flex-col justify-end items-center h-full">
                      <div
                        className={`w-full rounded-t-sm transition-all duration-75 ${
                          height > 80
                            ? 'bg-gradient-to-t from-violet-500 to-rose-400 shadow-[0_0_6px_#f43f5e]'
                            : height > 45
                            ? 'bg-gradient-to-t from-violet-600 to-cyan-400 shadow-[0_0_4px_rgba(6,182,212,0.6)]'
                            : 'bg-gradient-to-t from-indigo-800 to-blue-500 shadow-[0_0_3px_rgba(59,130,246,0.5)]'
                        }`}
                        style={{ height: `${height}%` }}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                /* Peak VU Graphic Meter */
                <div className="flex flex-col justify-center gap-1.5 w-full px-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[8px] text-zinc-400 font-bold w-2">L</span>
                    <div className="flex-1 h-2.5 bg-zinc-900 rounded flex gap-0.5 overflow-hidden p-0.5 border border-white/5">
                      {Array.from({ length: 12 }).map((_, idx) => (
                        <div
                          key={idx}
                          className={`flex-1 rounded-[1px] transition-opacity duration-75 ${
                            (vuLeft / 100) * 12 > idx
                              ? idx > 9
                                ? 'bg-rose-500 shadow-[0_0_5px_#f43f5e]'
                                : idx > 6
                                ? 'bg-cyan-400 shadow-[0_0_4px_rgba(6,182,212,0.6)]'
                                : 'bg-violet-500'
                              : 'bg-zinc-800/40'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[8px] text-zinc-400 font-bold w-2">R</span>
                    <div className="flex-1 h-2.5 bg-zinc-900 rounded flex gap-0.5 overflow-hidden p-0.5 border border-white/5">
                      {Array.from({ length: 12 }).map((_, idx) => (
                        <div
                          key={idx}
                          className={`flex-1 rounded-[1px] transition-opacity duration-75 ${
                            (vuRight / 100) * 12 > idx
                              ? idx > 9
                                ? 'bg-rose-500 shadow-[0_0_5px_#f43f5e]'
                                : idx > 6
                                ? 'bg-cyan-400 shadow-[0_0_4px_rgba(6,182,212,0.6)]'
                                : 'bg-violet-500'
                              : 'bg-zinc-800/40'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Compact Stereo VU Side Monitor */}
            {visualizerMode !== 'vu' && (
              <div className="flex flex-col gap-1 w-5 justify-center shrink-0">
                <div className="flex items-center gap-0.5">
                  <span className="text-[7.5px] text-zinc-500 font-bold">L</span>
                  <div className="flex-1 h-2 bg-zinc-900 rounded-sm overflow-hidden flex">
                    <div
                      className={`h-full transition-all duration-75 ${
                        vuLeft > 80 ? 'bg-rose-500' : vuLeft > 50 ? 'bg-cyan-400' : 'bg-violet-500'
                      }`}
                      style={{ width: `${vuLeft}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-0.5">
                  <span className="text-[7.5px] text-zinc-500 font-bold">R</span>
                  <div className="flex-1 h-2 bg-zinc-900 rounded-sm overflow-hidden flex">
                    <div
                      className={`h-full transition-all duration-75 ${
                        vuRight > 80 ? 'bg-rose-500' : vuRight > 50 ? 'bg-cyan-400' : 'bg-violet-500'
                      }`}
                      style={{ width: `${vuRight}%` }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 3. TIME SCRUBBER BAR */}
        <div className="mb-3 px-1">
          <div className="relative flex items-center">
            <input
              type="range"
              min="0"
              max={duration}
              step="1"
              value={currentTime}
              onChange={handleSeek}
              className="w-full h-2 bg-black/60 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-white/10"
            />
          </div>
          <div className="flex justify-between text-[9px] text-zinc-400 font-mono mt-1">
            <span className="text-cyan-400 font-bold">{formatTime(currentTime)}</span>
            <span className="text-zinc-500">
              {track.audioUrl ? 'Real Studio Audio Preview' : 'Interactive Algorithmic Synthesizer'}
            </span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* 4. MAIN TRANSPORT & VOLUME CONTROLS */}
        <div className="grid grid-cols-12 gap-2 items-center mb-3">
          {/* Transport Buttons */}
          <div className="col-span-7 flex items-center gap-1">
            <button
              onClick={onPrev}
              className="p-2 rounded-lg bg-[#161a30] hover:bg-[#1e2342] text-zinc-200 active:scale-95 border border-white/10 shadow transition-all"
              title="Предыдущий трек"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            <button
              onClick={handlePlay}
              className={`p-2.5 rounded-lg active:scale-95 border transition-all ${
                isPlaying && !isPaused
                  ? 'bg-gradient-to-r from-violet-600 to-cyan-500 text-white border-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.6)]'
                  : 'bg-[#161a30] text-white border-white/10 hover:border-cyan-400/50'
              }`}
              title="Воспроизведение"
            >
              <Play className="w-4 h-4 fill-current ml-0.5" />
            </button>

            <button
              onClick={handlePause}
              className={`p-2.5 rounded-lg active:scale-95 border transition-all ${
                isPaused
                  ? 'bg-violet-600 text-white border-violet-400 shadow-[0_0_12px_rgba(139,92,246,0.6)]'
                  : 'bg-[#161a30] text-zinc-200 border-white/10 hover:text-white'
              }`}
              title="Пауза"
            >
              <Pause className="w-4 h-4 fill-current" />
            </button>

            <button
              onClick={handleStop}
              className="p-2.5 rounded-lg bg-[#161a30] text-zinc-300 hover:text-white active:scale-95 border border-white/10 shadow transition-all"
              title="Стоп"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>

            <button
              onClick={onNext}
              className="p-2 rounded-lg bg-[#161a30] hover:bg-[#1e2342] text-zinc-200 active:scale-95 border border-white/10 shadow transition-all"
              title="Следующий трек"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>

          {/* Volume Control */}
          <div className="col-span-5 flex items-center gap-1.5 bg-black/50 p-1.5 rounded-xl border border-white/10">
            <button
              onClick={handleToggleMute}
              className="text-zinc-400 hover:text-white transition-colors"
              title={isMuted ? 'Включить звук' : 'Без звука'}
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-3.5 h-3.5 text-rose-400" />
              ) : (
                <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
            <span className="text-[9px] text-cyan-400 font-bold min-w-[28px] text-right">
              {Math.round((isMuted ? 0 : volume) * 100)}%
            </span>
          </div>
        </div>

        {/* 5. NEW ADVANCED DSP SOUND FX & SPEED PANEL */}
        <div className="p-2.5 rounded-xl bg-black/60 border border-white/10 mb-3 space-y-2">
          <div className="flex items-center justify-between text-[9px] text-zinc-400 border-b border-white/5 pb-1.5">
            <span className="font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1">
              <Zap className="w-3 h-3 text-cyan-400" />
              <span>DSP Аудио Процессор</span>
            </span>

            {/* Playback Rate / Pitch Speed Selection */}
            <div className="flex items-center gap-1">
              <span className="text-zinc-500">SPEED:</span>
              {[
                { label: '0.8x Slowed', val: 0.8 },
                { label: '1.0x Norm', val: 1.0 },
                { label: '1.2x Rush', val: 1.2 },
              ].map((item) => (
                <button
                  key={item.val}
                  onClick={() => handleSetRate(item.val)}
                  className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold transition-all ${
                    playbackRate === item.val
                      ? 'bg-cyan-500 text-black shadow-[0_0_6px_rgba(6,182,212,0.5)]'
                      : 'bg-zinc-900 text-zinc-400 hover:text-white border border-white/5'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {/* Bass Boost Toggle */}
            <button
              onClick={handleToggleBassBoost}
              className={`py-1.5 px-2.5 rounded-lg text-[10px] font-bold flex items-center justify-between transition-all border ${
                isBassBoost
                  ? 'bg-cyan-950/60 text-cyan-300 border-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.35)]'
                  : 'bg-zinc-900/80 text-zinc-400 border-white/10 hover:text-zinc-200'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Flame className={`w-3.5 h-3.5 ${isBassBoost ? 'text-cyan-400 animate-pulse' : 'text-zinc-500'}`} />
                <span>BASS BOOST +6.5dB</span>
              </div>
              <span
                className={`w-2 h-2 rounded-full ${
                  isBassBoost ? 'bg-cyan-400 shadow-[0_0_6px_#22d3ee]' : 'bg-zinc-700'
                }`}
              />
            </button>

            {/* 3D Spatial Stereo Widener */}
            <button
              onClick={handleToggleSpatial}
              className={`py-1.5 px-2.5 rounded-lg text-[10px] font-bold flex items-center justify-between transition-all border ${
                isSpatial
                  ? 'bg-violet-950/60 text-violet-300 border-violet-400 shadow-[0_0_12px_rgba(139,92,246,0.35)]'
                  : 'bg-zinc-900/80 text-zinc-400 border-white/10 hover:text-zinc-200'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Radio className={`w-3.5 h-3.5 ${isSpatial ? 'text-violet-400 animate-pulse' : 'text-zinc-500'}`} />
                <span>3D SPATIAL WIDE</span>
              </div>
              <span
                className={`w-2 h-2 rounded-full ${
                  isSpatial ? 'bg-violet-400 shadow-[0_0_6px_#a855f7]' : 'bg-zinc-700'
                }`}
              />
            </button>
          </div>
        </div>

        {/* 6. STEREO PAN & REPEAT / SHUFFLE BAR */}
        <div className="flex items-center justify-between gap-3 pt-1 border-t border-white/10 text-[10px]">
          {/* Pan Slider */}
          <div className="flex items-center gap-1.5 flex-1">
            <span className="text-[9px] text-zinc-500 font-bold">BAL</span>
            <span className="text-[8px] text-zinc-400">L</span>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.1"
              value={pan}
              onChange={handlePanChange}
              className="w-20 h-1 bg-zinc-800 rounded appearance-none accent-violet-400 cursor-pointer"
            />
            <span className="text-[8px] text-zinc-400">R</span>
          </div>

          {/* Repeat & Shuffle LEDs */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIsShuffle(!isShuffle)}
              className={`px-2 py-0.5 rounded text-[9px] font-bold flex items-center gap-1 transition-colors border ${
                isShuffle
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                  : 'bg-zinc-900/80 text-zinc-400 border-white/5'
              }`}
            >
              <Shuffle className="w-2.5 h-2.5" />
              <span>SHUF</span>
            </button>

            <button
              onClick={() => setIsRepeat(!isRepeat)}
              className={`px-2 py-0.5 rounded text-[9px] font-bold flex items-center gap-1 transition-colors border ${
                isRepeat
                  ? 'bg-violet-500/20 text-violet-300 border-violet-500/40 shadow-[0_0_8px_rgba(139,92,246,0.3)]'
                  : 'bg-zinc-900/80 text-zinc-400 border-white/5'
              }`}
            >
              <Repeat className="w-2.5 h-2.5" />
              <span>REP</span>
            </button>
          </div>
        </div>

        {/* 7. STREAMING EXPORT BUTTONS */}
        <div className="grid grid-cols-3 gap-2 mt-3 pt-2.5 border-t border-white/10">
          <a
            href={track.links.yandex}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold transition-all shadow-sm"
          >
            <span>Яндекс</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </a>

          <a
            href={track.links.spotify}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold transition-all shadow-sm"
          >
            <span>Spotify</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </a>

          <a
            href={track.links.apple}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-bold transition-all shadow-sm"
          >
            <span>Apple Music</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
      </div>

      {/* 8. COLLAPSIBLE WINAMP EQUALIZER WINDOW */}
      <WinampEqualizer isOpen={showEq} onClose={() => setShowEq(false)} />
    </div>
  );
};

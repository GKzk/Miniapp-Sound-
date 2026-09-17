import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, ExternalLink, Zap, Disc } from 'lucide-react';
import { Track } from '../types';
import { soundEngine } from '../utils/audioEngine';

interface AudioPlayerCardProps {
  track: Track;
  onNext: () => void;
  onPrev: () => void;
  trackIndex: number;
  totalTracks: number;
}

export const AudioPlayerCard: React.FC<AudioPlayerCardProps> = ({
  track,
  onNext,
  onPrev,
  trackIndex,
  totalTracks,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0 to 100
  const [isMuted, setIsMuted] = useState(false);
  const [waveHeights, setWaveHeights] = useState<number[]>(new Array(24).fill(25));
  const animRef = useRef<number | null>(null);

  // Play / Pause toggle
  const togglePlay = () => {
    if (isPlaying) {
      soundEngine.stop();
      setIsPlaying(false);
    } else {
      soundEngine.playTrack(track.bpm, track.synthPreset);
      setIsPlaying(true);
    }
  };

  // Reset or change track
  useEffect(() => {
    setProgress(0);
    if (isPlaying) {
      soundEngine.playTrack(track.bpm, track.synthPreset);
    }
    return () => {
      // Don't auto-stop on every minor change, only if track changes
    };
  }, [track.id]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      soundEngine.stop();
    };
  }, []);

  // Animation loop for waveform & progress
  useEffect(() => {
    if (!isPlaying) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }

    let startTime = Date.now();
    const duration = 24000; // 24 seconds preview loop

    const updateLoop = () => {
      const elapsed = (Date.now() - startTime) % duration;
      setProgress((elapsed / duration) * 100);

      // Fetch real analyser data if possible
      const analyser = soundEngine.getAnalyser();
      if (analyser) {
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        const newHeights = Array.from({ length: 24 }).map((_, i) => {
          const val = dataArray[i % bufferLength] || 40;
          return Math.max(15, (val / 255) * 90);
        });
        setWaveHeights(newHeights);
      } else {
        // Fallback pulsing
        setWaveHeights((prev) =>
          prev.map((_, i) => 20 + 60 * Math.abs(Math.sin((Date.now() / 200) + i * 0.4)))
        );
      }

      animRef.current = requestAnimationFrame(updateLoop);
    };

    animRef.current = requestAnimationFrame(updateLoop);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [isPlaying]);

  return (
    <div className="relative w-full rounded-3xl bg-[#0f101a]/90 backdrop-blur-xl border border-white/10 p-5 shadow-2xl overflow-hidden">
      {/* Dynamic ambient color glow */}
      <div
        className="absolute -top-16 -right-16 w-48 h-48 rounded-full filter blur-3xl opacity-20 pointer-events-none transition-colors duration-700"
        style={{ backgroundColor: track.coverColor || '#06b6d4' }}
      />

      {/* Top Bar: Track index & Curated Badge */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
          ТРЕК {trackIndex + 1} ИЗ {totalTracks}
        </span>
        <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-950/40 border border-cyan-500/30 text-[11px] font-mono text-cyan-300">
          <Zap className="w-3 h-3 text-cyan-400" />
          <span>{track.bpm} BPM</span>
          <span className="text-zinc-500">•</span>
          <span>ENERGY {track.energy}/10</span>
        </div>
      </div>

      {/* Main Track Info */}
      <div className="flex items-center gap-4 mb-5">
        {/* Cover Art Box with Vinyl look */}
        <div
          className="relative w-20 h-20 rounded-2xl flex-shrink-0 flex items-center justify-center overflow-hidden border border-white/15 shadow-lg group"
          style={{
            background: `linear-gradient(135deg, ${track.coverColor} 0%, #0a0a10 100%)`,
          }}
        >
          <Disc
            className={`w-10 h-10 text-white/70 transition-transform ${
              isPlaying ? 'animate-spin' : ''
            }`}
            style={{ animationDuration: '4s' }}
          />
          {isPlaying && (
            <div className="absolute inset-0 bg-cyan-400/10 animate-pulse pointer-events-none" />
          )}
        </div>

        {/* Title, Artist, Tags */}
        <div className="flex-1 min-w-0">
          <h4 className="text-lg font-bold text-white tracking-tight truncate leading-snug">
            {track.title}
          </h4>
          <p className="text-sm font-medium text-zinc-400 truncate mb-1.5">
            {track.artist}
          </p>
          <div className="flex flex-wrap gap-1">
            {track.genres.slice(0, 2).map((g, idx) => (
              <span
                key={idx}
                className="px-2 py-0.5 rounded-md bg-white/[0.06] text-[10px] font-mono text-zinc-300"
              >
                {g}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Waveform Scrubber Visualizer */}
      <div className="mb-4">
        <div className="h-12 flex items-center justify-between gap-1 px-1 bg-black/40 rounded-xl p-2 border border-white/5">
          {waveHeights.map((h, i) => {
            const barProgress = (i / waveHeights.length) * 100;
            const isPlayed = barProgress <= progress;
            return (
              <button
                key={i}
                onClick={() => setProgress(barProgress)}
                className="flex-1 h-full flex items-center justify-center group focus:outline-none"
                title="Перемотать"
              >
                <div
                  className={`w-full rounded-full transition-all duration-75 ${
                    isPlayed
                      ? 'bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.6)]'
                      : 'bg-white/20 group-hover:bg-white/40'
                  }`}
                  style={{ height: `${isPlaying ? h : 20}%` }}
                />
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 mt-1.5 px-1">
          <span>0:{Math.floor((progress * 0.24)).toString().padStart(2, '0')}</span>
          <span className="text-zinc-600">30s Preview • Web Audio Synth</span>
          <span>0:24</span>
        </div>
      </div>

      {/* Editorial Note */}
      <p className="text-xs text-zinc-400 italic mb-5 leading-relaxed bg-white/[0.03] p-2.5 rounded-xl border border-white/5">
        «{track.previewNote}»
      </p>

      {/* Playback Controls */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <button
          onClick={onPrev}
          className="p-3 rounded-full bg-white/5 hover:bg-white/10 active:scale-95 text-zinc-300 hover:text-white transition-all border border-white/5"
          title="Предыдущий трек"
        >
          <SkipBack className="w-5 h-5" />
        </button>

        <button
          onClick={togglePlay}
          className="flex-1 py-3.5 px-6 rounded-2xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 hover:opacity-95 active:scale-[0.98] text-white font-bold flex items-center justify-center gap-2.5 shadow-[0_0_20px_rgba(6,182,212,0.35)] transition-all"
        >
          {isPlaying ? (
            <>
              <Pause className="w-5 h-5 fill-current" />
              <span className="text-sm uppercase tracking-wider">Пауза превью</span>
            </>
          ) : (
            <>
              <Play className="w-5 h-5 fill-current ml-0.5" />
              <span className="text-sm uppercase tracking-wider">Слушать превью</span>
            </>
          )}
        </button>

        <button
          onClick={onNext}
          className="p-3 rounded-full bg-white/5 hover:bg-white/10 active:scale-95 text-zinc-300 hover:text-white transition-all border border-white/5"
          title="Следующий трек"
        >
          <SkipForward className="w-5 h-5" />
        </button>
      </div>

      {/* Streaming Export Actions */}
      <div>
        <span className="block text-[11px] font-mono uppercase tracking-wider text-zinc-500 mb-2 text-center">
          Слушать полный трек в стримингах
        </span>
        <div className="grid grid-cols-3 gap-2">
          {/* Yandex Music */}
          <a
            href={track.links.yandex}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl bg-[#ffcc00]/10 hover:bg-[#ffcc00]/20 text-[#ffcc00] border border-[#ffcc00]/30 transition-all text-xs font-semibold"
          >
            <span>Яндекс</span>
            <ExternalLink className="w-3 h-3 opacity-80" />
          </a>

          {/* Spotify */}
          <a
            href={track.links.spotify}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl bg-[#1db954]/10 hover:bg-[#1db954]/20 text-[#1db954] border border-[#1db954]/30 transition-all text-xs font-semibold"
          >
            <span>Spotify</span>
            <ExternalLink className="w-3 h-3 opacity-80" />
          </a>

          {/* Apple Music */}
          <a
            href={track.links.apple}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl bg-[#fa2d48]/10 hover:bg-[#fa2d48]/20 text-[#fa586c] border border-[#fa2d48]/30 transition-all text-xs font-semibold"
          >
            <span>Apple</span>
            <ExternalLink className="w-3 h-3 opacity-80" />
          </a>
        </div>
      </div>
    </div>
  );
};

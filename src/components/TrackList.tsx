import React from 'react';
import { Play, Disc, Sparkles } from 'lucide-react';
import { Track } from '../types';

interface TrackListProps {
  tracks: Track[];
  currentTrackId: string;
  onSelectTrack: (track: Track, index: number) => void;
}

export const TrackList: React.FC<TrackListProps> = ({
  tracks,
  currentTrackId,
  onSelectTrack,
}) => {
  return (
    <div className="w-full mt-4 space-y-2.5">
      <div className="flex items-center justify-between px-1 mb-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <h4 className="text-xs font-mono uppercase tracking-wider text-zinc-300 font-semibold">
            Саундтрек момента ({tracks.length} треков)
          </h4>
        </div>
        <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded-full border border-cyan-500/30">
          @speed_sound vault
        </span>
      </div>

      <div className="space-y-2">
        {tracks.map((track, idx) => {
          const isSelected = track.id === currentTrackId;

          return (
            <div
              key={track.id}
              onClick={() => onSelectTrack(track, idx)}
              className={`w-full text-left p-3 rounded-2xl transition-all cursor-pointer flex items-center justify-between gap-3 border ${
                isSelected
                  ? 'bg-gradient-to-r from-violet-950/50 via-indigo-950/40 to-cyan-950/40 border-cyan-500/50 shadow-[0_4px_20px_rgba(6,182,212,0.15)]'
                  : 'bg-[#0d1020]/70 border-white/5 hover:bg-[#13172e] hover:border-violet-500/30'
              }`}
            >
              {/* Left: Index & Artwork */}
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-5 text-center font-mono text-xs text-zinc-500 font-semibold shrink-0">
                  {idx + 1}
                </span>

                <div className="relative w-11 h-11 rounded-xl flex-shrink-0 overflow-hidden border border-white/10 bg-zinc-900 shadow-md">
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
                      className="w-full h-full flex items-center justify-center"
                      style={{
                        background: `linear-gradient(135deg, ${track.coverColor || '#8b5cf6'} 0%, #0c0e18 100%)`,
                      }}
                    >
                      <Disc className="w-5 h-5 text-white/70" />
                    </div>
                  )}

                  {isSelected && (
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center">
                      <div className="flex items-end gap-0.5 h-4">
                        <span className="w-1 bg-cyan-400 rounded-full animate-bounce [animation-delay:-0.3s] h-3" />
                        <span className="w-1 bg-violet-400 rounded-full animate-bounce [animation-delay:-0.15s] h-4" />
                        <span className="w-1 bg-cyan-300 rounded-full animate-bounce h-2" />
                      </div>
                    </div>
                  )}
                </div>

                <div className="truncate flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-sm text-white truncate">
                      {track.title}
                    </span>
                    {isSelected && (
                      <span className="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold bg-gradient-to-r from-violet-500 to-cyan-400 text-black shadow-sm">
                        PLAYING
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-zinc-400 truncate mt-0.5">
                    <span className="text-zinc-300 font-medium truncate">{track.artist}</span>
                    <span className="text-zinc-600">•</span>
                    <span className="text-cyan-400/90 text-[11px] font-mono">{track.bpm} BPM</span>
                    {track.timbreProfile?.brightness && (
                      <>
                        <span className="text-zinc-600 hidden sm:inline">•</span>
                        <span className="text-violet-400 text-[10px] font-mono hidden sm:inline uppercase">
                          {track.timbreProfile.brightness}
                        </span>
                      </>
                    )}
                  </div>
                  {track.curatorReason ? (
                    <p className="text-[10px] text-violet-300/80 italic truncate mt-0.5">
                      «{track.curatorReason}»
                    </p>
                  ) : track.acousticLandscape?.space_type ? (
                    <p className="text-[10px] text-cyan-300/70 truncate mt-0.5 font-mono">
                      {track.acousticLandscape.space_type}
                    </p>
                  ) : null}
                </div>
              </div>

              {/* Right: Audio Badge & Play Button */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {track.audioUrl && (
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-500/30 hidden sm:inline-block">
                    HQ AUDIO
                  </span>
                )}
                <button
                  className={`p-2.5 rounded-xl transition-all active:scale-95 ${
                    isSelected
                      ? 'bg-gradient-to-r from-violet-600 to-cyan-500 text-white shadow-[0_0_12px_rgba(6,182,212,0.5)]'
                      : 'bg-white/5 text-zinc-300 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

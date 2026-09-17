import React, { useState } from 'react';
import { Sliders, Zap, Check, RotateCcw } from 'lucide-react';
import { soundEngine, DEFAULT_EQ_BANDS } from '../utils/audioEngine';

interface WinampEqualizerProps {
  isOpen: boolean;
  onClose?: () => void;
}

const PRESETS: Record<string, number[]> = {
  'Speed of Sound': [4, 5, 2, -1, 0, 3, 4, 5, 4, 3],
  'Heavy Bass': [9, 8, 5, 1, -1, -2, 0, 2, 4, 5],
  'Electronic': [5, 4, 0, -2, -1, 2, 4, 6, 5, 4],
  'Vocal Clarity': [-2, -1, 1, 3, 5, 6, 4, 2, 1, 0],
  'Lofi Warmth': [4, 3, 2, 1, 0, -1, -3, -5, -6, -8],
  'Flat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

export const WinampEqualizer: React.FC<WinampEqualizerProps> = ({ isOpen }) => {
  const [enabled, setEnabled] = useState(true);
  const [preamp, setPreamp] = useState(0); // dB
  const [bandGains, setBandGains] = useState<number[]>(
    DEFAULT_EQ_BANDS.map((b) => b.gain)
  );
  const [activePreset, setActivePreset] = useState<string>('Speed of Sound');

  if (!isOpen) return null;

  const handleBandChange = (index: number, gain: number) => {
    const updated = [...bandGains];
    updated[index] = gain;
    setBandGains(updated);
    soundEngine.setEqBand(index, gain);
  };

  const handlePreampChange = (val: number) => {
    setPreamp(val);
    soundEngine.setPreamp(val);
  };

  const handleToggle = () => {
    const next = !enabled;
    setEnabled(next);
    soundEngine.toggleEq(next, bandGains);
  };

  const applyPreset = (name: string) => {
    const preset = PRESETS[name];
    if (!preset) return;
    setActivePreset(name);
    setBandGains(preset);
    preset.forEach((g, i) => soundEngine.setEqBand(i, g));
  };

  const resetFlat = () => {
    applyPreset('Flat');
    handlePreampChange(0);
  };

  return (
    <div className="w-full rounded-2xl bg-gradient-to-b from-[#111427] via-[#0b0e1b] to-[#070912] border border-[#262f55] p-3.5 shadow-2xl font-mono text-[11px] text-zinc-300">
      {/* Title bar */}
      <div className="flex items-center justify-between pb-2 mb-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-sm bg-gradient-to-r from-violet-500 to-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
          <span className="font-bold text-white tracking-widest uppercase">
            GRAPHIC EQUALIZER // 10-BAND STUDIO DSP
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleToggle}
            className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase transition-all flex items-center gap-1 ${
              enabled
                ? 'bg-gradient-to-r from-violet-600 to-cyan-500 text-white shadow-[0_0_10px_rgba(6,182,212,0.5)]'
                : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-white' : 'bg-zinc-600'}`} />
            {enabled ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Preset selector bar */}
      <div className="flex items-center justify-between gap-2 mb-3 overflow-x-auto pb-1 scrollbar-none">
        <div className="flex items-center gap-1">
          {Object.keys(PRESETS).map((p) => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className={`px-2 py-0.5 rounded-md text-[10px] font-semibold whitespace-nowrap transition-colors ${
                activePreset === p
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-[0_0_6px_rgba(6,182,212,0.3)]'
                  : 'bg-black/40 text-zinc-400 hover:text-white border border-white/5'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <button
          onClick={resetFlat}
          className="p-1 rounded bg-black/40 hover:bg-black/60 text-zinc-400 hover:text-white transition-colors"
          title="Сбросить в ноль"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      </div>

      {/* Equalizer Sliders Area */}
      <div className="flex items-end justify-between gap-1.5 pt-1 px-1 bg-black/50 rounded-xl p-2.5 border border-white/10">
        {/* Preamp Column */}
        <div className="flex flex-col items-center gap-1 mr-1 border-r border-white/10 pr-2">
          <span className="text-[9px] text-cyan-300 font-bold">
            {preamp > 0 ? `+${preamp}` : preamp}dB
          </span>
          <div className="relative h-28 flex items-center justify-center">
            <input
              type="range"
              min="-12"
              max="12"
              step="1"
              value={preamp}
              onChange={(e) => handlePreampChange(Number(e.target.value))}
              className="appearance-none w-28 h-1.5 bg-zinc-800 rounded-lg -rotate-90 accent-cyan-400 cursor-pointer"
            />
          </div>
          <span className="text-[9px] text-zinc-400 font-bold uppercase mt-1">PRE</span>
        </div>

        {/* 10 Frequencies */}
        {DEFAULT_EQ_BANDS.map((band, idx) => {
          const gain = bandGains[idx] ?? 0;
          return (
            <div key={band.label} className="flex-1 flex flex-col items-center gap-1">
              <span className={`text-[8px] font-bold ${gain > 0 ? 'text-cyan-300' : gain < 0 ? 'text-violet-400' : 'text-zinc-500'}`}>
                {gain > 0 ? `+${gain}` : gain}
              </span>
              <div className="relative h-28 flex items-center justify-center">
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="1"
                  disabled={!enabled}
                  value={gain}
                  onChange={(e) => handleBandChange(idx, Number(e.target.value))}
                  className={`appearance-none w-28 h-1.5 rounded-lg -rotate-90 cursor-pointer ${
                    enabled ? 'bg-zinc-800 accent-violet-400' : 'bg-zinc-900 opacity-40'
                  }`}
                />
              </div>
              <span className="text-[8px] text-zinc-400 font-mono mt-1 whitespace-nowrap">
                {band.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

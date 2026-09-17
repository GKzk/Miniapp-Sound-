import React, { useState } from 'react';
import { Activity, Waves, Volume2, Compass, ChevronDown, ChevronUp, Sparkles, Sliders } from 'lucide-react';
import type { VibeAnalysis } from '../types';

interface AcousticLandscapeCardProps {
  vibe: VibeAnalysis;
}

const BRIGHTNESS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  dark: { label: 'Тёмный (Dark)', color: 'text-indigo-400', bg: 'bg-indigo-950/60 border-indigo-500/30' },
  mellow: { label: 'Мягкий (Mellow)', color: 'text-violet-400', bg: 'bg-violet-950/60 border-violet-500/30' },
  warm: { label: 'Тёплый (Warm)', color: 'text-amber-400', bg: 'bg-amber-950/60 border-amber-500/30' },
  balanced: { label: 'Сбалансированный', color: 'text-cyan-400', bg: 'bg-cyan-950/60 border-cyan-500/30' },
  bright: { label: 'Яркий (Bright)', color: 'text-yellow-400', bg: 'bg-yellow-950/60 border-yellow-500/30' },
  crystalline: { label: 'Кристальный', color: 'text-emerald-400', bg: 'bg-emerald-950/60 border-emerald-500/30' },
};

const CURVE_TYPE_LABELS: Record<string, { title: string; subtitle: string }> = {
  hypnotic_linear: { title: 'Гипнотическая линия', subtitle: 'Монотонное медитативное движение' },
  slow_crescendo_to_drop: { title: 'Крещендо к дропу', subtitle: 'Постепенный разгон и эйфорический кульминационный сброс' },
  undulating_waves: { title: 'Волнообразный прилив', subtitle: 'Мягкие органические приливы и отливы' },
  explosive_burst: { title: 'Взрывной импульс', subtitle: 'Максимальный напор и агрессивный панч' },
  nocturnal_drift: { title: 'Ночной дрейф', subtitle: 'Невесомое парение в полумраке' },
  staccato_stomp: { title: 'Стаккато-грув', subtitle: 'Хлесткий синкопированный ритм' },
};

const STEREO_LABELS: Record<string, string> = {
  tight_mono_intimate: 'Камерное моно',
  wide_panoramic_stereo: 'Панорамное стерео',
  binaural_3d_surround: 'Бинауральное 3D окружение',
  disorienting_haas_effect: 'Психоакустический Haas-эффект',
};

export const AcousticLandscapeCard: React.FC<AcousticLandscapeCardProps> = ({ vibe }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const timbre = vibe.timbre_profile;
  const energyCurve = vibe.energy_curve;
  const acoustic = vibe.acoustic_landscape;

  if (!timbre && !energyCurve && !acoustic && !vibe.synesthetic_transduction) {
    return null;
  }

  const brightnessInfo = timbre?.brightness ? BRIGHTNESS_LABELS[timbre.brightness] || {
    label: timbre.brightness,
    color: 'text-cyan-300',
    bg: 'bg-cyan-950/60 border-cyan-500/30',
  } : null;

  const curveInfo = energyCurve?.curve_type ? CURVE_TYPE_LABELS[energyCurve.curve_type] || {
    title: energyCurve.curve_type,
    subtitle: '',
  } : null;

  return (
    <div className="rounded-3xl bg-gradient-to-br from-[#0c0e1c] via-[#090b16] to-[#06070e] border border-cyan-500/20 p-4 shadow-xl text-left overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between pb-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-cyan-950/80 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Sliders className="w-3.5 h-3.5" />
          </div>
          <div>
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-200">
              Акустический ландшафт & тембр
            </h3>
            <span className="text-[10px] font-mono text-zinc-400">
              Синестетический звуковой анализ @speed_sound
            </span>
          </div>
        </div>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-[11px] font-mono text-cyan-400 hover:text-cyan-300 bg-cyan-950/40 hover:bg-cyan-950/70 px-2.5 py-1 rounded-full border border-cyan-500/30 transition-all"
        >
          <span>{isExpanded ? 'Свернуть' : 'Детали'}</span>
          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {/* Synesthetic Transduction Quote */}
      {vibe.synesthetic_transduction && (
        <div className="mt-3 p-3 rounded-2xl bg-cyan-950/20 border border-cyan-500/20 flex items-start gap-2.5">
          <Sparkles className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-cyan-100/90 leading-relaxed font-medium italic">
            «{vibe.synesthetic_transduction}»
          </p>
        </div>
      )}

      {/* Summary Chips Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3 text-xs font-mono">
        {brightnessInfo && (
          <div className={`p-2.5 rounded-xl border ${brightnessInfo.bg} flex flex-col justify-between`}>
            <span className="text-[10px] text-zinc-400 flex items-center gap-1">
              <Volume2 className="w-3 h-3" />
              <span>ТЕМБР</span>
            </span>
            <span className={`font-bold mt-1 text-xs ${brightnessInfo.color}`}>
              {brightnessInfo.label}
            </span>
          </div>
        )}

        {curveInfo && (
          <div className="p-2.5 rounded-xl border border-violet-500/30 bg-violet-950/40 flex flex-col justify-between">
            <span className="text-[10px] text-zinc-400 flex items-center gap-1">
              <Activity className="w-3 h-3 text-violet-400" />
              <span>КРИВАЯ ЭНЕРГИИ</span>
            </span>
            <span className="font-bold text-violet-300 mt-1 text-xs truncate">
              {curveInfo.title}
            </span>
          </div>
        )}

        {acoustic && (
          <div className="p-2.5 rounded-xl border border-emerald-500/30 bg-emerald-950/40 flex flex-col justify-between col-span-2 sm:col-span-1">
            <span className="text-[10px] text-zinc-400 flex items-center gap-1">
              <Compass className="w-3 h-3 text-emerald-400" />
              <span>RT60 REVERB</span>
            </span>
            <span className="font-bold text-emerald-300 mt-1 text-xs truncate">
              {acoustic.reverb_decay_time || '3.2s diffuse'}
            </span>
          </div>
        )}
      </div>

      {/* Expandable In-Depth Engineering Details */}
      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-white/5 space-y-3">
          {/* 1. Timbre Profile Details */}
          {timbre && (
            <div className="p-3 rounded-2xl bg-black/40 border border-white/5 space-y-1.5">
              <div className="flex items-center gap-1.5 text-cyan-300 text-xs font-mono font-bold">
                <Volume2 className="w-3.5 h-3.5" />
                <span>Физика тембра</span>
              </div>
              <p className="text-xs text-zinc-200">
                <strong className="text-zinc-400 font-mono text-[11px]">Фактура: </strong>
                {timbre.texture}
              </p>
              <p className="text-xs text-zinc-200">
                <strong className="text-zinc-400 font-mono text-[11px]">Сатурация и шум: </strong>
                {timbre.grain_and_saturation}
              </p>
              <p className="text-xs text-zinc-200">
                <strong className="text-zinc-400 font-mono text-[11px]">Частотный вес: </strong>
                {timbre.spectral_weight}
              </p>
            </div>
          )}

          {/* 2. Energy Curve Details */}
          {energyCurve && (
            <div className="p-3 rounded-2xl bg-black/40 border border-white/5 space-y-1.5">
              <div className="flex items-center gap-1.5 text-violet-300 text-xs font-mono font-bold">
                <Waves className="w-3.5 h-3.5" />
                <span>Кривая динамики и грув</span>
              </div>
              <p className="text-xs text-zinc-200">
                <strong className="text-zinc-400 font-mono text-[11px]">Ощущение грува: </strong>
                {energyCurve.tempo_feel}
              </p>
              <p className="text-xs text-zinc-200">
                <strong className="text-zinc-400 font-mono text-[11px]">Саспенс / Напряжение: </strong>
                {energyCurve.dynamic_tension}
              </p>
            </div>
          )}

          {/* 3. Acoustic Landscape Details */}
          {acoustic && (
            <div className="p-3 rounded-2xl bg-black/40 border border-white/5 space-y-2">
              <div className="flex items-center gap-1.5 text-emerald-300 text-xs font-mono font-bold">
                <Compass className="w-3.5 h-3.5" />
                <span>Виртуальное пространство</span>
              </div>
              <p className="text-xs text-zinc-200">
                <strong className="text-zinc-400 font-mono text-[11px]">Тип пространства: </strong>
                {acoustic.space_type}
              </p>
              <p className="text-xs text-zinc-200">
                <strong className="text-zinc-400 font-mono text-[11px]">Стереополе: </strong>
                {STEREO_LABELS[acoustic.stereo_dimension] || acoustic.stereo_dimension}
              </p>

              {acoustic.environmental_cues && acoustic.environmental_cues.length > 0 && (
                <div>
                  <span className="text-[10px] font-mono text-zinc-400 block mb-1">
                    Фоли-шумы окружения:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {acoustic.environmental_cues.map((cue, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded-md bg-emerald-950/40 text-[10px] font-mono text-emerald-300 border border-emerald-500/20"
                      >
                        • {cue}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

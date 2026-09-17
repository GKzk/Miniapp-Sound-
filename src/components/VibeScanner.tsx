import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Activity, Sparkles, Disc3, Radio } from 'lucide-react';

interface VibeScannerProps {
  photoPreview?: string | null;
  moodText?: string | null;
}

export const VibeScanner: React.FC<VibeScannerProps> = ({ photoPreview, moodText }) => {
  const [activeStep, setActiveStep] = useState(0);
  const [detectedTags, setDetectedTags] = useState<string[]>([]);

  const steps = [
    { title: 'Сканирование спектра и настроения визуала...', tag: '#DeepAnalysis' },
    { title: 'Замер эмоционального давления и темпа BPM...', tag: '#BPM_Scan' },
    { title: 'Поиск совпадений в кураторском хранилище @speed_sound...', tag: '#SpeedSound_Vault' },
    { title: 'Сведение идеального саундтрека момента...', tag: '#VibeMatched' },
  ];

  useEffect(() => {
    const timer1 = setTimeout(() => {
      setActiveStep(1);
      setDetectedTags((prev) => [...prev, '#NeonVibe', '#130BPM']);
    }, 600);

    const timer2 = setTimeout(() => {
      setActiveStep(2);
      setDetectedTags((prev) => [...prev, '#UK_Garage', '#Melancholy']);
    }, 1400);

    const timer3 = setTimeout(() => {
      setActiveStep(3);
      setDetectedTags((prev) => [...prev, '#DarkElectronic', '#NightDrive']);
    }, 2200);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, []);

  return (
    <div className="relative w-full rounded-3xl overflow-hidden bg-[#0a0a12] border border-white/10 p-6 flex flex-col items-center justify-center min-h-[440px] shadow-2xl">
      {/* Background preview blur */}
      {photoPreview && (
        <div
          className="absolute inset-0 bg-cover bg-center opacity-25 filter blur-xl transform scale-110"
          style={{ backgroundImage: `url(${photoPreview})` }}
        />
      )}

      {/* Cyberpunk Scan Grid & Radar Overlay */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(#06b6d4_1px,transparent_1px)] [background-size:24px_24px] opacity-15" />

      {/* Sweeping Laser Line in Cyan & Violet */}
      <motion.div
        className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_18px_#06b6d4]"
        animate={{
          top: ['0%', '100%', '0%'],
        }}
        transition={{
          duration: 2.2,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Radar Center Disc */}
      <div className="relative z-10 flex flex-col items-center text-center">
        <div className="relative w-28 h-28 rounded-full border border-cyan-500/30 flex items-center justify-center mb-6 shadow-[0_0_35px_rgba(6,182,212,0.25)] bg-[#070914]/80 backdrop-blur-md">
          {/* Animated concentric ripples */}
          <motion.div
            className="absolute inset-0 rounded-full border border-violet-500/40"
            animate={{ scale: [1, 1.4, 1.8], opacity: [0.8, 0.4, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
          />
          <motion.div
            className="absolute inset-2 rounded-full border border-dashed border-cyan-400/60"
            animate={{ rotate: 360 }}
            transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
          />
          <Disc3 className="w-12 h-12 text-cyan-400 animate-spin" style={{ animationDuration: '3s' }} />
        </div>

        {/* Live Status Label */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-950/60 border border-cyan-500/40 text-cyan-300 text-xs font-mono font-medium mb-3 shadow-[0_0_12px_rgba(6,182,212,0.2)]">
          <Activity className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
          <span>VIBE SCANNER 3.0 // DEEP MULTIMODAL</span>
        </div>

        <h3 className="text-lg font-bold text-white tracking-tight mb-1">
          {steps[activeStep]?.title}
        </h3>
        <p className="text-xs text-zinc-400 font-mono max-w-xs">
          {moodText ? `Промпт: "${moodText}"` : 'Анализируем освещение, контраст и эмоциональный заряд'}
        </p>

        {/* Frequency visualizer bars */}
        <div className="flex items-end justify-center gap-1.5 h-10 my-6">
          {[40, 75, 55, 95, 30, 85, 60, 100, 45, 90, 70, 40].map((h, idx) => (
            <motion.div
              key={idx}
              className="w-1.5 rounded-full bg-gradient-to-t from-violet-600 via-blue-500 to-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.6)]"
              animate={{
                height: [`${h * 0.2}%`, `${h}%`, `${h * 0.4}%`],
              }}
              transition={{
                duration: 0.8 + (idx % 3) * 0.2,
                repeat: Infinity,
                repeatType: 'reverse',
                ease: 'easeInOut',
              }}
            />
          ))}
        </div>

        {/* Dynamic detected tags output */}
        <div className="flex flex-wrap justify-center gap-2 max-w-sm">
          {detectedTags.map((tag, i) => (
            <motion.span
              key={i}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="px-2.5 py-1 rounded-lg bg-zinc-900/90 border border-violet-500/30 text-[11px] font-mono font-semibold text-zinc-200 shadow-sm flex items-center gap-1"
            >
              <Sparkles className="w-2.5 h-2.5 text-cyan-400" />
              {tag}
            </motion.span>
          ))}
        </div>
      </div>
    </div>
  );
};

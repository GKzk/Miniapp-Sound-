import React, { useState } from 'react';
import { Lock, Radio, ExternalLink, CheckCircle2, ArrowRight } from 'lucide-react';

interface SubscriptionGateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmSubscribed: () => void;
  channelUsername?: string;
}

export const SubscriptionGateModal: React.FC<SubscriptionGateModalProps> = ({
  isOpen,
  onClose,
  onConfirmSubscribed,
  channelUsername = '@speed_sound',
}) => {
  const [checking, setChecking] = useState(false);

  if (!isOpen) return null;

  const handleCheck = () => {
    setChecking(true);
    setTimeout(() => {
      setChecking(false);
      onConfirmSubscribed();
    }, 700);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="relative w-full max-w-sm rounded-3xl bg-gradient-to-b from-[#15162e] to-[#090b16] border border-cyan-500/30 p-6 shadow-[0_0_50px_rgba(6,182,212,0.2)] text-center">
        {/* Glowing lock icon */}
        <div className="relative w-16 h-16 mx-auto mb-4 rounded-2xl bg-cyan-500/10 border border-cyan-500/40 flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.25)]">
          <Lock className="w-8 h-8 text-cyan-400" />
        </div>

        {/* Title */}
        <h3 className="text-xl font-extrabold text-white tracking-tight mb-2">
          Бесплатный лимит исчерпан
        </h3>

        {/* Explanation */}
        <p className="text-sm text-zinc-300 leading-relaxed mb-6">
          Первый саундтрек был подарком редакции! Чтобы открывать <span className="text-cyan-300 font-semibold">безлимитный ИИ-саундтрек</span> для каждого момента — подпишись на наш канал.
        </p>

        {/* Channel card box */}
        <div className="p-3.5 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-between gap-3 mb-6 text-left">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#1c1a36] to-[#0c0e1a] border border-cyan-500/40 flex items-center justify-center text-cyan-400">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h5 className="text-sm font-bold text-white">Speed of Sound</h5>
              <p className="text-xs font-mono text-cyan-400">{channelUsername}</p>
            </div>
          </div>

          <a
            href="https://t.me/speed_sound"
            target="_blank"
            rel="noreferrer"
            className="py-1.5 px-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium text-xs flex items-center gap-1 transition-colors"
          >
            <span>Перейти</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {/* Main CTA */}
        <div className="space-y-2.5">
          <a
            href="https://t.me/speed_sound"
            target="_blank"
            rel="noreferrer"
            className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 hover:opacity-95 active:scale-[0.98] text-white font-bold flex items-center justify-center gap-2 text-sm shadow-[0_0_20px_rgba(6,182,212,0.35)] transition-all"
          >
            <span>Подписаться на Speed of Sound</span>
            <ArrowRight className="w-4 h-4" />
          </a>

          <button
            onClick={handleCheck}
            disabled={checking}
            className="w-full py-3 px-4 rounded-2xl bg-white/5 hover:bg-white/10 active:scale-[0.98] text-zinc-200 font-semibold text-xs transition-colors flex items-center justify-center gap-2 border border-white/10"
          >
            {checking ? (
              <>
                <div className="w-3.5 h-3.5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                <span>Проверяем подписку...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>Я подписался (Разблокировать)</span>
              </>
            )}
          </button>
        </div>

        <button
          onClick={onClose}
          className="mt-4 text-xs text-zinc-500 hover:text-zinc-400 transition-colors font-mono"
        >
          Вернуться назад
        </button>
      </div>
    </div>
  );
};

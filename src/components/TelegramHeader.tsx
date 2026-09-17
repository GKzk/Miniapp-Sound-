import React from 'react';
import { Radio, ExternalLink, ShieldCheck, UserCheck, User, Bookmark } from 'lucide-react';
import { TelegramUser, UserProfile } from '../types';

interface TelegramHeaderProps {
  user: TelegramUser;
  currentUser: UserProfile | null;
  onToggleSubscription: () => void;
  onOpenProfile: () => void;
  generationCount: number;
}

export const TelegramHeader: React.FC<TelegramHeaderProps> = ({
  user,
  currentUser,
  onToggleSubscription,
  onOpenProfile,
  generationCount,
}) => {
  return (
    <header className="sticky top-0 z-40 w-full bg-[#08080c]/90 backdrop-blur-md border-b border-white/[0.08] px-4 py-2.5">
      <div className="max-w-md mx-auto flex items-center justify-between">
        {/* Left: Channel branding */}
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-[#1c1a36] to-[#0c0e1a] border border-cyan-500/40 shadow-[0_0_12px_rgba(6,182,212,0.25)]">
            <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-violet-400 rounded-full ring-2 ring-[#08080c]" />
          </div>
          <div>
            <div className="flex items-center gap-1">
              <span className="font-bold text-xs tracking-tight text-white">Speed of Sound</span>
              <ShieldCheck className="w-3 h-3 text-cyan-400" />
            </div>
            <a
              href="https://t.me/speed_sound"
              target="_blank"
              rel="noreferrer"
              className="text-[10px] font-mono text-zinc-400 hover:text-cyan-400 transition-colors flex items-center gap-1"
            >
              @speed_sound
              <ExternalLink className="w-2 h-2" />
            </a>
          </div>
        </div>

        {/* Right: User Profile & Subscription Status */}
        <div className="flex items-center gap-1.5">
          {/* Profile / History Button */}
          <button
            onClick={onOpenProfile}
            className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-all flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-white border border-white/10"
            title="Открыть профиль и историю сохранений"
          >
            {currentUser ? (
              <>
                <div className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.8)]" />
                <span className="truncate max-w-[80px]">{currentUser.displayName}</span>
              </>
            ) : (
              <>
                <User className="w-3 h-3 text-zinc-400" />
                <span>Профиль</span>
              </>
            )}
          </button>

          {/* Subscribed badge */}
          <button
            onClick={onToggleSubscription}
            title={user.is_subscribed ? 'Подписка активна (нажмите для теста гейта)' : 'Подписка не подтверждена'}
            className={`px-2 py-1 rounded-full text-[10px] font-medium transition-all flex items-center gap-1 border ${
              user.is_subscribed
                ? 'bg-gradient-to-r from-violet-500/20 to-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-[0_0_8px_rgba(6,182,212,0.2)]'
                : 'bg-zinc-800/80 text-zinc-400 border-zinc-700'
            }`}
          >
            <UserCheck className={`w-2.5 h-2.5 ${user.is_subscribed ? 'text-cyan-400' : 'text-zinc-500'}`} />
            <span>{user.is_subscribed ? 'PRO' : `#${generationCount}`}</span>
          </button>
        </div>
      </div>
    </header>
  );
};

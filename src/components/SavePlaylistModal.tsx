import React, { useState } from 'react';
import { Bookmark, X, Tag, Sparkles, Check, Music } from 'lucide-react';
import { Track, VibeAnalysis, UserProfile, SavedPlaylist } from '../types';

interface SavePlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile | null;
  vibe: VibeAnalysis;
  tracks: Track[];
  photoUrl?: string | null;
  moodText?: string;
  onSavedSuccess: (saved: SavedPlaylist) => void;
  onPromptLogin: () => void;
}

export const SavePlaylistModal: React.FC<SavePlaylistModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  vibe,
  tracks,
  photoUrl,
  moodText,
  onSavedSuccess,
  onPromptLogin,
}) => {
  const defaultName = moodText
    ? `Вайб: ${moodText.slice(0, 30)}`
    : `Саундтрек: ${vibe.location_setting || 'Ночной город'}`;

  const [playlistName, setPlaylistName] = useState(defaultName);
  const [tagsInput, setTagsInput] = useState(
    (vibe.mood_tags || []).slice(0, 3).map((t) => t.replace('#', '')).join(', ')
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onPromptLogin();
      return;
    }

    setIsSaving(true);
    setError(null);

    const customTags = tagsInput
      .split(',')
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean);

    try {
      const res = await fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          authorName: currentUser.displayName,
          name: playlistName.trim() || 'Саундтрек момента',
          customTags,
          vibe,
          tracks,
          photoUrl: photoUrl || undefined,
          moodText,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.playlist) {
        throw new Error(data.error || 'Ошибка сохранения плейлиста');
      }

      onSavedSuccess(data.playlist);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="relative w-full max-w-sm rounded-3xl bg-[#0e101a] border border-white/10 p-5 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Bookmark className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white tracking-tight">
              Сохранить саундтрек в профиль
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-3.5">
          {/* Playlist Cover & Tracks Preview */}
          <div className="p-3 rounded-2xl bg-black/40 border border-white/5 flex items-center gap-3">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt="Cover"
                className="w-14 h-14 rounded-xl object-cover border border-white/10 flex-shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center flex-shrink-0 text-cyan-400">
                <Music className="w-6 h-6" />
              </div>
            )}
            <div className="min-w-0">
              <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider block">
                {tracks.length} ТРЕКОВ • {vibe.target_bpm} BPM
              </span>
              <p className="text-xs text-zinc-300 truncate font-medium mt-0.5">
                {vibe.genres.join(', ')}
              </p>
            </div>
          </div>

          {/* Name Field */}
          <div>
            <label className="block text-[11px] font-mono text-zinc-400 uppercase tracking-wider mb-1">
              Название подборки
            </label>
            <input
              type="text"
              required
              value={playlistName}
              onChange={(e) => setPlaylistName(e.target.value)}
              placeholder="напр. Ночной дождь из окна такси"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm text-white focus:outline-none focus:border-cyan-400"
            />
          </div>

          {/* Custom Tags Field */}
          <div>
            <label className="block text-[11px] font-mono text-zinc-400 uppercase tracking-wider mb-1">
              Теги подборки (через запятую)
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="ночь, дождь, авто, лоуфай..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm text-white focus:outline-none focus:border-cyan-400"
            />
          </div>

          {error && (
            <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              {error}
            </div>
          )}

          {!currentUser && (
            <div className="p-2.5 rounded-xl bg-cyan-950/60 border border-cyan-500/30 text-cyan-300 text-xs">
              💡 Чтобы сохранить плейлист, вам нужно войти или зарегистрировать профиль.
            </div>
          )}

          <button
            type="submit"
            disabled={isSaving}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 hover:opacity-95 text-white font-bold text-sm shadow-[0_0_15px_rgba(6,182,212,0.35)] transition-all flex items-center justify-center gap-2"
          >
            {isSaving ? (
              <span>Сохранение...</span>
            ) : currentUser ? (
              <>
                <Check className="w-4 h-4" />
                <span>Сохранить в профиль</span>
              </>
            ) : (
              <span>Войти и сохранить</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

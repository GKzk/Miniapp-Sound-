import React, { useState } from 'react';
import {
  Share2,
  X,
  Copy,
  Check,
  Plus,
  Music,
  ExternalLink,
  MessageSquare,
  Sparkles,
  User,
} from 'lucide-react';
import { SavedPlaylist, Track } from '../types';
import { SPEED_SOUND_TRACKS } from '../data/tracks';

interface SharedPlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  playlist: SavedPlaylist;
  onTrackAddedSuccess: (updated: SavedPlaylist) => void;
}

export const SharedPlaylistModal: React.FC<SharedPlaylistModalProps> = ({
  isOpen,
  onClose,
  playlist,
  onTrackAddedSuccess,
}) => {
  const [copied, setCopied] = useState(false);
  const [isAddingTrack, setIsAddingTrack] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState<string>('');
  const [friendName, setFriendName] = useState('');
  const [friendComment, setFriendComment] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  if (!isOpen) return null;

  const shareUrl = `${window.location.origin}/?share=${playlist.shareCode}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const handleAddTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTrackId) {
      setAddError('Выберите трек для добавления');
      return;
    }

    const trackToAdd = SPEED_SOUND_TRACKS.find((t) => t.id === selectedTrackId);
    if (!trackToAdd) return;

    setIsSubmitting(true);
    setAddError(null);

    try {
      const res = await fetch(`/api/playlists/share/${playlist.shareCode}/add-track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          track: trackToAdd,
          addedBy: friendName.trim() || 'Друг',
          comment: friendComment.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.playlist) {
        throw new Error(data.error || 'Не удалось добавить трек');
      }

      onTrackAddedSuccess(data.playlist);
      setIsAddingTrack(false);
      setSelectedTrackId('');
      setFriendComment('');
    } catch (err: any) {
      setAddError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredTracks = SPEED_SOUND_TRACKS.filter(
    (t) =>
      t.title.toLowerCase().includes(searchFilter.toLowerCase()) ||
      t.artist.toLowerCase().includes(searchFilter.toLowerCase()) ||
      t.genres.some((g) => g.toLowerCase().includes(searchFilter.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3">
      <div className="relative w-full max-w-md rounded-3xl bg-[#0e101a] border border-white/10 p-5 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white tracking-tight">
              Поделиться саундтреком
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Shareable Link Box */}
          <div className="p-3.5 rounded-2xl bg-black/40 border border-white/10 space-y-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 block">
              Прямая ссылка для друзей:
            </span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={shareUrl}
                className="flex-1 px-3 py-2 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-zinc-300 select-all"
              />
              <button
                onClick={handleCopy}
                className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 hover:opacity-95 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm flex-shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Скопировано!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Копировать</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-[10px] text-zinc-500 font-mono">
              Друзья смогут послушать эту подборку и добавить в нее свои любимые треки!
            </p>
          </div>

          {/* Collaborative Section: Collaborative Tracks List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span>Коллаборация с друзьями</span>
              </span>
              <button
                onClick={() => setIsAddingTrack(!isAddingTrack)}
                className="px-2.5 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-xs text-cyan-300 font-semibold flex items-center gap-1 border border-cyan-500/30 transition-colors"
              >
                <Plus className="w-3 h-3" />
                <span>Добавить трек</span>
              </button>
            </div>

            {/* List of already added collaborative tracks */}
            {playlist.collaborativeTracks && playlist.collaborativeTracks.length > 0 ? (
              <div className="space-y-1.5 mb-3">
                {playlist.collaborativeTracks.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-white truncate">
                          {item.track.title}
                        </span>
                        <span className="text-[10px] font-mono text-zinc-400">
                          — {item.track.artist}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] font-mono text-zinc-400">
                        <span className="text-cyan-400 font-semibold">
                          от {item.addedBy}
                        </span>
                        {item.comment && (
                          <span className="italic truncate text-zinc-500">
                            «{item.comment}»
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-cyan-400 flex-shrink-0">
                      {item.track.bpm} BPM
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-zinc-500 font-mono italic mb-3">
                Пока никто из друзей не добавил треков. Будьте первыми!
              </p>
            )}
          </div>

          {/* Add Track Form (Collaborative) */}
          {isAddingTrack && (
            <form
              onSubmit={handleAddTrack}
              className="p-3.5 rounded-2xl bg-black/60 border border-cyan-500/40 space-y-3"
            >
              <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                Добавить трек из каталога @speed_sound
              </h4>

              {/* Friend's Name */}
              <div>
                <label className="block text-[10px] font-mono text-zinc-400 uppercase mb-1">
                  Ваше имя:
                </label>
                <input
                  type="text"
                  required
                  value={friendName}
                  onChange={(e) => setFriendName(e.target.value)}
                  placeholder="напр. Даня"
                  className="w-full px-3 py-2 rounded-xl bg-black/80 border border-white/10 text-xs text-white focus:outline-none focus:border-cyan-400"
                />
              </div>

              {/* Track Search & Selector */}
              <div>
                <label className="block text-[10px] font-mono text-zinc-400 uppercase mb-1">
                  Поиск и выбор трека:
                </label>
                <input
                  type="text"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Поиск по названию, артисту или жанру..."
                  className="w-full px-3 py-1.5 rounded-lg bg-black/80 border border-white/10 text-xs text-white mb-1.5 focus:outline-none focus:border-cyan-400"
                />
                <select
                  required
                  value={selectedTrackId}
                  onChange={(e) => setSelectedTrackId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-white/15 text-xs text-white focus:outline-none focus:border-cyan-400"
                >
                  <option value="">-- Выберите трек из каталога --</option>
                  {filteredTracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.artist} — {t.title} ({t.bpm} BPM, {t.genres[0]})
                    </option>
                  ))}
                </select>
              </div>

              {/* Note / Comment */}
              <div>
                <label className="block text-[10px] font-mono text-zinc-400 uppercase mb-1">
                  Комментарий к треку (опционально):
                </label>
                <input
                  type="text"
                  value={friendComment}
                  onChange={(e) => setFriendComment(e.target.value)}
                  placeholder="напр. этот трек идеально подходит под фото!"
                  className="w-full px-3 py-2 rounded-xl bg-black/80 border border-white/10 text-xs text-white focus:outline-none focus:border-cyan-400"
                />
              </div>

              {addError && (
                <p className="text-xs text-rose-400 font-mono">{addError}</p>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={isSubmitting || !selectedTrackId}
                  className="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 hover:opacity-95 text-white font-bold text-xs transition-all disabled:opacity-50 shadow-md"
                >
                  {isSubmitting ? 'Добавление...' : 'Добавить в подборку'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddingTrack(false)}
                  className="py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 text-xs"
                >
                  Отмена
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

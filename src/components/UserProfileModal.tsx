import React, { useState, useEffect } from 'react';
import {
  User,
  X,
  LogIn,
  UserPlus,
  Bookmark,
  Calendar,
  Tag,
  Play,
  Share2,
  Trash2,
  Edit2,
  Check,
  Radio,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import { UserProfile, SavedPlaylist, Track } from '../types';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile | null;
  onLoginSuccess: (user: UserProfile) => void;
  onLogout: () => void;
  onLoadPlaylist: (playlist: SavedPlaylist) => void;
  onSharePlaylist: (playlist: SavedPlaylist) => void;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onLoginSuccess,
  onLogout,
  onLoadPlaylist,
  onSharePlaylist,
}) => {
  const [activeTab, setActiveTab] = useState<'history' | 'login' | 'register'>('history');
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Playlists History State
  const [playlists, setPlaylists] = useState<SavedPlaylist[]>([]);
  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editTags, setEditTags] = useState('');
  const [tagFilter, setTagFilter] = useState<string>('all');

  // Load history when modal opens or user changes
  useEffect(() => {
    if (isOpen && currentUser) {
      fetchUserPlaylists(currentUser.id);
      setActiveTab('history');
    } else if (isOpen && !currentUser) {
      setActiveTab('login');
    }
  }, [isOpen, currentUser]);

  const fetchUserPlaylists = async (userId: string) => {
    try {
      const res = await fetch(`/api/playlists/user/${userId}`);
      const data = await res.json();
      if (data.playlists) {
        setPlaylists(data.playlists);
      }
    } catch (err) {
      console.error('Error fetching user playlists:', err);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameInput, password: passwordInput }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Ошибка входа');
      }
      onLoginSuccess(data.user);
      setActiveTab('history');
      fetchUserPlaylists(data.user.id);
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: usernameInput,
          password: passwordInput,
          displayName: displayNameInput || usernameInput,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Ошибка регистрации');
      }
      onLoginSuccess(data.user);
      setActiveTab('history');
      fetchUserPlaylists(data.user.id);
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveEdit = async (id: string) => {
    if (!currentUser) return;
    try {
      const tagsArray = editTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await fetch(`/api/playlists/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          name: editName,
          customTags: tagsArray,
        }),
      });
      const data = await res.json();
      if (data.playlist) {
        setPlaylists((prev) =>
          prev.map((p) => (p.id === id ? data.playlist : p))
        );
        setEditingPlaylistId(null);
      }
    } catch (err) {
      console.error('Error updating playlist:', err);
    }
  };

  const handleDeletePlaylist = async (id: string) => {
    if (!currentUser) return;
    if (!window.confirm('Удалить эту подборку из профиля?')) return;
    try {
      await fetch(`/api/playlists/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id }),
      });
      setPlaylists((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error('Error deleting playlist:', err);
    }
  };

  // Collect all unique tags for filtering
  const allTags = Array.from(
    new Set(playlists.flatMap((p) => p.customTags || []))
  );

  const filteredPlaylists =
    tagFilter === 'all'
      ? playlists
      : playlists.filter((p) => p.customTags?.includes(tagFilter));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3">
      <div className="relative w-full max-w-md rounded-3xl bg-[#0e101a] border border-white/10 p-5 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* Top Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <User className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">
                {currentUser ? currentUser.displayName : 'Профиль слушателя'}
              </h3>
              <p className="text-[10px] font-mono text-zinc-400">
                {currentUser ? `@${currentUser.username}` : 'Speed of Sound ID'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1.5 my-3 p-1 rounded-xl bg-black/40 border border-white/5 text-xs font-mono">
          {currentUser && (
            <button
              onClick={() => setActiveTab('history')}
              className={`flex-1 py-1.5 px-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'history'
                  ? 'bg-gradient-to-r from-violet-600 to-cyan-500 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>Мои саундтреки ({playlists.length})</span>
            </button>
          )}

          {!currentUser && (
            <>
              <button
                onClick={() => setActiveTab('login')}
                className={`flex-1 py-1.5 px-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'login'
                    ? 'bg-gradient-to-r from-violet-600 to-cyan-500 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Вход</span>
              </button>
              <button
                onClick={() => setActiveTab('register')}
                className={`flex-1 py-1.5 px-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'register'
                    ? 'bg-gradient-to-r from-violet-600 to-cyan-500 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Регистрация</span>
              </button>
            </>
          )}
        </div>

        {/* TAB 1: HISTORY OF SAVED PLAYLISTS */}
        {activeTab === 'history' && currentUser && (
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {/* Tag filter bar */}
            {allTags.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                <button
                  onClick={() => setTagFilter('all')}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-mono transition-colors ${
                    tagFilter === 'all'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold'
                      : 'bg-white/5 text-zinc-400 hover:text-white'
                  }`}
                >
                  Все
                </button>
                {allTags.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTagFilter(t)}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-mono transition-colors ${
                      tagFilter === t
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold'
                        : 'bg-white/5 text-zinc-400 hover:text-white'
                    }`}
                  >
                    #{t}
                  </button>
                ))}
              </div>
            )}

            {filteredPlaylists.length === 0 ? (
              <div className="text-center py-10 px-4 text-zinc-400">
                <Bookmark className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                <p className="text-xs font-medium text-white mb-1">
                  Нет сохраненных саундтреков
                </p>
                <p className="text-[11px] text-zinc-500 max-w-xs mx-auto">
                  Сгенерируйте саундтрек по фото и нажмите «Сохранить в профиль», чтобы создать персональную медиатеку.
                </p>
              </div>
            ) : (
              filteredPlaylists.map((pl) => {
                const isEditing = editingPlaylistId === pl.id;

                return (
                  <div
                    key={pl.id}
                    className="p-3.5 rounded-2xl bg-[#090b16] border border-white/10 hover:border-violet-500/30 transition-all space-y-2.5"
                  >
                    {/* Header Row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {pl.photoUrl ? (
                          <img
                            src={pl.photoUrl}
                            alt="Cover"
                            className="w-12 h-12 rounded-xl object-cover border border-white/10 flex-shrink-0"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-600/30 to-zinc-900 border border-white/10 flex items-center justify-center flex-shrink-0">
                            <Sparkles className="w-5 h-5 text-cyan-400" />
                          </div>
                        )}

                        <div className="min-w-0">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="px-2 py-1 rounded bg-black/60 border border-cyan-500 text-xs text-white w-full font-bold"
                            />
                          ) : (
                            <h4 className="text-xs font-bold text-white truncate leading-snug">
                              {pl.name}
                            </h4>
                          )}
                          <p className="text-[10px] font-mono text-zinc-400 flex items-center gap-1.5 mt-0.5">
                            <Calendar className="w-2.5 h-2.5" />
                            <span>{new Date(pl.createdAt).toLocaleDateString('ru-RU')}</span>
                            <span>•</span>
                            <span className="text-cyan-400">{pl.tracks?.length || 0} треков</span>
                            {pl.collaborativeTracks?.length > 0 && (
                              <span className="text-violet-300">+{pl.collaborativeTracks.length} от друзей</span>
                            )}
                          </p>
                        </div>
                      </div>

                      {/* Edit / Delete Buttons */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {isEditing ? (
                          <button
                            onClick={() => handleSaveEdit(pl.id)}
                            className="p-1.5 rounded-lg bg-cyan-500 text-black hover:bg-cyan-400 transition-colors"
                            title="Сохранить"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingPlaylistId(pl.id);
                              setEditName(pl.name);
                              setEditTags((pl.customTags || []).join(', '));
                            }}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
                            title="Редактировать название и теги"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                        )}

                        <button
                          onClick={() => handleDeletePlaylist(pl.id)}
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 transition-colors"
                          title="Удалить"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Custom Tags editor or viewer */}
                    {isEditing ? (
                      <div>
                        <label className="text-[9px] font-mono text-zinc-400 block mb-0.5">
                          Пользовательские теги (через запятую):
                        </label>
                        <input
                          type="text"
                          value={editTags}
                          onChange={(e) => setEditTags(e.target.value)}
                          placeholder="ночь, тренировка, любимое..."
                          className="px-2 py-1 rounded bg-black/60 border border-white/15 text-[11px] text-white w-full"
                        />
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {pl.customTags?.map((t, idx) => (
                          <span
                            key={idx}
                            className="px-1.5 py-0.2 rounded bg-white/5 text-[9px] font-mono text-zinc-300 border border-white/5"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Editorial quote snippet */}
                    {pl.vibe?.vibe_verdict && (
                      <p className="text-[10px] text-zinc-400 italic line-clamp-1 border-l-2 border-cyan-500/50 pl-2">
                        «{pl.vibe.vibe_verdict}»
                      </p>
                    )}

                    {/* Actions: Load in Player & Share Link */}
                    <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                      <button
                        onClick={() => {
                          onLoadPlaylist(pl);
                          onClose();
                        }}
                        className="flex-1 py-1.5 px-3 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 hover:opacity-90 text-white font-bold text-[11px] flex items-center justify-center gap-1.5 transition-all shadow-sm"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>Слушать в плеере</span>
                      </button>

                      <button
                        onClick={() => onSharePlaylist(pl)}
                        className="py-1.5 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-white text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors"
                        title="Поделиться ссылкой с друзьями"
                      >
                        <Share2 className="w-3 h-3" />
                        <span>Ссылка</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}

            {/* Logout button */}
            <div className="pt-2 border-t border-white/10 flex justify-between items-center text-xs font-mono">
              <span className="text-zinc-500">Speed of Sound Cloud Vault</span>
              <button
                onClick={onLogout}
                className="text-rose-400 hover:text-rose-300 font-semibold"
              >
                Выйти из профиля
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: LOGIN */}
        {activeTab === 'login' && (
          <form onSubmit={handleLogin} className="space-y-3 py-2">
            <div>
              <label className="block text-[11px] font-mono text-zinc-400 uppercase tracking-wider mb-1">
                Логин или никнейм
              </label>
              <input
                type="text"
                required
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder="напр. sound_master"
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm text-white focus:outline-none focus:border-cyan-400"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono text-zinc-400 uppercase tracking-wider mb-1">
                Пароль
              </label>
              <input
                type="password"
                required
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm text-white focus:outline-none focus:border-cyan-400"
              />
            </div>

            {authError && (
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 hover:opacity-95 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2"
            >
              {isLoading ? 'Вход...' : 'Войти в профиль'}
            </button>

            <div className="text-center pt-2">
              <span className="text-xs text-zinc-400">Нет аккаунта? </span>
              <button
                type="button"
                onClick={() => setActiveTab('register')}
                className="text-xs text-cyan-400 hover:underline font-semibold"
              >
                Зарегистрироваться
              </button>
            </div>
          </form>
        )}

        {/* TAB 3: REGISTER */}
        {activeTab === 'register' && (
          <form onSubmit={handleRegister} className="space-y-3 py-2">
            <div>
              <label className="block text-[11px] font-mono text-zinc-400 uppercase tracking-wider mb-1">
                Имя для отображения
              </label>
              <input
                type="text"
                value={displayNameInput}
                onChange={(e) => setDisplayNameInput(e.target.value)}
                placeholder="напр. Alex Sound"
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm text-white focus:outline-none focus:border-cyan-400"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono text-zinc-400 uppercase tracking-wider mb-1">
                Логин (username)
              </label>
              <input
                type="text"
                required
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder="напр. alex_speed"
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm text-white focus:outline-none focus:border-cyan-400"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono text-zinc-400 uppercase tracking-wider mb-1">
                Пароль
              </label>
              <input
                type="password"
                required
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm text-white focus:outline-none focus:border-cyan-400"
              />
            </div>

            {authError && (
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 hover:opacity-95 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2"
            >
              {isLoading ? 'Создание...' : 'Создать аккаунт'}
            </button>

            <div className="text-center pt-2">
              <span className="text-xs text-zinc-400">Уже есть профиль? </span>
              <button
                type="button"
                onClick={() => setActiveTab('login')}
                className="text-xs text-cyan-400 hover:underline font-semibold"
              >
                Войти
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

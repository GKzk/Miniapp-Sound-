import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  UploadCloud,
  Camera,
  Sparkles,
  RefreshCw,
  Share2,
  Bookmark,
  User,
  Music,
  ExternalLink,
  ChevronLeft,
  Flame,
  Radio,
  Clock,
  Layers,
  Check,
  AlertTriangle,
  Plus,
  Sliders,
} from 'lucide-react';
import {
  Track,
  VibeAnalysis,
  TelegramUser,
  AnalyzeResponse,
  UserProfile,
  SavedPlaylist,
} from './types';
import { SAMPLE_MOMENTS, SPEED_SOUND_TRACKS } from './data/tracks';
import { TelegramHeader } from './components/TelegramHeader';
import { VibeScanner } from './components/VibeScanner';
import { ModernWinampPlayer } from './components/ModernWinampPlayer';
import { TrackList } from './components/TrackList';
import { CameraCaptureModal } from './components/CameraCaptureModal';
import { StoryExporterModal } from './components/StoryExporterModal';
import { SubscriptionGateModal } from './components/SubscriptionGateModal';
import { UserProfileModal } from './components/UserProfileModal';
import { SavePlaylistModal } from './components/SavePlaylistModal';
import { SharedPlaylistModal } from './components/SharedPlaylistModal';

const USER_STORAGE_KEY = 'speed_sound_user_session';

export default function App() {
  // Telegram User Session State
  const [tgUser, setTgUser] = useState<TelegramUser>({
    id: 10842099,
    first_name: 'Listener',
    username: 'speed_listener',
    is_subscribed: false,
  });
  const [generationCount, setGenerationCount] = useState<number>(1);

  // User Profile Account State (Persistent)
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => {
    try {
      const stored = localStorage.getItem(USER_STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  // Form Inputs
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [moodText, setMoodText] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Flow States
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [vibeResult, setVibeResult] = useState<VibeAnalysis | null>(null);
  const [playlist, setPlaylist] = useState<Track[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(0);
  const [activeSavedPlaylist, setActiveSavedPlaylist] = useState<SavedPlaylist | null>(null);

  // Modals
  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);
  const [isStoryModalOpen, setIsStoryModalOpen] = useState<boolean>(false);
  const [isGateOpen, setIsGateOpen] = useState<boolean>(false);
  const [isProfileOpen, setIsProfileOpen] = useState<boolean>(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState<boolean>(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Show auto-dismissing toast
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Sync current user to localStorage
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(currentUser));
    } else {
      localStorage.removeItem(USER_STORAGE_KEY);
    }
  }, [currentUser]);

  // Check URL query parameters for ?share=CODE
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const shareCode = urlParams.get('share');
    if (shareCode) {
      loadSharedPlaylist(shareCode);
    }
  }, []);

  const loadSharedPlaylist = async (code: string) => {
    try {
      const res = await fetch(`/api/playlists/share/${encodeURIComponent(code)}`);
      const data = await res.json();
      if (data.playlist) {
        const pl: SavedPlaylist = data.playlist;
        setActiveSavedPlaylist(pl);
        setVibeResult(pl.vibe);
        setPlaylist(pl.tracks);
        if (pl.photoUrl) setPhotoPreviewUrl(pl.photoUrl);
        if (pl.moodText) setMoodText(pl.moodText);
        setCurrentTrackIndex(0);
        showToast(`Загружен плейлист от ${pl.authorName}!`);
      }
    } catch (err) {
      console.error('Failed to load shared playlist:', err);
    }
  };

  // Initialize Telegram WebApp SDK if running inside Telegram
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) {
      const tg = (window as any).Telegram.WebApp;
      tg.ready?.();
      tg.expand?.();

      if (tg.initDataUnsafe?.user) {
        const u = tg.initDataUnsafe.user;
        setTgUser((prev) => ({
          ...prev,
          id: u.id || prev.id,
          first_name: u.first_name || prev.first_name,
          username: u.username || prev.username,
        }));

        // Automatically sync telegram user profile if no user logged in
        if (!currentUser) {
          fetch('/api/auth/telegram-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: u.id,
              first_name: u.first_name,
              username: u.username,
            }),
          })
            .then((r) => r.json())
            .then((res) => {
              if (res.user) setCurrentUser(res.user);
            })
            .catch((e) => console.warn('Telegram sync failed:', e));
        }
      }
    }
  }, []);

  // Photo handlers
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setPhotoBase64(result);
      setPhotoPreviewUrl(result);
    };
    reader.readAsDataURL(file);
  };

  const handleCameraCapture = (dataUrl: string) => {
    setPhotoBase64(dataUrl);
    setPhotoPreviewUrl(dataUrl);
  };

  const handleSelectSampleMoment = (moment: (typeof SAMPLE_MOMENTS)[0]) => {
    setPhotoPreviewUrl(moment.previewUrl);
    setPhotoBase64(moment.previewUrl);
    setMoodText(moment.moodText);

    // Attempt to pre-convert image URL to data URL on client if CORS permits
    fetch(moment.previewUrl)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!blob) return;
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            setPhotoBase64(reader.result);
          }
        };
        reader.readAsDataURL(blob);
      })
      .catch(() => {
        // Fallback to URL (handled seamlessly by server)
      });
  };

  const clearPhoto = () => {
    setPhotoBase64(null);
    setPhotoPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Vibe Analysis API trigger
  const handleAnalyzeVibe = async () => {
    if (!photoBase64 && !moodText.trim()) {
      setErrorMessage('Пожалуйста, загрузите фото или введите слова настроения');
      return;
    }

    setErrorMessage(null);
    setIsScanning(true);

    try {
      const res = await fetch('/api/analyze-vibe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photoBase64,
          moodText: moodText.trim(),
          userId: tgUser.id,
          generationCount,
          isSubscribed: tgUser.is_subscribed,
        }),
      });

      const data: AnalyzeResponse = await res.json();

      if (data.gate_triggered) {
        setIsScanning(false);
        setIsGateOpen(true);
        return;
      }

      setVibeResult(data.vibe);
      setPlaylist(data.playlist);
      setCurrentTrackIndex(0);
      setActiveSavedPlaylist(null);
      setGenerationCount((prev) => prev + 1);
    } catch (err: any) {
      console.error('Analysis failed:', err);
      setErrorMessage(err.message || 'Ошибка генерации. Попробуйте еще раз.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleReset = () => {
    setVibeResult(null);
    setPlaylist([]);
    clearPhoto();
    setMoodText('');
    setCurrentTrackIndex(0);
    setActiveSavedPlaylist(null);
  };

  // Next / Prev Track
  const handleNextTrack = () => {
    if (playlist.length === 0) return;
    setCurrentTrackIndex((prev) => (prev + 1) % playlist.length);
  };

  const handlePrevTrack = () => {
    if (playlist.length === 0) return;
    setCurrentTrackIndex((prev) => (prev - 1 + playlist.length) % playlist.length);
  };

  // Saved playlist actions
  const handlePlaylistLoadedFromHistory = (saved: SavedPlaylist) => {
    setActiveSavedPlaylist(saved);
    setVibeResult(saved.vibe);
    setPlaylist(saved.tracks);
    if (saved.photoUrl) setPhotoPreviewUrl(saved.photoUrl);
    if (saved.moodText) setMoodText(saved.moodText);
    setCurrentTrackIndex(0);
    showToast(`Загружен плейлист: ${saved.name}`);
  };

  const handlePlaylistSavedSuccess = (saved: SavedPlaylist) => {
    setActiveSavedPlaylist(saved);
    showToast('Плейлист успешно сохранен в ваш профиль!');
  };

  const handleCollaborativeTrackAdded = (updated: SavedPlaylist) => {
    setActiveSavedPlaylist(updated);
    showToast('Трек успешно добавлен в общую подборку!');
  };

  return (
    <div className="min-h-screen bg-[#070810] text-zinc-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-black">
      {/* 1. TMA STICKY HEADER */}
      <TelegramHeader
        user={tgUser}
        currentUser={currentUser}
        onToggleSubscription={() =>
          setTgUser((prev) => ({ ...prev, is_subscribed: !prev.is_subscribed }))
        }
        onOpenProfile={() => setIsProfileOpen(true)}
        generationCount={generationCount}
      />

      {/* Floating Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 text-white font-bold text-xs shadow-[0_0_20px_rgba(6,182,212,0.4)] flex items-center gap-2"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. MAIN CONTAINER */}
      <main className="flex-1 w-full max-w-md mx-auto px-4 py-3 flex flex-col justify-start">
        <AnimatePresence mode="wait">
          {isScanning ? (
            /* STATE 1: SCANNING RADAR ANIMATION */
            <motion.div
              key="scanner"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="my-auto py-10"
            >
              <VibeScanner photoUrl={photoPreviewUrl} />
            </motion.div>
          ) : vibeResult && playlist.length > 0 ? (
            /* STATE 2: RESULTS SCREEN WITH WINAMP PLAYER */
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="space-y-4 py-2"
            >
              {/* Top Bar with Navigation & Actions */}
              <div className="flex items-center justify-between">
                <button
                  onClick={handleReset}
                  className="flex items-center gap-1 text-xs font-mono text-zinc-400 hover:text-white transition-colors py-1.5 px-2.5 rounded-xl bg-white/5 border border-white/5"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Новый вайб</span>
                </button>

                <div className="flex items-center gap-1.5">
                  {/* Save to Profile Button */}
                  <button
                    onClick={() => {
                      if (!currentUser) {
                        setIsProfileOpen(true);
                      } else {
                        setIsSaveModalOpen(true);
                      }
                    }}
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all border ${
                      activeSavedPlaylist
                        ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                        : 'bg-white/5 hover:bg-white/10 text-white border-white/10'
                    }`}
                    title="Сохранить в профиль"
                  >
                    <Bookmark className="w-3.5 h-3.5" />
                    <span>{activeSavedPlaylist ? 'Сохранено' : 'В профиль'}</span>
                  </button>

                  {/* Share Link Button */}
                  {activeSavedPlaylist && (
                    <button
                      onClick={() => setIsShareModalOpen(true)}
                      className="px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-cyan-500 text-white shadow-[0_0_12px_rgba(6,182,212,0.3)] hover:opacity-90 transition-all"
                      title="Поделиться ссылкой с друзьями"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      <span>Поделиться</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Editorial Verdict Card */}
              <div className="relative rounded-3xl bg-gradient-to-br from-[#121424] via-[#0d0f1c] to-[#070810] border border-violet-500/20 p-4 shadow-xl overflow-hidden">
                {photoPreviewUrl && (
                  <div
                    className="absolute inset-0 bg-cover bg-center opacity-15 filter blur-md"
                    style={{ backgroundImage: `url(${photoPreviewUrl})` }}
                  />
                )}
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-300 bg-cyan-950/60 px-2.5 py-0.5 rounded-full border border-cyan-500/30 shadow-[0_0_10px_rgba(6,182,212,0.2)]">
                      EDITORIAL @speed_sound
                    </span>
                    <span className="text-[11px] font-mono text-zinc-400">
                      {vibeResult.time_of_day}
                    </span>
                  </div>

                  <p className="text-sm text-zinc-100 font-medium leading-relaxed italic mb-3">
                    «{vibeResult.vibe_verdict}»
                  </p>

                  {/* Vibe Tags Row */}
                  <div className="flex flex-wrap gap-1.5">
                    {vibeResult.mood_tags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded-md bg-white/5 text-[11px] font-mono text-cyan-200/90 border border-white/5"
                      >
                        {tag.startsWith('#') ? tag : `#${tag}`}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* MODERN CYBER-WINAMP PLAYER */}
              <ModernWinampPlayer
                track={playlist[currentTrackIndex]}
                onNext={handleNextTrack}
                onPrev={handlePrevTrack}
                trackIndex={currentTrackIndex}
                totalTracks={playlist.length}
                onOpenStoryModal={() => setIsStoryModalOpen(true)}
              />

              {/* Collaborative Friend Tracks Section (if present) */}
              {activeSavedPlaylist &&
                activeSavedPlaylist.collaborativeTracks &&
                activeSavedPlaylist.collaborativeTracks.length > 0 && (
                  <div className="p-3.5 rounded-2xl bg-gradient-to-r from-cyan-950/40 via-black to-zinc-950 border border-cyan-500/30">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-cyan-400 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Коллаборация: треки от друзей ({activeSavedPlaylist.collaborativeTracks.length})</span>
                      </span>
                      <button
                        onClick={() => setIsShareModalOpen(true)}
                        className="text-[10px] font-mono text-cyan-400 hover:underline"
                      >
                        + Добавить еще
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      {activeSavedPlaylist.collaborativeTracks.map((item, idx) => (
                        <div
                          key={idx}
                          onClick={() => {
                            // Find or play this track
                            const foundIdx = playlist.findIndex((t) => t.id === item.track.id);
                            if (foundIdx !== -1) {
                              setCurrentTrackIndex(foundIdx);
                            } else {
                              setPlaylist((prev) => [...prev, item.track]);
                              setCurrentTrackIndex(playlist.length);
                            }
                          }}
                          className="p-2 rounded-xl bg-black/50 hover:bg-black/80 border border-white/5 cursor-pointer flex items-center justify-between text-xs transition-colors"
                        >
                          <div className="min-w-0">
                            <span className="font-bold text-white block truncate">
                              {item.track.artist} — {item.track.title}
                            </span>
                            <span className="text-[10px] text-cyan-300 font-mono">
                              добавил(а) {item.addedBy} {item.comment && `• «${item.comment}»`}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono text-cyan-400 flex-shrink-0">
                            {item.track.bpm} BPM
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {/* Action Buttons: Save to Profile & Telegram Stories */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    if (!currentUser) {
                      setIsProfileOpen(true);
                    } else {
                      setIsSaveModalOpen(true);
                    }
                  }}
                  className="py-3 px-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold flex items-center justify-center gap-2 text-xs transition-all"
                >
                  <Bookmark className="w-4 h-4 text-cyan-400" />
                  <span>{activeSavedPlaylist ? 'Редактировать' : 'Сохранить'}</span>
                </button>

                <button
                  onClick={() => setIsStoryModalOpen(true)}
                  className="py-3 px-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold flex items-center justify-center gap-2 text-xs transition-all"
                >
                  <Share2 className="w-4 h-4 text-cyan-400" />
                  <span>Постер Stories</span>
                </button>
              </div>

              {/* Matched Tracks List */}
              <TrackList
                tracks={playlist}
                currentTrackId={playlist[currentTrackIndex]?.id}
                onSelectTrack={(track, index) => setCurrentTrackIndex(index)}
              />
            </motion.div>
          ) : (
            /* STATE 3: INPUT SCREEN (PHOTO / VIBE / MOMENTS) */
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="space-y-4 py-2"
            >
              {/* Hero Title */}
              <div className="text-center pt-2 pb-1">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-950/60 border border-cyan-500/30 text-cyan-300 text-xs font-mono font-medium mb-2.5 shadow-[0_0_10px_rgba(6,182,212,0.2)]">
                  <Radio className="w-3.5 h-3.5 animate-pulse text-cyan-400" />
                  <span>SPEED OF SOUND // VIBE RADAR</span>
                </div>
                <h1 className="text-2xl font-extrabold tracking-tight text-white leading-tight">
                  Саундтрек твоего момента
                </h1>
                <p className="text-xs text-zinc-400 mt-1 max-w-xs mx-auto">
                  Загрузи фото или введи слова настроения. ИИ просканирует вайб и выдаст треки из коллекции @speed_sound в стиле Winamp.
                </p>
              </div>

              {/* Photo Upload & Camera Drop Area */}
              <div className="relative rounded-3xl bg-gradient-to-b from-[#111428] to-[#0a0c16] border border-white/10 p-4 shadow-xl overflow-hidden">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />

                {photoPreviewUrl ? (
                  /* Uploaded Photo Preview */
                  <div className="relative w-full h-52 rounded-2xl overflow-hidden group border border-white/15">
                    <img
                      src={photoPreviewUrl}
                      alt="Moment preview"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30" />

                    <div className="absolute top-2.5 right-2.5 flex items-center gap-2">
                      <button
                        onClick={clearPhoto}
                        className="px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-md text-xs font-mono text-zinc-300 hover:text-white border border-white/10 transition-colors"
                      >
                        Заменить
                      </button>
                    </div>

                    <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between text-xs font-mono text-white/90">
                      <span className="bg-black/60 backdrop-blur-md px-2 py-0.5 rounded border border-white/10">
                        ФОТО ЗАГРУЖЕНО
                      </span>
                      <span className="text-cyan-300 bg-black/60 px-2 py-0.5 rounded border border-cyan-500/30">
                        READY TO SCAN
                      </span>
                    </div>
                  </div>
                ) : (
                  /* Upload Prompt Box */
                  <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-white/15 hover:border-cyan-400/50 rounded-2xl transition-colors bg-black/30 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-cyan-950/40 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-3 shadow-[0_0_12px_rgba(6,182,212,0.15)]">
                      <UploadCloud className="w-6 h-6" />
                    </div>

                    <h3 className="text-sm font-bold text-white mb-1">
                      Загрузи фото своего момента
                    </h3>
                    <p className="text-[11px] text-zinc-400 max-w-[220px] mb-4">
                      Ночной город, чашка кофе, закат, спортзал или вид из окна
                    </p>

                    <div className="flex items-center gap-2 w-full max-w-xs">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex-1 py-2.5 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 border border-white/10"
                      >
                        <UploadCloud className="w-3.5 h-3.5" />
                        <span>Галерея</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setIsCameraOpen(true)}
                        className="flex-1 py-2.5 px-3 rounded-xl bg-gradient-to-r from-violet-900/40 to-cyan-900/40 hover:opacity-90 text-cyan-300 font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 border border-cyan-500/30"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        <span>Снять фото</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Sample Moments Carousel */}
              <div>
                <span className="block text-[11px] font-mono uppercase tracking-wider text-zinc-400 mb-2 px-1">
                  Или выбери готовый вайб момента:
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {SAMPLE_MOMENTS.slice(0, 6).map((moment) => (
                    <button
                      key={moment.id}
                      onClick={() => handleSelectSampleMoment(moment)}
                      className="group relative h-20 rounded-2xl overflow-hidden border border-white/10 text-left p-2 flex flex-col justify-end transition-all hover:border-cyan-400/50 active:scale-95"
                    >
                      <img
                        src={moment.previewUrl}
                        alt={moment.title}
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
                      <span className="relative z-10 text-[11px] font-bold text-white leading-tight line-clamp-2">
                        {moment.title}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Text Mood Input & Quick Chips */}
              <div className="rounded-3xl bg-[#0e101c]/90 border border-white/10 p-4 shadow-lg">
                <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400 mb-2">
                  Настроение или слова момента (опционально):
                </label>
                <input
                  type="text"
                  value={moodText}
                  onChange={(e) => setMoodText(e.target.value)}
                  placeholder="напр. тоска, сигареты, трасса, 2 часа ночи..."
                  className="w-full px-3.5 py-3 rounded-xl bg-black/40 border border-white/10 focus:border-cyan-400/60 focus:outline-none text-sm text-white placeholder:text-zinc-600 font-sans transition-colors"
                />

                {/* Suggested prompt chips */}
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {['#тоска', '#ночь', '#2_ночи', '#дождь', '#неон', '#трасса', '#зал', '#лоуфай'].map(
                    (chip) => (
                      <button
                        key={chip}
                        onClick={() => {
                          setMoodText((prev) => (prev ? `${prev} ${chip}` : chip));
                        }}
                        className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] font-mono text-cyan-300/80 transition-colors"
                      >
                        {chip}
                      </button>
                    )
                  )}
                </div>
              </div>

              {/* Error notification */}
              {errorMessage && (
                <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Primary Action Button */}
              <button
                onClick={handleAnalyzeVibe}
                disabled={!photoBase64 && !moodText.trim()}
                className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 hover:opacity-95 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none text-white font-extrabold flex items-center justify-center gap-2 text-base shadow-[0_0_25px_rgba(6,182,212,0.35)] transition-all cursor-pointer"
              >
                <Sparkles className="w-5 h-5 fill-current" />
                <span>Сгенерировать саундтрек</span>
              </button>

              {/* Footer info */}
              <div className="text-center pt-2">
                <p className="text-[11px] font-mono text-zinc-500">
                  Медиа @speed_sound • Winamp Cyber Edition • Персональная медиатека
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* MODALS */}
      {/* 1. Camera Snapshot Viewfinder */}
      <CameraCaptureModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCapture={handleCameraCapture}
      />

      {/* 2. Story Poster 9:16 Generator */}
      {playlist.length > 0 && vibeResult && (
        <StoryExporterModal
          isOpen={isStoryModalOpen}
          onClose={() => setIsStoryModalOpen(false)}
          photoUrl={photoPreviewUrl || SAMPLE_MOMENTS[0].previewUrl}
          track={playlist[currentTrackIndex]}
          vibe={vibeResult}
        />
      )}

      {/* 3. Subscription Gate Modal */}
      <SubscriptionGateModal
        isOpen={isGateOpen}
        onClose={() => setIsGateOpen(false)}
        onConfirmSubscribed={() => {
          setIsGateOpen(false);
          setTgUser((prev) => ({ ...prev, is_subscribed: true }));
          handleAnalyzeVibe();
        }}
      />

      {/* 4. User Profile & Playlist History Modal */}
      <UserProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        currentUser={currentUser}
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          showToast(`Добро пожаловать, ${user.displayName}!`);
        }}
        onLogout={() => {
          setCurrentUser(null);
          showToast('Вы вышли из профиля');
        }}
        onLoadPlaylist={handlePlaylistLoadedFromHistory}
        onSharePlaylist={(pl) => {
          setActiveSavedPlaylist(pl);
          setIsShareModalOpen(true);
        }}
      />

      {/* 5. Save Playlist Modal */}
      {vibeResult && playlist.length > 0 && (
        <SavePlaylistModal
          isOpen={isSaveModalOpen}
          onClose={() => setIsSaveModalOpen(false)}
          currentUser={currentUser}
          vibe={vibeResult}
          tracks={playlist}
          photoUrl={photoPreviewUrl}
          moodText={moodText}
          onSavedSuccess={handlePlaylistSavedSuccess}
          onPromptLogin={() => {
            setIsSaveModalOpen(false);
            setIsProfileOpen(true);
          }}
        />
      )}

      {/* 6. Share & Collaborate Modal */}
      {activeSavedPlaylist && (
        <SharedPlaylistModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          playlist={activeSavedPlaylist}
          onTrackAddedSuccess={handleCollaborativeTrackAdded}
        />
      )}
    </div>
  );
}

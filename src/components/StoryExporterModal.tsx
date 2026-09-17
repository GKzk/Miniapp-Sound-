import React, { useEffect, useState } from 'react';
import { X, Download, Share2, Sparkles, Check, ExternalLink, Smartphone } from 'lucide-react';
import { Track, VibeAnalysis } from '../types';
import { generateStoryImage, downloadStory } from '../utils/storyGenerator';

interface StoryExporterModalProps {
  isOpen: boolean;
  onClose: () => void;
  photoUrl: string;
  track: Track;
  vibe: VibeAnalysis;
}

export const StoryExporterModal: React.FC<StoryExporterModalProps> = ({
  isOpen,
  onClose,
  photoUrl,
  track,
  vibe,
}) => {
  const [renderedImageUrl, setRenderedImageUrl] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);

  // Check if native Telegram Stories API is available
  const hasTgShareStory = Boolean(
    typeof window !== 'undefined' &&
      (window as unknown as { Telegram?: { WebApp?: { shareToStory?: unknown } } })
        ?.Telegram?.WebApp?.shareToStory
  );

  useEffect(() => {
    if (!isOpen) {
      setRenderedImageUrl(null);
      setShareSuccess(false);
      return;
    }

    let isMounted = true;
    setIsRendering(true);

    generateStoryImage(photoUrl, track, vibe)
      .then((dataUrl) => {
        if (isMounted) {
          setRenderedImageUrl(dataUrl);
          setIsRendering(false);
        }
      })
      .catch((err) => {
        console.error('Error rendering story poster:', err);
        if (isMounted) setIsRendering(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, photoUrl, track.id, vibe]);

  const handleDownload = () => {
    if (!renderedImageUrl) return;
    downloadStory(renderedImageUrl, `speed-of-sound-${track.title.toLowerCase().replace(/\s+/g, '-')}.png`);
  };

  const handleShareToStory = () => {
    if (!renderedImageUrl) return;

    const tg = (window as unknown as {
      Telegram?: {
        WebApp?: {
          shareToStory?: (
            mediaUrl: string,
            params?: { text?: string; widget_link?: { url: string; name: string } }
          ) => void;
        };
      };
    })?.Telegram?.WebApp;

    if (tg?.shareToStory) {
      tg.shareToStory(renderedImageUrl, {
        text: `Мой саундтрек момента от @speed_sound ⚡`,
        widget_link: {
          url: 'https://t.me/speed_sound',
          name: 'Подобрать саундтрек',
        },
      });
      setShareSuccess(true);
    } else {
      // Fallback: auto download poster and notify user
      handleDownload();
      setShareSuccess(true);
      setTimeout(() => setShareSuccess(false), 4000);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText('https://t.me/speed_sound');
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="relative w-full max-w-sm rounded-3xl bg-[#0c0d16] border border-white/10 p-5 shadow-2xl flex flex-col max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <h3 className="font-bold text-sm text-white tracking-tight">
              Постер для Telegram Stories
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 9:16 Aspect ratio preview card */}
        <div className="relative w-full aspect-[9/16] rounded-2xl overflow-hidden bg-black/60 border border-white/10 flex items-center justify-center mb-4 shadow-inner">
          {isRendering ? (
            <div className="flex flex-col items-center gap-3 text-zinc-400">
              <div className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
              <span className="text-xs font-mono">Рендеринг 1080×1920...</span>
            </div>
          ) : renderedImageUrl ? (
            <img
              src={renderedImageUrl}
              alt="Telegram Story Preview"
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-xs text-zinc-500">Не удалось загрузить превью</span>
          )}

          <div className="absolute top-2.5 right-2.5 px-2 py-1 rounded-md bg-black/70 backdrop-blur-md text-[10px] font-mono text-white/80 border border-white/10">
            9:16 • 1080×1920
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2">
          <button
            onClick={handleShareToStory}
            disabled={isRendering || !renderedImageUrl}
            className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 hover:opacity-95 active:scale-[0.98] text-white font-bold flex items-center justify-center gap-2 text-sm shadow-[0_0_20px_rgba(6,182,212,0.35)] transition-all disabled:opacity-50"
          >
            <Share2 className="w-4 h-4" />
            <span>
              {hasTgShareStory
                ? 'Опубликовать в Telegram Stories'
                : 'Сохранить и выложить в Stories'}
            </span>
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleDownload}
              disabled={isRendering || !renderedImageUrl}
              className="py-2.5 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Скачать PNG</span>
            </button>

            <button
              onClick={handleCopyLink}
              className="py-2.5 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-cyan-400">Ссылка скопирована</span>
                </>
              ) : (
                <>
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>@speed_sound</span>
                </>
              )}
            </button>
          </div>
        </div>

        {shareSuccess && (
          <div className="mt-3 p-2.5 rounded-xl bg-cyan-950/60 border border-cyan-500/30 text-center text-xs text-cyan-300 font-medium flex items-center justify-center gap-1.5">
            <Check className="w-3.5 h-3.5" />
            <span>Постер готов! Делись моментом с друзьями.</span>
          </div>
        )}
      </div>
    </div>
  );
};

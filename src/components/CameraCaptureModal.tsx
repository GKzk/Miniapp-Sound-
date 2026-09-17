import React, { useRef, useState, useEffect } from 'react';
import { Camera, X, RefreshCw, AlertCircle } from 'lucide-react';

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (base64Image: string) => void;
}

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  isOpen,
  onClose,
  onCapture,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }
    startCamera();
    return () => {
      stopCamera();
    };
  }, [isOpen, facingMode]);

  const startCamera = async () => {
    setError(null);
    try {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      console.error('Camera access error:', err);
      setError('Не удалось получить доступ к камере. Проверьте разрешения устройства.');
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  };

  const switchCamera = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Flip horizontally if front camera
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    onCapture(dataUrl);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex flex-col justify-between p-4">
      {/* Top controls */}
      <div className="flex items-center justify-between z-10">
        <span className="font-mono text-xs uppercase tracking-widest text-cyan-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
          Live Vibe Cam
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={switchCamera}
            className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="Переключить камеру"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button
            onClick={onClose}
            className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Video Viewfinder */}
      <div className="relative flex-1 my-4 rounded-3xl overflow-hidden bg-zinc-950 flex items-center justify-center border border-white/10">
        {error ? (
          <div className="p-6 text-center max-w-xs text-zinc-400 flex flex-col items-center gap-3">
            <AlertCircle className="w-10 h-10 text-amber-400" />
            <p className="text-sm">{error}</p>
            <button
              onClick={startCamera}
              className="px-4 py-2 bg-white/10 rounded-xl text-xs text-white font-medium hover:bg-white/20"
            >
              Попробовать снова
            </button>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {/* Viewfinder crosshairs */}
            <div className="absolute inset-8 pointer-events-none border border-white/20 rounded-2xl">
              <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-cyan-400" />
              <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-cyan-400" />
              <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-cyan-400" />
              <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-cyan-400" />
            </div>
          </>
        )}
      </div>

      {/* Bottom Shutter button */}
      <div className="flex items-center justify-center pb-4">
        <button
          onClick={capturePhoto}
          disabled={Boolean(error)}
          className="relative group p-1 rounded-full bg-gradient-to-tr from-violet-600 via-indigo-600 to-cyan-400 disabled:opacity-50 transition-transform active:scale-95 shadow-[0_0_24px_rgba(6,182,212,0.4)]"
        >
          <div className="w-18 h-18 rounded-full border-4 border-black bg-white flex items-center justify-center group-hover:scale-105 transition-transform">
            <Camera className="w-7 h-7 text-black" />
          </div>
        </button>
      </div>
    </div>
  );
};

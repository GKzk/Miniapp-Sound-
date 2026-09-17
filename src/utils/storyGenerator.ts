import { Track, VibeAnalysis } from '../types';

export async function generateStoryImage(
  userPhotoUrl: string,
  track: Track,
  vibe: VibeAnalysis
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D canvas context');

  // 1. Draw base photo or fallback gradient
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = userPhotoUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load image'));
    });

    // Object-fit: cover logic
    const imgAspect = img.width / img.height;
    const canvasAspect = 1080 / 1920;
    let sWidth = img.width;
    let sHeight = img.height;
    let sx = 0;
    let sy = 0;

    if (imgAspect > canvasAspect) {
      sWidth = img.height * canvasAspect;
      sx = (img.width - sWidth) / 2;
    } else {
      sHeight = img.width / canvasAspect;
      sy = (img.height - sHeight) / 2;
    }

    ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, 1080, 1920);
  } catch (err) {
    console.warn('Canvas image fallback applied:', err);
    // Dark aesthetic fallback gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 1080, 1920);
    bgGrad.addColorStop(0, '#0a0a14');
    bgGrad.addColorStop(0.5, '#121124');
    bgGrad.addColorStop(1, '#050508');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 1080, 1920);
  }

  // 2. Top vignette for status bar / username
  const topGrad = ctx.createLinearGradient(0, 0, 0, 360);
  topGrad.addColorStop(0, 'rgba(5, 5, 10, 0.7)');
  topGrad.addColorStop(1, 'rgba(5, 5, 10, 0)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, 1080, 360);

  // 3. Bottom high-contrast gradient
  const bottomGrad = ctx.createLinearGradient(0, 800, 0, 1920);
  bottomGrad.addColorStop(0, 'rgba(6, 7, 12, 0)');
  bottomGrad.addColorStop(0.35, 'rgba(6, 7, 12, 0.75)');
  bottomGrad.addColorStop(0.65, 'rgba(6, 7, 12, 0.94)');
  bottomGrad.addColorStop(1, 'rgba(6, 7, 12, 0.99)');
  ctx.fillStyle = bottomGrad;
  ctx.fillRect(0, 800, 1080, 1120);

  // 4. Top branding header
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('SPEED OF SOUND', 80, 120);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.font = '500 24px "Space Mono", monospace';
  ctx.fillText('@speed_sound // VIBE RADAR 2.0', 80, 160);
  ctx.restore();

  // 5. Radar tags pill in upper section
  if (vibe.mood_tags && vibe.mood_tags.length > 0) {
    ctx.save();
    let tagX = 80;
    const tagY = 220;
    ctx.font = '600 22px "Space Mono", monospace';
    vibe.mood_tags.slice(0, 3).forEach((tag) => {
      const text = tag.startsWith('#') ? tag : `#${tag}`;
      const textWidth = ctx.measureText(text).width;
      
      // Pill bg
      ctx.fillStyle = 'rgba(20, 20, 30, 0.75)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1.5;
      
      roundRect(ctx, tagX, tagY - 26, textWidth + 32, 40, 20);
      ctx.fill();
      ctx.stroke();

      // Text
      ctx.fillStyle = '#06b6d4';
      ctx.fillText(text, tagX + 16, tagY);
      tagX += textWidth + 48;
    });
    ctx.restore();
  }

  // 6. Glassmorphic Player Card
  const cardX = 80;
  const cardY = 1220;
  const cardWidth = 920;
  const cardHeight = 440;

  ctx.save();
  // Card background
  ctx.fillStyle = 'rgba(15, 17, 26, 0.85)';
  ctx.strokeStyle = 'rgba(139, 92, 246, 0.3)';
  ctx.lineWidth = 2;
  roundRect(ctx, cardX, cardY, cardWidth, cardHeight, 32);
  ctx.fill();
  ctx.stroke();

  // Mini artwork box inside card
  const artX = cardX + 36;
  const artY = cardY + 36;
  const artSize = 130;
  
  ctx.fillStyle = track.coverColor || '#8b5cf6';
  roundRect(ctx, artX, artY, artSize, artSize, 20);
  ctx.fill();

  // Wave symbol inside artwork
  ctx.strokeStyle = '#06b6d4';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const x = artX + 30 + i * 18;
    const h = (i % 2 === 0 ? 40 : 60);
    ctx.moveTo(x, artY + 65 - h / 2);
    ctx.lineTo(x, artY + 65 + h / 2);
  }
  ctx.stroke();

  // Track Title & Artist
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px "Plus Jakarta Sans", sans-serif';
  const displayTitle = track.title.length > 22 ? track.title.slice(0, 20) + '...' : track.title;
  ctx.fillText(displayTitle, cardX + 190, cardY + 84);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.font = '600 30px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(track.artist, cardX + 190, cardY + 130);

  // BPM & Genre badge
  ctx.fillStyle = '#06b6d4';
  ctx.font = '700 22px "Space Mono", monospace';
  ctx.fillText(`⚡ ${track.bpm} BPM  •  ${track.genres[0] || 'ELECTRONIC'}`, cardX + 190, cardY + 165);

  // Audio wave visualizer inside card
  const waveY = cardY + 230;
  const waveWidth = cardWidth - 72;
  const barCount = 42;
  const barWidth = 6;
  const barGap = (waveWidth - barCount * barWidth) / (barCount - 1);

  for (let i = 0; i < barCount; i++) {
    const bx = cardX + 36 + i * (barWidth + barGap);
    // Simulated waveform envelope
    const factor = Math.sin((i / barCount) * Math.PI);
    const randomVar = 0.3 + 0.7 * Math.sin(i * 1.7);
    const barH = Math.max(12, 70 * factor * randomVar);

    // Color progress
    const isPast = i < 18;
    ctx.fillStyle = isPast ? '#06b6d4' : 'rgba(255, 255, 255, 0.2)';
    roundRect(ctx, bx, waveY + (35 - barH / 2), barWidth, barH, 3);
    ctx.fill();
  }

  // AI Verdict quote inside card
  const verdictY = cardY + 330;
  ctx.fillStyle = 'rgba(235, 240, 255, 0.95)';
  ctx.font = 'italic 26px "Plus Jakarta Sans", sans-serif';
  
  // Wrap verdict text
  const verdictText = `«${vibe.vibe_verdict}»`;
  const maxWidth = cardWidth - 72;
  wrapText(ctx, verdictText, cardX + 36, verdictY, maxWidth, 34);

  ctx.restore();

  // 7. Footer Call To Action
  ctx.save();
  ctx.fillStyle = '#06b6d4';
  ctx.font = 'bold 30px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Послушать саундтрек момента в Telegram', 540, 1750);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.font = '500 24px "Space Mono", monospace';
  ctx.fillText('@speed_sound // t.me/speed_sound_bot', 540, 1795);
  ctx.restore();

  return canvas.toDataURL('image/png');
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(' ');
  let line = '';
  let currentY = y;
  let linesRendered = 0;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;
    if (testWidth > maxWidth && n > 0) {
      ctx.fillText(line, x, currentY);
      line = words[n] + ' ';
      currentY += lineHeight;
      linesRendered++;
      if (linesRendered >= 2 && n < words.length - 1) {
        // Truncate with ellipsis if more than 2 lines
        line = line + '...';
        ctx.fillText(line, x, currentY);
        return;
      }
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, currentY);
}

export function downloadStory(dataUrl: string, filename = 'speed-of-sound-story.png') {
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

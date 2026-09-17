import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import { SPEED_SOUND_TRACKS } from './src/data/tracks';
import type { Track, VibeAnalysis } from './src/types';
import { storage } from './server/storage';

dotenv.config();

const app = express();
const PORT = 3000;

// Generous payload size for base64 photos
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Lazy Gemini client helper
let aiClient: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI | null {
  if (!aiClient && process.env.GEMINI_API_KEY) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// Subscription checker helper (supports real Telegram Bot API if TELEGRAM_BOT_TOKEN is set)
async function verifyTelegramChannelSubscription(userId: string | number): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !userId) {
    return false;
  }
  try {
    const channelId = '@speed_sound';
    const url = `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(channelId)}&user_id=${encodeURIComponent(userId)}`;
    const res = await fetch(url);
    const data = await res.json() as { ok: boolean; result?: { status: string } };
    if (data && data.ok && data.result) {
      const status = data.result.status;
      return ['member', 'administrator', 'creator'].includes(status);
    }
  } catch (err) {
    console.error('Telegram subscription check error:', err);
  }
  return false;
}

// In-memory cache for audio streams & artwork
const audioCache = new Map<string, { audioUrl: string; artworkUrl?: string; durationSeconds?: number }>();

// In-memory cache for vibe analysis results to save quota and speed up responses
const vibeAnalysisCache = new Map<string, { vibe: VibeAnalysis; curatedTracks: Track[] }>();

// Real studio audio resolver via Apple iTunes / CDN Search API
async function resolveRealAudio(artist: string, title: string): Promise<{ audioUrl?: string; artworkUrl?: string; durationSeconds?: number }> {
  const cacheKey = `${artist.toLowerCase().trim()} - ${title.toLowerCase().trim()}`;
  if (audioCache.has(cacheKey)) {
    return audioCache.get(cacheKey)!;
  }

  try {
    const term = `${artist} ${title}`;
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=1`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = (await res.json()) as {
        results?: Array<{
          previewUrl?: string;
          artworkUrl100?: string;
          trackTimeMillis?: number;
        }>;
      };

      if (data.results && data.results.length > 0) {
        const item = data.results[0];
        const artwork = item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x600bb') : undefined;
        const result = {
          audioUrl: item.previewUrl,
          artworkUrl: artwork,
          durationSeconds: item.trackTimeMillis ? Math.round(item.trackTimeMillis / 1000) : 30,
        };
        if (result.audioUrl) {
          audioCache.set(cacheKey, result as any);
        }
        return result;
      }
    }
  } catch {
    // Graceful fallback to synthesized DSP if preview isn't readily available
  }
  return {};
}

// Enrich an array of tracks with real studio audio previews & HD artworks with concurrency control
async function enrichTracksWithRealAudio(tracks: Track[]): Promise<Track[]> {
  const concurrency = 10;
  const results: Track[] = [];

  for (let i = 0; i < tracks.length; i += concurrency) {
    const chunk = tracks.slice(i, i + concurrency);
    const chunkEnriched = await Promise.all(
      chunk.map(async (t) => {
        if (t.audioUrl && t.artworkUrl) return t;
        const real = await resolveRealAudio(t.artist, t.title);
        return {
          ...t,
          audioUrl: real.audioUrl || t.audioUrl,
          artworkUrl: real.artworkUrl || t.artworkUrl,
          durationSeconds: real.durationSeconds || t.durationSeconds || 30,
          isRealAudio: Boolean(real.audioUrl || t.audioUrl),
        };
      })
    );
    results.push(...chunkEnriched);
  }

  return results;
}

// Track matching algorithm based on vibe analysis and higher-level audio features
// Provides an expansive, multifaceted selection across complementary subgenres and energy curves
function matchTracksToVibe(vibe: VibeAnalysis, targetCount: number = 18): Track[] {
  const scored = SPEED_SOUND_TRACKS.map((track) => {
    let score = 0;

    // 1. BPM closeness (max 20 pts)
    const bpmDiff = Math.abs(track.bpm - vibe.target_bpm);
    score += Math.max(0, 20 - bpmDiff * 0.7);

    // 2. Energy level closeness (max 20 pts)
    const energyDiff = Math.abs(track.energy - vibe.energy_level);
    score += Math.max(0, 20 - energyDiff * 3.0);

    // 3. Genre matches (max 25 pts)
    const trackGenresLower = track.genres.map((g) => g.toLowerCase());
    const vibeGenresLower = (vibe.genres || []).map((g) => g.toLowerCase());
    const genreMatches = trackGenresLower.filter((g) =>
      vibeGenresLower.some((vg) => vg.includes(g) || g.includes(vg))
    );
    score += genreMatches.length * 9;

    // 4. Mood matches (max 15 pts)
    const trackMoods = track.moods.map((m) => m.toLowerCase());
    const matchedMoods = trackMoods.filter((m) =>
      (vibe.mood_tags || []).some((vt) => vt.toLowerCase().includes(m))
    );
    score += matchedMoods.length * 5;

    // 5. Higher-level Audio Feature: Timbre Profile Matching (max 15 pts)
    if (vibe.timbre_profile && track.timbreProfile) {
      if (vibe.timbre_profile.brightness === track.timbreProfile.brightness) {
        score += 8;
      } else {
        const brightnessScale = ['dark', 'mellow', 'warm', 'balanced', 'bright', 'crystalline'];
        const vIdx = brightnessScale.indexOf(vibe.timbre_profile.brightness);
        const tIdx = brightnessScale.indexOf(track.timbreProfile.brightness);
        if (vIdx !== -1 && tIdx !== -1 && Math.abs(vIdx - tIdx) <= 1) {
          score += 4;
        }
      }

      if (vibe.timbre_profile.harmonic_density === track.timbreProfile.harmonic_density) {
        score += 7;
      }
    }

    // 6. Higher-level Audio Feature: Energy Curve Matching (max 15 pts)
    if (vibe.energy_curve && track.energyCurve) {
      if (vibe.energy_curve.curve_type === track.energyCurve.curve_type) {
        score += 9;
      }
      if (vibe.energy_curve.peak_profile === track.energyCurve.peak_profile) {
        score += 6;
      }
    }

    // 7. Higher-level Audio Feature: Acoustic Landscape Matching (max 15 pts)
    if (vibe.acoustic_landscape && track.acousticLandscape) {
      if (vibe.acoustic_landscape.stereo_dimension === track.acousticLandscape.stereo_dimension) {
        score += 7;
      }
      const vibeCues = (vibe.acoustic_landscape.environmental_cues || []).map((c) => c.toLowerCase());
      const trackCues = (track.acousticLandscape.environmental_cues || []).map((c) => c.toLowerCase());
      const commonCues = trackCues.filter((tc) =>
        vibeCues.some((vc) => vc.includes(tc) || tc.includes(vc))
      );
      score += Math.min(8, commonCues.length * 4);
    }

    return { track, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Diverse multifaceted selection algorithm:
  // 1. Cap any single artist at max 2 tracks to avoid monotony
  // 2. Select diverse tracks across primary vibe, complementary underground cuts, and atmospheric transitions
  const selected: Track[] = [];
  const artistCounts = new Map<string, number>();

  // First pass: Take highest scoring tracks with artist cap
  for (const item of scored) {
    if (selected.length >= targetCount) break;
    const artist = item.track.artist.toLowerCase();
    const count = artistCounts.get(artist) || 0;
    if (count < 2) {
      selected.push(item.track);
      artistCounts.set(artist, count + 1);
    }
  }

  // Second pass if needed to reach targetCount
  if (selected.length < targetCount) {
    for (const item of scored) {
      if (selected.length >= targetCount) break;
      if (!selected.some((t) => t.id === item.track.id)) {
        selected.push(item.track);
      }
    }
  }

  // Order the selection into a cohesive sonic narrative:
  // - Atmospheric & evocative intro (lower energy, warm timbre)
  // - Driving buildup & rhythm
  // - Peak anthem drops
  // - Deep hypnotic groove
  // - Cinematic outro / afterglow
  selected.sort((a, b) => {
    // Keep top 2 highest resonance tracks right at the top
    const aIdx = scored.findIndex((s) => s.track.id === a.id);
    const bIdx = scored.findIndex((s) => s.track.id === b.id);
    if (aIdx < 2 || bIdx < 2) return aIdx - bIdx;
    // For the rest, sort by natural progression of BPM and energy
    return a.energy === b.energy ? a.bpm - b.bpm : a.energy - b.energy;
  });

  return selected;
}

// Fallback heuristic vibe analyzer if Gemini key is not provided or rate limited
function generateHeuristicVibe(moodText?: string): VibeAnalysis {
  const text = (moodText || '').toLowerCase();
  
  if (text.includes('зал') || text.includes('желез') || text.includes('тяж') || text.includes('дрифт') || text.includes('агресс')) {
    return {
      mood_tags: ['#GymPhonk', '#PurePower', '#Heavy808', '#Adrenaline', '#RageMode', '#IndustrialPressure'],
      genres: ['Drift Phonk', 'Dark Trap', 'Electronic', 'Industrial'],
      target_bpm: 155,
      energy_level: 9,
      vibe_verdict: 'Твое настроение звучит как запредельный адреналин и раскаленный гриф штанги. Подобрали тяжелый фонк, резкий ковбелл и сокрушительный 808-й бас.',
      dominant_colors: ['глубокий кармин', 'стальной графит', 'обсидиановый черный'],
      location_setting: 'тренажерный зал, зона свободных весов',
      time_of_day: 'вечерний силовой пик',
      visual_atmosphere: 'Контрастный верхний свет, холодные тени от спортивных снарядов, металлическая текстура стали и магнезии.',
      emotional_depth: 'Максимальная концентрация воли, агрессивный выплеск внутренней энергии и преодоление физического предела.',
      acoustic_profile: {
        sub_bass: 'Разрывающий 808-й саб-бас 35-48 Гц с тяжелой аналоговой сатурацией и компрессией',
        percussion: 'Плотный дисторшн-снейр, перегруженный ковбелл и скоростные 32-е хэты',
        space: 'Сухая, плотная моно-компрессия без лишней реверберации для максимального панча',
      },
      cinematic_scene: 'Тяжелый подход под пульсирующие басы в полутемном брутальном зале.',
      timbre_profile: {
        texture: 'Перегруженный дисторшн-808, металлический лязг ковбелла и раскаленный цифровой клиппинг',
        brightness: 'bright',
        grain_and_saturation: 'Агрессивный аналоговый фузз, жесткий лимитер и перегруз предусилителя',
        harmonic_density: 'dense_multilayered',
        spectral_weight: 'Тяжелый инфра-низ 32-50 Гц в связке с режущими верхними металлическими гармониками',
      },
      energy_curve: {
        curve_type: 'explosive_burst',
        tempo_feel: 'Бескомпромиссный штурмовой напор 155 BPM без провисаний',
        dynamic_tension: 'Предельное мышечное напряжение с выплеском в припевах',
        peak_profile: 'continuous_pulse',
      },
      acoustic_landscape: {
        space_type: 'Брутальный индустриальный ангар с бетонными стенами и сухим эхом',
        reverb_decay_time: '1.2s tight concrete punch',
        stereo_dimension: 'wide_panoramic_stereo',
        environmental_cues: ['лязг блинов штанги', 'глухой стук магнезии о помост', 'тяжелое дыхание'],
      },
      synesthetic_transduction: 'Резкие металлические блики и глубокие контрастные тени кадра преобразуются в агрессивные гармоники перегруженного 808-баса.',
    };
  }

  if (text.includes('дожд') || text.includes('такси') || text.includes('тоск') || text.includes('сигарет') || text.includes('ночь')) {
    return {
      mood_tags: ['#NightTaxi', '#RainCity', '#Melancholy', '#BurialVibe', '#SubBass', '#BrokenRhythm'],
      genres: ['UK Garage', 'Future Garage', 'Darkwave', 'Ambient Dub'],
      target_bpm: 134,
      energy_level: 6,
      vibe_verdict: 'Твой кадр звучит как ночной дождливый мегаполис из окна такси. Мы подобрали сырой UK Garage, ломаный синкопированный ритм и призрачные соул-сэмплы.',
      dominant_colors: ['мокрый асфальт', 'неоновый сапфир', 'холодный индиго'],
      location_setting: 'ночной дождливый город, заднее сиденье такси',
      time_of_day: '02:45 глубокой ночи',
      visual_atmosphere: 'Размытые полосы неоновых фонарей сквозь струи дождя на лобовом стекле, глубокие синие тени и мокрый зеркальный асфальт.',
      emotional_depth: 'Глубокая ночная интроспекция, легкая кинематографичная меланхолия и чувство тихого одиночества среди огромного мегаполиса.',
      acoustic_profile: {
        sub_bass: 'Теплый, обволакивающий аналоговый суб-бас 40-55 Гц в стиле Burial',
        percussion: 'Сырой шаффл-брейкбит с характерным виниловым шорохом и мягким римшотом на вторую долю',
        space: 'Широкая стереопанорама с темным плейт-ревербератором и глубоким стерео-дилеем',
      },
      cinematic_scene: 'Одинокая поездка сквозь спящий город под приглушенные огни витрин.',
      timbre_profile: {
        texture: 'Шуршащий виниловый кракелюр, затуманенный Rhodes и призрачные питченные вокальные форманты',
        brightness: 'mellow',
        grain_and_saturation: 'Теплая пленочная компрессия с легким flutter и винтажным треском иглы',
        harmonic_density: 'rich_polyphonic',
        spectral_weight: 'Глубокий суб-бас 38-52 Гц, мягкий спад на верхах и бархатная нижняя середина',
      },
      energy_curve: {
        curve_type: 'nocturnal_drift',
        tempo_feel: 'Ломаный синкопированный свинг 134 BPM с эффектом невесомости',
        dynamic_tension: 'Кинематографичная меланхолия и неспешное погружение в глубину ночи',
        peak_profile: 'subdued_valley',
      },
      acoustic_landscape: {
        space_type: 'Замкнутый салон авто с дождевой панорамой и мокрым отражением витрин',
        reverb_decay_time: '4.2s diffuse wet plate',
        stereo_dimension: 'binaural_3d_surround',
        environmental_cues: ['струи дождя по лобовому стеклу', 'шелест шин по мокрому асфальту', 'далекий неоновый гул'],
      },
      synesthetic_transduction: 'Капли дождя на стекле переводятся в синкопированный щелкающий ритм брейкбита, а огни фар — в обволакивающий темный суб-бас.',
    };
  }

  if (text.includes('неон') || text.includes('бар') || text.includes('друг') || text.includes('клуб') || text.includes('рейв')) {
    return {
      mood_tags: ['#NeonBar', '#Cyberpunk', '#LateNight', '#EmotionalClub', '#130BPM', '#UltraViolet'],
      genres: ['Electronic', 'House', 'UK Garage', 'Deconstructed Club'],
      target_bpm: 130,
      energy_level: 8,
      vibe_verdict: 'Атмосфера залитого неоном ночного бара и гипнотического клубного грува. В подборке плотный пульсирующий бас и текстурный future garage.',
      dominant_colors: ['электрический ультрафиолет', 'неоновый циан', 'глубокий кобальт'],
      location_setting: 'неоновый андеграундный бар, полумрак',
      time_of_day: '03:15 ночи',
      visual_atmosphere: 'Плотный неоновый свет ультрафиолетовых ламп, запотевшие бокалы с бликами льда, мягкий клубящийся дым и зеркальные рефлексы.',
      emotional_depth: 'Гипнотическое единение с ритмом, эйфорический подъем и растворение во временном потоке ночи.',
      acoustic_profile: {
        sub_bass: 'Пульсирующий 4-на-4 бас с фильтрованной автоматизацией cut-off',
        percussion: 'Четкий кликающий хэт, плотный клубный бочонок и микросэмплы голосовых чопов',
        space: 'Камерный клубный объем с компрессированным room-ревербератором',
      },
      cinematic_scene: 'Вспышки лазеров и гул басов в скрытом от посторонних глаз подвальном баре.',
      timbre_profile: {
        texture: 'Аналоговые пэды Prophet-6, пульсирующий Moog-бас и сверкающие перкуссионные глитчи',
        brightness: 'warm',
        grain_and_saturation: 'Ламповый преамп с приятным округлым насыщением второй гармоники',
        harmonic_density: 'rich_polyphonic',
        spectral_weight: 'Плотный клубный кик 55-90 Гц с упругой поддержкой средней полосы',
      },
      energy_curve: {
        curve_type: 'slow_crescendo_to_drop',
        tempo_feel: 'Упругий клубный 4/4 грув 130 BPM, вовлекающий тело в непрерывное движение',
        dynamic_tension: 'Постепенное раскрытие low-pass фильтра вплоть до эйфорического дропа',
        peak_profile: 'mid_drop',
      },
      acoustic_landscape: {
        space_type: 'Андеграундный кирпичный свод с клубной акустической обработкой',
        reverb_decay_time: '2.4s club chamber',
        stereo_dimension: 'wide_panoramic_stereo',
        environmental_cues: ['приглушенный звон бокалов', 'вибрация деревянного танцпола', 'гул голосов у бара'],
      },
      synesthetic_transduction: 'Ультрафиолетовый свет и переливы неоновых отражений транслируются в модуляцию резонансного фильтра синтезатора.',
    };
  }

  if (text.includes('солн') || text.includes('парк') || text.includes('тепл') || text.includes('утр')) {
    return {
      mood_tags: ['#GoldenHour', '#Chillwave', '#Warmth', '#Downtempo', '#AnalogPads', '#SunGlitch'],
      genres: ['Chillwave', 'Ambient', 'Downtempo', 'Organic House'],
      target_bpm: 105,
      energy_level: 4,
      vibe_verdict: 'Теплые солнечные блики и медленный глубокий вдох. Подобрали аналоговый чиллвейв, парящие синтезаторные пэды и органический даунтемпо.',
      dominant_colors: ['янтарное золото', 'пастельный лазурный', 'мягкий песочный'],
      location_setting: 'солнечный парк, набережная у воды',
      time_of_day: 'закатный golden hour',
      visual_atmosphere: 'Мягкий контровой свет заходящего солнца, золотистая пыльца в воздухе, игра длинных теплых теней на траве.',
      emotional_depth: 'Абсолютное умиротворение, замедление внутреннего диалога и ощущение гармонии с моментом.',
      acoustic_profile: {
        sub_bass: 'Мягкий синусоидальный саб-бас без агрессии, дающий теплоту в нижнем регистре',
        percussion: 'Шуршащий органический шейкер, приглушенный бас-барабан и теплые тарелки',
        space: 'Воздушный, бесконечный шиммер-ревербератор с эффектом парения в воздухе',
      },
      cinematic_scene: 'Замедленный кадр золотого заката над гладью реки.',
      timbre_profile: {
        texture: 'Шелковистые аналоговые пэды, мерцающие гитарные флажолеты и органические колокольчики',
        brightness: 'crystalline',
        grain_and_saturation: 'Чистый прозрачный тракт с легким ленточным теплом и сияющим воздухом',
        harmonic_density: 'rich_polyphonic',
        spectral_weight: 'Мягкий естественный бас и открытый сияющий высокочастотный спектр выше 10 кГц',
      },
      energy_curve: {
        curve_type: 'undulating_waves',
        tempo_feel: 'Неторопливый размеренный даунтемпо 105 BPM с глубоким естественным дыханием',
        dynamic_tension: 'Плавные волнообразные приливы без резких контрастов',
        peak_profile: 'extended_crescendo',
      },
      acoustic_landscape: {
        space_type: 'Открытое природное пространство с широкой панорамой горизонта',
        reverb_decay_time: '5.5s infinite shimmer reverb',
        stereo_dimension: 'wide_panoramic_stereo',
        environmental_cues: ['теплый шелест листвы', 'далекое щебетание птиц', 'тихий плеск воды у берега'],
      },
      synesthetic_transduction: 'Золотистый контровой свет заката преобразуется в воздушный шиммер-ревербератор и парящие обертоны аналоговых пэдов.',
    };
  }

  if (text.includes('осен') || text.includes('трасс') || text.includes('туман') || text.includes('дорог') || text.includes('думер')) {
    return {
      mood_tags: ['#Highway', '#Fog', '#DoomerWave', '#ColdWind', '#Atmospheric', '#128BPM'],
      genres: ['Darkwave', 'Post-Punk', 'Atmospheric', 'Breakbeat'],
      target_bpm: 128,
      energy_level: 6,
      vibe_verdict: 'Пустая осенняя трасса, скрывающаяся в тумане, и холодный встречный воздух. Подобрали меланхоличный пост-панк, холодный реверб и кинематографичный ломаный ритм.',
      dominant_colors: ['туманный пепел', 'холодный базальт', 'приглушенный охранный янтарь'],
      location_setting: 'пустая загородная трасса в сосновом тумане',
      time_of_day: 'сумеречный час',
      visual_atmosphere: 'Молочно-белый туман, стелющийся над мокрым шоссе, свет фар, исчезающий вдали, и золотисто-ржавые кроны деревьев.',
      emotional_depth: 'Экзистенциальная свобода дороги, кинематографичная светлая печаль и отрешенность от суеты городов.',
      acoustic_profile: {
        sub_bass: 'Аналоговый пульсирующий бас 42-56 Гц с легким эффектом хоруса',
        percussion: 'Холодная драм-машина 80-х с объемным гейтированным рабочим барабаном',
        space: 'Бескрайний стереоревербератор с эффектом туманного рассеивания',
      },
      cinematic_scene: 'Машина мчит в бесконечную туманную даль навстречу холодному северному закату.',
      timbre_profile: {
        texture: 'Холодный скрежещущий бас с эффектом хоруса, драм-машина LinnDrum и гитарный реверб',
        brightness: 'dark',
        grain_and_saturation: 'Лоуфайная кассетная компрессия с легким аналоговым тремоло',
        harmonic_density: 'focused_monophonic',
        spectral_weight: 'Плотный пронзительный мид-бас и глуховатый винтажный кик',
      },
      energy_curve: {
        curve_type: 'hypnotic_linear',
        tempo_feel: 'Неумолимый гипнотический локомотив 128 BPM, разрезающий туман',
        dynamic_tension: 'Кинематографичный саспенс бесконечной ночной дороги',
        peak_profile: 'continuous_pulse',
      },
      acoustic_landscape: {
        space_type: 'Бескрайнее туманное шоссе посреди холодного соснового массива',
        reverb_decay_time: '3.6s cold hall',
        stereo_dimension: 'wide_panoramic_stereo',
        environmental_cues: ['шум набегающего холодного ветра', 'гул мотора на высоких оборотах', 'вибрация подвески'],
      },
      synesthetic_transduction: 'Молочный туман и удаляющиеся огни фар превращаются в холодный пост-панковый дилей и пульсирующий моно-бас.',
    };
  }

  if (text.includes('монитор') || text.includes('комнат') || text.includes('код') || text.includes('лоуфай') || text.includes('уют') || text.includes('ночн')) {
    return {
      mood_tags: ['#LoFiRoom', '#Cozy', '#LateCoding', '#AnalogPads', '#SynthStudio', '#TapeHiss'],
      genres: ['Lo-Fi Electronic', 'IDM', 'Downtempo', 'Ambient'],
      target_bpm: 92,
      energy_level: 4,
      vibe_verdict: 'Полумрак ночной комнаты, мягкое свечение экрана и медитативный поток мыслей. Подобрали аналоговый IDM, теплый виниловый шум и обволакивающие синтезаторные текстуры.',
      dominant_colors: ['мягкий индиго', 'неоновый янтарь', 'глубокий обсидиан'],
      location_setting: 'уютная спальня, домашняя студия за рабочим столом',
      time_of_day: 'глубокая ночь (03:30)',
      visual_atmosphere: 'Приглушенный локальный свет монитора и теплой лампы, тени на стенах, мерцание индикаторов аудиокарты.',
      emotional_depth: 'Глубокая концентрация, состояние потока, умиротворенное ночное уединение.',
      acoustic_profile: {
        sub_bass: 'Теплый винтажный Moog-бас с мягким срезом высоких частот',
        percussion: 'Неторопливый бит с виниловым шорохом и естественным свинг-грувом',
        space: 'Камерное аналоговое пространство с мягким ленточным дилеем',
      },
      cinematic_scene: 'Человек в наушниках погружен в творчество в освещенной одним монитором комнате.',
      timbre_profile: {
        texture: 'Винтажный аналоговый Rhodes, мягкий скрип стула, щелчки ножниц и теплый суб-бас',
        brightness: 'warm',
        grain_and_saturation: 'Ленточный шум магнитофона Tascam с легким плаванием скорости (wow/flutter)',
        harmonic_density: 'rich_polyphonic',
        spectral_weight: 'Уютно согретая нижняя середина и мягкий срез резких высоких частот',
      },
      energy_curve: {
        curve_type: 'nocturnal_drift',
        tempo_feel: 'Ленивый лоуфай свинг 92 BPM с легким отставанием рабочего барабана',
        dynamic_tension: 'Медитативная ностальгия и творческий покой безмятежного уединения',
        peak_profile: 'subdued_valley',
      },
      acoustic_landscape: {
        space_type: 'Уютная полутемная комната с деревянной мебелью и коврами',
        reverb_decay_time: '0.8s intimate cozy room',
        stereo_dimension: 'tight_mono_intimate',
        environmental_cues: ['щелканье механической клавиатуры', 'тихий шелест кулера ноутбука', 'ночной покой за окном'],
      },
      synesthetic_transduction: 'Мягкий локальный свет экрана на фоне полумрака комнаты транслируется в теплые полифонические аккорды электропиано.',
    };
  }

  return {
    mood_tags: ['#SpeedOfSound', '#NightDrive', '#DeepElectronic', '#Breakbeat', '#Atmospheric', '#FutureGarage'],
    genres: ['UK Garage', 'Breakbeat', 'Deep Electronic', 'Minimal Techno'],
    target_bpm: 132,
    energy_level: 7,
    vibe_verdict: 'Твой момент звучит как холодный ночной Берлин. Мы подобрали кинематографичный электронный грув, ломаную бочку и плотный бас от кураторов @speed_sound.',
    dominant_colors: ['глубокий индиго', 'электрический циан', 'обсидиановый графит'],
    location_setting: 'ночные проспекты мегаполиса',
    time_of_day: 'глубокая ночь',
    visual_atmosphere: 'Ритмичные огни фонарей, отражающиеся на капоте автомобиля, холодная световая палитра 4500K с чистыми контрастами.',
    emotional_depth: 'Внутренняя сосредоточенность, эстетика ночной скорости и предвкушение неизведанного.',
    acoustic_profile: {
      sub_bass: 'Глубокий модулированный Reese-бас с богатым гармоническим спектром',
      percussion: 'Синкопированный брейкбит с текстурным шумом и акцентированным снейром',
      space: 'Глубокий стереохолл с панорамированными дилей-хвостами',
    },
    cinematic_scene: 'Стремительное движение по ночному шоссе в свете неоновых указателей.',
    timbre_profile: {
      texture: 'Модулированный Reese-бас, синкопированный брейкбит и текстурный аналоговый шум',
      brightness: 'mellow',
      grain_and_saturation: 'Ламповый сатуратор с легким гармоническим подгрузом',
      harmonic_density: 'rich_polyphonic',
      spectral_weight: 'Тяжелый суб-бас 38-52 Гц и прозрачный воздушный верхний спектр',
    },
    energy_curve: {
      curve_type: 'slow_crescendo_to_drop',
      tempo_feel: 'Качающий ночной грув 132 BPM с упругой синкопой',
      dynamic_tension: 'Кинематографичный ночной драйв и нарастающее предвкушение',
      peak_profile: 'mid_drop',
    },
    acoustic_landscape: {
      space_type: 'Ночной европейский город с эхом от стеклянных фасадов',
      reverb_decay_time: '3.0s modern plate',
      stereo_dimension: 'wide_panoramic_stereo',
      environmental_cues: ['эхо ночного мегаполиса', 'шум ветра на скорости', 'шелест колес'],
    },
    synesthetic_transduction: 'Огни ночного города считываются как вспышки стерео-перкуссии над плотной басовой линией.',
  };
}

// 1. Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Speed of Sound Vibe Radar API',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    hasBotToken: Boolean(process.env.TELEGRAM_BOT_TOKEN),
  });
});

// 2. Catalog endpoint with real audio stream resolution
app.get('/api/tracks', async (req, res) => {
  try {
    const enriched = await enrichTracksWithRealAudio(SPEED_SOUND_TRACKS);
    res.json({
      channel: '@speed_sound',
      count: enriched.length,
      tracks: enriched,
    });
  } catch (err) {
    res.json({
      channel: '@speed_sound',
      count: SPEED_SOUND_TRACKS.length,
      tracks: SPEED_SOUND_TRACKS,
    });
  }
});

// 2.1 Dynamic track audio resolver
app.get('/api/track/resolve-audio', async (req, res) => {
  const artist = String(req.query.artist || '');
  const title = String(req.query.title || '');
  if (!artist || !title) {
    return res.status(400).json({ error: 'artist and title query parameters are required' });
  }
  const real = await resolveRealAudio(artist, title);
  res.json(real);
});

// 3. Subscription verification endpoint
app.post('/api/check-subscription', async (req, res) => {
  const { userId, isSimulated } = req.body || {};
  
  if (isSimulated) {
    return res.json({ subscribed: true, simulated: true });
  }

  if (userId) {
    const isSubscribed = await verifyTelegramChannelSubscription(userId);
    return res.json({ subscribed: isSubscribed });
  }

  res.json({ subscribed: false });
});

// 4. Main Vibe Analysis Endpoint
app.post('/api/analyze-vibe', async (req, res) => {
  try {
    const { photoBase64, moodText, userId, generationCount = 1, isSubscribed = false } = req.body || {};

    // Gate Subscription Rule:
    // User gets 1 free generation. On 2nd generation or higher, requires subscription to @speed_sound
    if (generationCount > 1 && !isSubscribed) {
      let realSubscribed = false;
      if (userId && process.env.TELEGRAM_BOT_TOKEN) {
        realSubscribed = await verifyTelegramChannelSubscription(userId);
      }

      if (!realSubscribed) {
        return res.json({
          gate_triggered: true,
          message: 'Подпишись на канал @speed_sound, чтобы разблокировать безлимитный ИИ-саундтрек момента.',
        });
      }
    }

    const ai = getGemini();
    let vibeData: VibeAnalysis | null = null;
    let geminiCuratedTracks: Track[] = [];

    // Cache key for avoiding redundant Gemini calls and bypassing quota limits
    const cacheKey = photoBase64
      ? `photo_${photoBase64.slice(0, 100)}_${photoBase64.length}_${(moodText || '').toLowerCase().trim()}`
      : `mood_${(moodText || '').toLowerCase().trim()}`;

    if (vibeAnalysisCache.has(cacheKey)) {
      const cached = vibeAnalysisCache.get(cacheKey)!;
      vibeData = cached.vibe;
      geminiCuratedTracks = cached.curatedTracks;
    }

    if (!vibeData && ai) {
      const systemInstruction = `
Ты — главный звукорежиссер, эксперт по психоакустике и ведущий музыкальный куратор медиа-лейбла 'Speed of sound' (@speed_sound).
Твоя миссия — бескомпромиссная синестетическая трансдукция визуальных и эмоциональных образов в физические звуковые параметры и отбор передовой андеграундной музыки (UK Garage, Future Garage, Lo-Fi, Drift Phonk, Atmospheric Darkwave, Witch House, Minimal Techno, Downtempo, Ambient, Breakbeat, IDM, Post-Dubstep, Deconstructed Club).

МЕТОДОЛОГИЯ СИНЕСТЕЗИЙНОГО АНАЛИЗА:
Кадр — это оптическая партитура звуковых волн. Преобразуй оптику в высокоуровневые акустические материи:

1. ТЕМБРАЛЬНЫЙ ПРОФИЛЬ (timbre_profile):
   - texture: описание осязаемой физической текстуры звука на основе фактуры кадра (зернистость пленки, хром, бетон, запотевшее стекло, мокрый асфальт, неон, пыль).
   - brightness: спектральный наклон и яркость ('dark' | 'mellow' | 'warm' | 'balanced' | 'bright' | 'crystalline') на основе цветовой температуры, люминесценции и экспозиции кадра.
   - grain_and_saturation: характер насыщения, шума и искажений (напр. "Тёплый кассетный Tascam 4-track сатуратор с легким flutter", "Холодный цифровой клиппинг", "Аналоговый ламповый овердрайв").
   - harmonic_density: плотность гармонических слоев ('sparse_minimal' | 'focused_monophonic' | 'rich_polyphonic' | 'dense_multilayered').
   - spectral_weight: частотный баланс (напр. "Глубокий суб-бас 35-50 Гц с вырезанной резкой серединой и шелковистым верхом").

2. ЭНЕРГЕТИЧЕСКИЕ КРИВЫЕ (energy_curve):
   - curve_type: тип динамического профиля во времени ('hypnotic_linear' | 'slow_crescendo_to_drop' | 'undulating_waves' | 'explosive_burst' | 'nocturnal_drift' | 'staccato_stomp').
   - tempo_feel: ощущение микроритма и грува (напр. "Ломаный синкопированный свинг 134 BPM с оттяжкой на слабую долю", "Неумолимый гипнотический локомотив").
   - dynamic_tension: характер кинематографичного натяжения и саспенса.
   - peak_profile: кульминационная точка энергии ('intro_peak' | 'mid_drop' | 'extended_crescendo' | 'continuous_pulse' | 'subdued_valley').

3. АКУСТИЧЕСКИЙ ЛАНДШАФТ (acoustic_landscape):
   - space_type: геометрия и физика виртуального акустического пространства (напр. "Замкнутый салон авто с дождевой панорамой за стеклом", "Сырой бетонный подземный ангар", "Открытая крыша высотки на закате").
   - reverb_decay_time: время и характер затухания реверберации RT60 (напр. "0.8s intimate room", "3.8s diffuse plate", "5.5s infinite shimmer").
   - stereo_dimension: стерео-панорамирование ('tight_mono_intimate' | 'wide_panoramic_stereo' | 'binaural_3d_surround' | 'disorienting_haas_effect').
   - environmental_cues: 2-4 фоновых фоли-шума, органично вплетенных в атмосферу (напр. ["капли дождя по стеклу", "шелест шин по мокрому асфальту", "далекий неоновый гул"]).

4. СИНЕСТЕЗИЙНАЯ ТРАНСДУКЦИЯ (synesthetic_transduction):
   - 1-2 емких предложения, объясняющих, как визуальные контрасты, тени и фотоны кадра напрямую трансформировались в эту звуковую сигнатуру.

5. РЕДАКТОРСКИЙ ВЕРДИКТ И ПОДБОР:
   - visual_atmosphere: светотень, цветовая температура, отражения и текстура (1-2 предложения).
   - emotional_depth: эмоциональный и психологический подтекст кадра (1-2 предложения).
   - acoustic_profile: суб-бас, перкуссия, пространство.
   - cinematic_scene: краткая кинематографическая сцена.
   - dominant_colors: 3-4 доминирующих оттенка на русском.
   - location_setting: точная среда / локация на русском.
   - time_of_day: время суток или световой период на русском.
   - energy_level: число от 1 до 10.
   - target_bpm: темп от 70 до 165 BPM.
   - mood_tags: 5-8 хэштегов (напр. ["#NightDrive", "#FutureGarage", "#SubBass"]).
   - genres: 3-5 поджанров.
   - vibe_verdict: авторский вердикт в стиле культовых изданий Pitchfork или Mixmag (2-3 предложения на русском).
   - curated_tracks: от 10 до 16 РЕАЛЬНО СУЩЕСТВУЮЩИХ культовых или знаковых треков мировой электронной/андеграундной сцены (артисты уровня Overmono, Burial, Fred again.., Bicep, Skeler, DVRST, Kiasmos, Four Tet, Mall Grab, Ross from Friends, Jon Hopkins, Massive Attack, Boards of Canada, Aphex Twin, Bonobo, Tycho, Kavinsky, LXST CXNTURY, The Blaze, salute, DJ Shadow, Joy Orbison, Kelly Lee Owens, Jacques Greene, Caribou, Portishead, Dj Seinfeld, Floating Points и др.), отражающих разные грани настроения кадра (атмосферное вступление, глубокий ночной бас, пиковые танцевальные гимны, гипнотический грув, медитативный финал).
     Каждый трек содержит: artist, title, bpm, energy (1-10), genres, curator_reason (1 предложение), synthPreset ('uk_garage' | 'dark_wave' | 'lofi_hiphop' | 'phonk' | 'downtempo' | 'techno').
`;

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

      if (photoBase64 && typeof photoBase64 === 'string') {
        if (photoBase64.startsWith('http://') || photoBase64.startsWith('https://')) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const imgRes = await fetch(photoBase64, {
              signal: controller.signal,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                Accept: 'image/*,*/*',
              },
            });
            clearTimeout(timeoutId);

            if (imgRes.ok) {
              const arrayBuffer = await imgRes.arrayBuffer();
              const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
              const base64Data = Buffer.from(arrayBuffer).toString('base64');
              parts.push({
                inlineData: {
                  mimeType: contentType.split(';')[0] || 'image/jpeg',
                  data: base64Data,
                },
              });
            } else {
              console.warn(`Could not load remote image (${imgRes.status}), proceeding with text.`);
            }
          } catch {
            // Silently proceed with text prompt
          }
        } else if (photoBase64.includes(';base64,')) {
          const split = photoBase64.split(';base64,');
          let mimeType = 'image/jpeg';
          const mimeMatch = split[0].match(/data:(.*?);/);
          if (mimeMatch) mimeType = mimeMatch[1];
          const base64Data = split[1]?.trim();
          if (base64Data) {
            parts.push({
              inlineData: {
                mimeType,
                data: base64Data,
              },
            });
          }
        } else {
          const cleaned = photoBase64.replace(/\s/g, '');
          if (/^[A-Za-z0-9+/=]+$/.test(cleaned) && cleaned.length > 50) {
            parts.push({
              inlineData: {
                mimeType: 'image/jpeg',
                data: cleaned,
              },
            });
          }
        }
      }

      const promptText = `
Проведи глубокий синестетический аудио-инженерный анализ кадра и составь саундтрек для Speed of Sound:
${moodText ? `Текстовый контекст вайба: "${moodText}"` : 'Анализируй визуальное настроение, текстуры, свет и геометрию прикрепленного фото.'}
Извлеки физический тембр, кривые энергии и акустический ландшафт для точного резонанса с аудиотекой.
`;
      parts.push({ text: promptText });

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          mood_tags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Vibe hashtags',
          },
          genres: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Curated music subgenres',
          },
          target_bpm: {
            type: Type.INTEGER,
            description: 'Target tempo BPM from 70 to 165',
          },
          energy_level: {
            type: Type.INTEGER,
            description: 'Energy rating from 1 to 10',
          },
          vibe_verdict: {
            type: Type.STRING,
            description: 'Deep editorial verdict in Russian',
          },
          dominant_colors: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '3-4 dominant colors in Russian',
          },
          location_setting: {
            type: Type.STRING,
            description: 'Detected location environment in Russian',
          },
          time_of_day: {
            type: Type.STRING,
            description: 'Detected time or lighting in Russian',
          },
          visual_atmosphere: {
            type: Type.STRING,
            description: 'Detailed lighting and visual texture in Russian',
          },
          emotional_depth: {
            type: Type.STRING,
            description: 'Psychological undercurrent and mood depth in Russian',
          },
          cinematic_scene: {
            type: Type.STRING,
            description: 'Cinematic scene description in Russian',
          },
          acoustic_profile: {
            type: Type.OBJECT,
            properties: {
              sub_bass: { type: Type.STRING },
              percussion: { type: Type.STRING },
              space: { type: Type.STRING },
            },
            required: ['sub_bass', 'percussion', 'space'],
          },
          timbre_profile: {
            type: Type.OBJECT,
            properties: {
              texture: { type: Type.STRING, description: 'Sonic material description' },
              brightness: {
                type: Type.STRING,
                description: 'dark, mellow, warm, balanced, bright, or crystalline',
              },
              grain_and_saturation: { type: Type.STRING, description: 'Saturation and noise character' },
              harmonic_density: {
                type: Type.STRING,
                description: 'sparse_minimal, focused_monophonic, rich_polyphonic, or dense_multilayered',
              },
              spectral_weight: { type: Type.STRING, description: 'Bass vs midrange vs high-end distribution' },
            },
            required: ['texture', 'brightness', 'grain_and_saturation', 'harmonic_density', 'spectral_weight'],
          },
          energy_curve: {
            type: Type.OBJECT,
            properties: {
              curve_type: {
                type: Type.STRING,
                description: 'hypnotic_linear, slow_crescendo_to_drop, undulating_waves, explosive_burst, nocturnal_drift, or staccato_stomp',
              },
              tempo_feel: { type: Type.STRING, description: 'Groove and micro-timing feel' },
              dynamic_tension: { type: Type.STRING, description: 'Suspense and dynamic contour' },
              peak_profile: {
                type: Type.STRING,
                description: 'intro_peak, mid_drop, extended_crescendo, continuous_pulse, or subdued_valley',
              },
            },
            required: ['curve_type', 'tempo_feel', 'dynamic_tension', 'peak_profile'],
          },
          acoustic_landscape: {
            type: Type.OBJECT,
            properties: {
              space_type: { type: Type.STRING, description: 'Virtual acoustic room or space' },
              reverb_decay_time: { type: Type.STRING, description: 'RT60 reverb decay' },
              stereo_dimension: {
                type: Type.STRING,
                description: 'tight_mono_intimate, wide_panoramic_stereo, binaural_3d_surround, or disorienting_haas_effect',
              },
              environmental_cues: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Foley ambient cues',
              },
            },
            required: ['space_type', 'reverb_decay_time', 'stereo_dimension', 'environmental_cues'],
          },
          synesthetic_transduction: {
            type: Type.STRING,
            description: 'Explanation of how image features transduced into sound',
          },
          curated_tracks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                artist: { type: Type.STRING },
                title: { type: Type.STRING },
                bpm: { type: Type.INTEGER },
                energy: { type: Type.INTEGER },
                genres: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                curator_reason: { type: Type.STRING },
                synthPreset: { type: Type.STRING },
              },
              required: ['artist', 'title', 'bpm', 'energy', 'genres', 'curator_reason'],
            },
            description: 'List of 10 to 16 real curated tracks specifically chosen for this moment',
          },
        },
        required: [
          'mood_tags',
          'genres',
          'target_bpm',
          'energy_level',
          'vibe_verdict',
          'dominant_colors',
          'location_setting',
          'time_of_day',
          'visual_atmosphere',
          'emotional_depth',
          'acoustic_profile',
          'cinematic_scene',
          'timbre_profile',
          'energy_curve',
          'acoustic_landscape',
          'synesthetic_transduction',
          'curated_tracks',
        ],
      };

      // Model cascade to handle per-model rate limits or quota constraints gracefully
      const candidateModels = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];

      for (const model of candidateModels) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: { parts },
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema,
            },
          });

          const rawText = response.text?.trim();
          if (rawText) {
            const parsed = JSON.parse(rawText) as any;
            vibeData = {
              mood_tags: parsed.mood_tags,
              genres: parsed.genres,
              target_bpm: parsed.target_bpm,
              energy_level: parsed.energy_level,
              vibe_verdict: parsed.vibe_verdict,
              dominant_colors: parsed.dominant_colors,
              location_setting: parsed.location_setting,
              time_of_day: parsed.time_of_day,
              visual_atmosphere: parsed.visual_atmosphere,
              emotional_depth: parsed.emotional_depth,
              acoustic_profile: parsed.acoustic_profile,
              cinematic_scene: parsed.cinematic_scene,
              timbre_profile: parsed.timbre_profile,
              energy_curve: parsed.energy_curve,
              acoustic_landscape: parsed.acoustic_landscape,
              synesthetic_transduction: parsed.synesthetic_transduction,
            };

            if (Array.isArray(parsed.curated_tracks) && parsed.curated_tracks.length > 0) {
              const presets = ['uk_garage', 'dark_wave', 'lofi_hiphop', 'phonk', 'downtempo', 'techno'] as const;
              geminiCuratedTracks = parsed.curated_tracks.map((t: any, idx: number) => {
                const artistClean = (t.artist || 'Speed of Sound').trim();
                const titleClean = (t.title || `Track ${idx + 1}`).trim();
                const query = encodeURIComponent(`${artistClean} ${titleClean}`);
                const preset = presets.includes(t.synthPreset) ? t.synthPreset : 'uk_garage';
                return {
                  id: `gemini-${idx + 1}-${Date.now()}`,
                  artist: artistClean,
                  title: titleClean,
                  bpm: Number(t.bpm) || vibeData!.target_bpm || 130,
                  energy: Number(t.energy) || vibeData!.energy_level || 7,
                  genres: Array.isArray(t.genres) && t.genres.length > 0 ? t.genres : vibeData!.genres,
                  moods: vibeData!.mood_tags.slice(0, 3),
                  vibeTags: vibeData!.mood_tags.slice(0, 4),
                  coverColor: ['#8b5cf6', '#3b82f6', '#06b6d4', '#ec4899', '#6366f1'][idx % 5],
                  previewNote: `${t.bpm || 130} BPM // ${preset.replace('_', ' ').toUpperCase()}`,
                  synthPreset: preset,
                  curatorReason: t.curator_reason,
                  timbreProfile: vibeData?.timbre_profile,
                  energyCurve: vibeData?.energy_curve,
                  acousticLandscape: vibeData?.acoustic_landscape,
                  links: {
                    spotify: `https://open.spotify.com/search/${query}`,
                    yandex: `https://music.yandex.ru/search?text=${query}`,
                    apple: `https://music.apple.com/search?term=${query}`,
                  },
                } as Track;
              });
            }

            // Success with this model!
            break;
          }
        } catch (modelErr: any) {
          const status = modelErr?.status || modelErr?.code;
          console.warn(`[Speed of Sound] Gemini ${model} notice (${status || 'fallback'}). Trying next model or editorial engine.`);
        }
      }
    }

    // If Gemini wasn't configured, failed or hit rate limits, seamlessly use Editorial Intelligence engine
    if (!vibeData) {
      vibeData = generateHeuristicVibe(moodText);
    }

    // Save to cache for ultra-fast subsequent lookups and quota preservation
    if (vibeData) {
      vibeAnalysisCache.set(cacheKey, {
        vibe: vibeData,
        curatedTracks: geminiCuratedTracks,
      });
    }

    // Prepare final playlist with real audio streaming resolution:
    // Build an expansive, multifaceted selection (18-24 tracks) combining Gemini's bespoke curation
    // with top complementary resonant catalog selections from SPEED_SOUND_TRACKS
    const catalogMatches = matchTracksToVibe(vibeData, 20);
    const combinedPlaylist: Track[] = [...geminiCuratedTracks];

    for (const catTrack of catalogMatches) {
      const isDuplicate = combinedPlaylist.some(
        (t) =>
          t.id === catTrack.id ||
          (t.artist.toLowerCase() === catTrack.artist.toLowerCase() &&
           t.title.toLowerCase() === catTrack.title.toLowerCase())
      );
      if (!isDuplicate) {
        combinedPlaylist.push(catTrack);
      }
      if (combinedPlaylist.length >= 22) break;
    }

    const rawPlaylist = combinedPlaylist.length >= 10 ? combinedPlaylist : catalogMatches;

    // Crucial step: Resolve real studio audio streams from iTunes / Apple Music CDN for each track!
    const playlist = await enrichTracksWithRealAudio(rawPlaylist);

    return res.json({
      gate_triggered: false,
      vibe: vibeData,
      playlist,
    });
  } catch (error) {
    console.error('Fatal /api/analyze-vibe error:', error);
    res.status(500).json({
      error: 'Ошибка при анализе настроения. Попробуйте еще раз.',
    });
  }
});

// --- USER PROFILE & AUTH ENDPOINTS ---
app.post('/api/auth/register', (req, res) => {
  try {
    const { username, password, displayName, telegramId } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }
    const user = storage.registerUser(username.trim(), password, displayName?.trim(), telegramId);
    res.json({ success: true, user });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Ошибка регистрации' });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Введите логин и пароль' });
    }
    const user = storage.loginUser(username.trim(), password);
    res.json({ success: true, user });
  } catch (err: any) {
    res.status(401).json({ error: err.message || 'Неверные данные для входа' });
  }
});

app.post('/api/auth/telegram-sync', (req, res) => {
  try {
    const { id, first_name, username } = req.body || {};
    if (!id) {
      return res.status(400).json({ error: 'Telegram ID обязателен' });
    }
    const user = storage.syncTelegramUser({ id, first_name: first_name || 'Listener', username });
    res.json({ success: true, user });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/user/:id', (req, res) => {
  const user = storage.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ user });
});

// --- SAVED PLAYLISTS & HISTORY ENDPOINTS ---
app.post('/api/playlists', (req, res) => {
  try {
    const { userId, authorName, name, customTags, vibe, tracks, photoUrl, moodText } = req.body || {};
    if (!userId || !tracks || !vibe) {
      return res.status(400).json({ error: 'Недостаточно данных для сохранения плейлиста' });
    }
    const saved = storage.createPlaylist(
      userId,
      authorName || 'Слушатель',
      name || 'Саундтрек момента',
      customTags || [],
      vibe,
      tracks,
      photoUrl,
      moodText
    );
    res.json({ success: true, playlist: saved });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Ошибка сохранения' });
  }
});

app.get('/api/playlists/user/:userId', (req, res) => {
  const playlists = storage.getUserPlaylists(req.params.userId);
  res.json({ playlists });
});

app.get('/api/playlists/:id', (req, res) => {
  const playlist = storage.getPlaylistById(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Плейлист не найден' });
  res.json({ playlist });
});

app.put('/api/playlists/:id', (req, res) => {
  try {
    const { userId, name, customTags } = req.body || {};
    const updated = storage.updatePlaylist(req.params.id, userId, { name, customTags });
    res.json({ success: true, playlist: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/playlists/:id', (req, res) => {
  try {
    const { userId } = req.body || {};
    const success = storage.deletePlaylist(req.params.id, userId);
    res.json({ success });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- PLAYLIST SHARING & COLLABORATION ENDPOINTS ---
app.get('/api/playlists/share/:shareCode', (req, res) => {
  const playlist = storage.getPlaylistByShareCode(req.params.shareCode);
  if (!playlist) return res.status(404).json({ error: 'Плейлист не найден или срок ссылки истек' });
  res.json({ playlist });
});

app.post('/api/playlists/share/:shareCode/add-track', (req, res) => {
  try {
    const { track, addedBy, comment } = req.body || {};
    if (!track) {
      return res.status(400).json({ error: 'Необходимо указать трек' });
    }
    const updated = storage.addCollaborativeTrack(
      req.params.shareCode,
      track,
      addedBy || 'Друг',
      comment
    );
    res.json({ success: true, playlist: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Vite & Static middleware setup
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Speed of Sound TMA server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

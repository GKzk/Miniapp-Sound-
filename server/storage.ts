import fs from 'fs';
import path from 'path';
import type { UserProfile, SavedPlaylist, Track, VibeAnalysis, CollaborativeTrackItem } from '../src/types';

interface UserRecord extends UserProfile {
  passwordHash?: string;
}

interface StoreData {
  users: Record<string, UserRecord>;
  playlists: Record<string, SavedPlaylist>;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

// Ensure directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

class StorageManager {
  private data: StoreData = {
    users: {},
    playlists: {},
  };

  constructor() {
    this.load();
    this.seedDefaultUser();
  }

  private load() {
    try {
      if (fs.existsSync(STORE_FILE)) {
        const raw = fs.readFileSync(STORE_FILE, 'utf-8');
        this.data = JSON.parse(raw);
      }
    } catch (err) {
      console.warn('Could not load store.json, starting with fresh store:', err);
    }
  }

  private save() {
    try {
      fs.writeFileSync(STORE_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to write store.json:', err);
    }
  }

  private seedDefaultUser() {
    if (!this.data.users['usr_demo']) {
      this.data.users['usr_demo'] = {
        id: 'usr_demo',
        username: 'listener',
        displayName: 'Speed Listener',
        avatarUrl: '',
        telegramId: 10842099,
        isSubscribed: true,
        createdAt: new Date().toISOString(),
        passwordHash: 'demo123',
      };
      this.save();
    }
  }

  public registerUser(username: string, passwordHash: string, displayName?: string, telegramId?: number): UserProfile {
    const existing = Object.values(this.data.users).find(
      (u) => u.username.toLowerCase() === username.toLowerCase()
    );
    if (existing) {
      throw new Error('Пользователь с таким логином уже существует');
    }

    const id = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const user: UserRecord = {
      id,
      username,
      displayName: displayName || username,
      avatarUrl: '',
      telegramId,
      isSubscribed: false,
      createdAt: new Date().toISOString(),
      passwordHash,
    };

    this.data.users[id] = user;
    this.save();
    return this.sanitizeUser(user);
  }

  public loginUser(username: string, passwordHash: string): UserProfile {
    const user = Object.values(this.data.users).find(
      (u) => u.username.toLowerCase() === username.toLowerCase() && u.passwordHash === passwordHash
    );
    if (!user) {
      throw new Error('Неверное имя пользователя или пароль');
    }
    return this.sanitizeUser(user);
  }

  public syncTelegramUser(telegramUser: { id: number; first_name: string; username?: string }): UserProfile {
    // Find existing by telegramId
    let user = Object.values(this.data.users).find((u) => u.telegramId === telegramUser.id);
    if (!user) {
      const id = `usr_tg_${telegramUser.id}`;
      user = {
        id,
        username: telegramUser.username || `user_${telegramUser.id}`,
        displayName: telegramUser.first_name,
        telegramId: telegramUser.id,
        isSubscribed: false,
        createdAt: new Date().toISOString(),
      };
      this.data.users[id] = user;
      this.save();
    }
    return this.sanitizeUser(user);
  }

  public getUserById(id: string): UserProfile | null {
    const user = this.data.users[id];
    return user ? this.sanitizeUser(user) : null;
  }

  private sanitizeUser(record: UserRecord): UserProfile {
    const { passwordHash, ...rest } = record;
    return rest;
  }

  // Playlist management
  public createPlaylist(
    userId: string,
    authorName: string,
    name: string,
    customTags: string[],
    vibe: VibeAnalysis,
    tracks: Track[],
    photoUrl?: string,
    moodText?: string
  ): SavedPlaylist {
    const id = `pl_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const shareCode = `vibe-${Math.random().toString(36).substring(2, 8)}`;

    const playlist: SavedPlaylist = {
      id,
      userId,
      authorName,
      name: name.trim() || 'Саундтрек момента',
      customTags: customTags || [],
      createdAt: new Date().toISOString(),
      photoUrl,
      moodText,
      vibe,
      tracks,
      collaborativeTracks: [],
      shareCode,
      viewsCount: 0,
    };

    this.data.playlists[id] = playlist;
    this.save();
    return playlist;
  }

  public getUserPlaylists(userId: string): SavedPlaylist[] {
    return Object.values(this.data.playlists)
      .filter((pl) => pl.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public getPlaylistById(id: string): SavedPlaylist | null {
    return this.data.playlists[id] || null;
  }

  public getPlaylistByShareCode(code: string): SavedPlaylist | null {
    const playlist = Object.values(this.data.playlists).find(
      (pl) => pl.shareCode.toLowerCase() === code.toLowerCase() || pl.id === code
    );
    if (playlist) {
      playlist.viewsCount = (playlist.viewsCount || 0) + 1;
      this.save();
      return playlist;
    }
    return null;
  }

  public updatePlaylist(
    id: string,
    userId: string,
    updates: { name?: string; customTags?: string[] }
  ): SavedPlaylist {
    const playlist = this.data.playlists[id];
    if (!playlist) throw new Error('Плейлист не найден');
    if (playlist.userId !== userId) throw new Error('Нет прав на редактирование');

    if (updates.name !== undefined) playlist.name = updates.name.trim() || playlist.name;
    if (updates.customTags !== undefined) playlist.customTags = updates.customTags;

    this.save();
    return playlist;
  }

  public deletePlaylist(id: string, userId: string): boolean {
    const playlist = this.data.playlists[id];
    if (!playlist) return false;
    if (playlist.userId !== userId) throw new Error('Нет прав на удаление');

    delete this.data.playlists[id];
    this.save();
    return true;
  }

  public addCollaborativeTrack(
    shareCode: string,
    track: Track,
    addedBy: string,
    comment?: string
  ): SavedPlaylist {
    const playlist = this.getPlaylistByShareCode(shareCode);
    if (!playlist) throw new Error('Плейлист не найден');

    if (!playlist.collaborativeTracks) {
      playlist.collaborativeTracks = [];
    }

    const item: CollaborativeTrackItem = {
      track,
      addedBy: addedBy.trim() || 'Друг',
      addedAt: new Date().toISOString(),
      comment: comment?.trim(),
    };

    playlist.collaborativeTracks.push(item);
    this.save();
    return playlist;
  }
}

export const storage = new StorageManager();

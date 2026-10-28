import { dashboardStorage } from "./idbStorage";

// Playground module: alert sound registry + playback.
// Preset sounds are edge-tts generated Chinese voice prompts served from
// /sounds/ (playground/public/sounds). A custom sound uploaded by the user is
// stored as a data URL in the IndexedDB-backed dashboard storage (see
// idbStorage.ts) and appended to the preset list.
// Pure helpers (buildSoundList / resolveSelectedSound) are unit-tested.

export interface AlertSound {
    id: string;
    name: string;
    /** URL or data: URL of the audio file. */
    src: string;
    /** True for the bundled edge-tts presets. */
    builtIn: boolean;
}

export const ALERT_SOUNDS_KEY = "vela-dashboard-alert-sound";
export const ALERT_CUSTOM_SOUND_KEY = "vela-dashboard-alert-sound-custom";
export const CUSTOM_SOUND_ID = "custom";
export const DEFAULT_SOUND_ID = "default";

/** Bundled presets (see playground/public/sounds). The base alert prompts are
 * edge-tts generated Chinese voice prompts; the pinyin-named entries are the
 * user's own downloaded alert tones, kept under their pinyin file names. */
export const PRESET_SOUNDS: AlertSound[] = [
    { id: DEFAULT_SOUND_ID, name: "默认提示（系统提示）", src: "sounds/alert-default.mp3", builtIn: true },
    { id: "price", name: "价格告警", src: "sounds/alert-price.mp3", builtIn: true },
    { id: "surge", name: "爆拉提示", src: "sounds/alert-surge.mp3", builtIn: true },
    { id: "dump", name: "暴跌提示", src: "sounds/alert-dump.mp3", builtIn: true },
    { id: "disconnect", name: "断线警告", src: "sounds/alert-disconnect.mp3", builtIn: true },
    { id: "reconnect", name: "连接恢复", src: "sounds/alert-reconnect.mp3", builtIn: true },
    { id: "baojinbi", name: "baojinbi", src: "sounds/baojinbi.mp3", builtIn: true },
    { id: "daojishi", name: "daojishi", src: "sounds/daojishi.mp3", builtIn: true },
    { id: "daqikaichang", name: "daqikaichang", src: "sounds/daqikaichang.mp3", builtIn: true },
    { id: "dingding", name: "dingding", src: "sounds/dingding.mp3", builtIn: true },
    { id: "gaokeji", name: "gaokeji", src: "sounds/gaokeji.mp3", builtIn: true },
    { id: "laidian", name: "laidian", src: "sounds/laidian.mp3", builtIn: true },
    { id: "laoshidianhua", name: "laoshidianhua", src: "sounds/laoshidianhua.mp3", builtIn: true },
    { id: "mofabang", name: "mofabang", src: "sounds/mofabang.mp3", builtIn: true },
    { id: "weixinlaidian", name: "weixinlaidian", src: "sounds/weixinlaidian.mp3", builtIn: true },
    { id: "wuyajiao", name: "wuyajiao", src: "sounds/wuyajiao.mp3", builtIn: true },
    { id: "xiaoxi2", name: "xiaoxi2", src: "sounds/xiaoxi2.mp3", builtIn: true },
    { id: "xiaoxi3", name: "xiaoxi3", src: "sounds/xiaoxi3.mp3", builtIn: true },
    { id: "xiaoxitixin", name: "xiaoxitixin", src: "sounds/xiaoxitixin.mp3", builtIn: true },
    { id: "xieloujingbao", name: "xieloujingbao", src: "sounds/xieloujingbao.mp3", builtIn: true },
    { id: "xixiuge", name: "xixiuge", src: "sounds/xixiuge.mp3", builtIn: true },
    { id: "yingyue", name: "yingyue", src: "sounds/yingyue.mp3", builtIn: true },
];

/** Presets + the uploaded custom sound (if any) in display order. */
export function buildSoundList(custom: AlertSound | null): AlertSound[] {
    return custom ? [...PRESET_SOUNDS, custom] : [...PRESET_SOUNDS];
}

/** Resolve the selected sound id against the available list, falling back to default. */
export function resolveSelectedSound(sounds: AlertSound[], selectedId: string): AlertSound {
    return (
        sounds.find((s) => s.id === selectedId) ??
        sounds.find((s) => s.id === DEFAULT_SOUND_ID) ??
        sounds[0]! ??
        PRESET_SOUNDS[0]!
    );
}

// ── Persistence (IndexedDB-backed, see idbStorage.ts) ──────────

export function loadSelectedSoundId(): string {
    try {
        return dashboardStorage.getItem(ALERT_SOUNDS_KEY) ?? DEFAULT_SOUND_ID;
    } catch {
        return DEFAULT_SOUND_ID;
    }
}

export function saveSelectedSoundId(id: string): void {
    try {
        dashboardStorage.setItem(ALERT_SOUNDS_KEY, id);
    } catch {
        /* storage unavailable → session-only selection */
    }
}

export function loadCustomSound(): AlertSound | null {
    try {
        const raw = dashboardStorage.getItem(ALERT_CUSTOM_SOUND_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { name?: unknown; src?: unknown };
        if (typeof parsed.src !== "string" || !parsed.src) return null;
        return {
            id: CUSTOM_SOUND_ID,
            name: typeof parsed.name === "string" && parsed.name ? parsed.name : "自定义声音",
            src: parsed.src,
            builtIn: false,
        };
    } catch {
        return null;
    }
}

export function saveCustomSound(name: string, src: string): AlertSound {
    const sound: AlertSound = {
        id: CUSTOM_SOUND_ID,
        name: name.trim() || "自定义声音",
        src,
        builtIn: false,
    };
    try {
        dashboardStorage.setItem(ALERT_CUSTOM_SOUND_KEY, JSON.stringify({ name: sound.name, src: sound.src }));
    } catch {
        /* storage unavailable → custom sound lasts for this session only */
    }
    return sound;
}

export function clearCustomSound(): void {
    try {
        dashboardStorage.removeItem(ALERT_CUSTOM_SOUND_KEY);
    } catch {
        /* ignore */
    }
}

// ── playback (browser only) ──────────────────────────────────────

export function playSound(sound: AlertSound): void {
    try {
        const audio = new Audio(sound.src);
        audio.volume = 0.8;
        void audio.play();
    } catch {
        /* audio unavailable → silent alert */
    }
}

/** Play the currently selected alert sound (price/surge/connection alerts). */
export function playAlertSound(): void {
    playSound(resolveSelectedSound(buildSoundList(loadCustomSound()), loadSelectedSoundId()));
}
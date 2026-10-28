import { describe, it, expect } from "vitest";
import {
    buildSoundList,
    resolveSelectedSound,
    CUSTOM_SOUND_ID,
    DEFAULT_SOUND_ID,
    PRESET_SOUNDS,
    type AlertSound,
} from "../playground/alertSounds";
import dashboardHtml from "../playground/dashboard.html?raw";
import dashboardSource from "../playground/dashboard.ts?raw";

const custom: AlertSound = {
    id: CUSTOM_SOUND_ID,
    name: "我的声音",
    src: "data:audio/mp3;base64,AAAA",
    builtIn: false,
};

describe("buildSoundList", () => {
    it("returns only presets when no custom sound exists", () => {
        const sounds = buildSoundList(null);
        expect(sounds).toHaveLength(PRESET_SOUNDS.length);
        expect(sounds[0]!.id).toBe(DEFAULT_SOUND_ID);
        expect(sounds.every((s) => s.builtIn)).toBe(true);
    });

    it("appends the custom sound after the presets", () => {
        const sounds = buildSoundList(custom);
        expect(sounds).toHaveLength(PRESET_SOUNDS.length + 1);
        expect(sounds[sounds.length - 1]).toEqual(custom);
        expect(sounds.find((s) => s.id === CUSTOM_SOUND_ID)).toBe(custom);
    });
});

describe("resolveSelectedSound", () => {
    it("returns the selected sound when it exists", () => {
        const sounds = buildSoundList(custom);
        expect(resolveSelectedSound(sounds, "surge")).toBe(sounds.find((s) => s.id === "surge"));
    });

    it("falls back to the default preset for unknown ids", () => {
        const sounds = buildSoundList(custom);
        expect(resolveSelectedSound(sounds, "missing")).toBe(
            sounds.find((s) => s.id === DEFAULT_SOUND_ID),
        );
    });

    it("falls back to the default when the custom selection no longer exists", () => {
        const presetsOnly = buildSoundList(null);
        expect(resolveSelectedSound(presetsOnly, CUSTOM_SOUND_ID)).toBe(
            presetsOnly.find((s) => s.id === DEFAULT_SOUND_ID),
        );
    });

    it("never returns undefined even for an empty list", () => {
        expect(resolveSelectedSound([], "x")).toBe(PRESET_SOUNDS[0]);
    });
});

describe("user-downloaded pinyin sounds", () => {
    it("registers the pinyin-named downloaded tones as bundled presets", () => {
        expect(PRESET_SOUNDS.some((s) => s.id === "baojinbi" && s.src === "sounds/baojinbi.mp3")).toBe(true);
        expect(PRESET_SOUNDS.some((s) => s.id === "weixinlaidian" && s.src === "sounds/weixinlaidian.mp3")).toBe(true);
        expect(PRESET_SOUNDS.some((s) => s.id === "yingyue" && s.src === "sounds/yingyue.mp3")).toBe(true);
        expect(PRESET_SOUNDS.length).toBeGreaterThan(6);
    });
});

describe("alert sound dropdown in settings", () => {
    it("replaces the old list with a dropdown and keeps a preview button", () => {
        expect(dashboardHtml).toContain('id="sound-select"');
        expect(dashboardHtml).toContain('id="sound-preview"');
        expect(dashboardHtml).not.toContain('id="sound-list"');
    });

    it("wires the dropdown to save and preview the selected sound", () => {
        expect(dashboardSource).toContain('const soundSelect = document.getElementById("sound-select")');
        expect(dashboardSource).toContain("soundSelect.addEventListener(\"change\"");
        expect(dashboardSource).toContain("saveSelectedSoundId(sound.id)");
        expect(dashboardSource).toContain("playSound(sound)");
    });

    it("wires the preview button to play the currently selected sound", () => {
        expect(dashboardSource).toContain('const soundPreviewBtn = document.getElementById("sound-preview")');
        expect(dashboardSource).toContain('soundPreviewBtn.addEventListener("click"');
    });
});
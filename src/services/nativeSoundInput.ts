import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { SoundEventInput } from "./soundEventService";

export type NativeSoundLevel = {
  runId: string; rms: number; displayRms: number; peak: number; dbFS: number;
  bufferCount: number; frameCount: number; sampleRate: number; channels: number; detected: boolean;
};
export type NativeSoundSession = { runId: string; userId: string; babyId: string; sleepId: string; threshold: number;
  lease: { url: string; token: string; expiresAt: number } };
export type NativeSoundStatus = {
  active: boolean; running: boolean; status: string; queueCount: number;
  runId?: string; userId?: string; babyId?: string; sleepId?: string; threshold?: number; stopReason?: string;
};
export type QueuedNativeSoundEvent = Omit<SoundEventInput, "started_at" | "ended_at" | "event_type"> & { startMs: number; endMs: number };
type SoundMeterPlugin = {
  start(options: NativeSoundSession): Promise<void>;
  stop(options: { runId: string; reason?: string }): Promise<void>;
  getState(): Promise<NativeSoundStatus>;
  getEvents(options: { userId: string }): Promise<{ events: QueuedNativeSoundEvent[] }>;
  acknowledge(options: { userId: string; ids: string[] }): Promise<void>;
  addListener(event: "level", listener: (level: NativeSoundLevel) => void): Promise<PluginListenerHandle>;
  addListener(event: "state", listener: (state: NativeSoundStatus) => void): Promise<PluginListenerHandle>;
  addListener(event: "eventsAvailable", listener: () => void): Promise<PluginListenerHandle>;
  addListener(event: "stopped", listener: (event: { runId: string; reason: string }) => void): Promise<PluginListenerHandle>;
};
export const nativeSoundMeter = registerPlugin<SoundMeterPlugin>("SleepySoundMeter");

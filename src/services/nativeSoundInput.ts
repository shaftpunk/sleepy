import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type NativeSoundLevel = {
  runId: string; rms: number; peak: number; dbFS: number;
  bufferCount: number; frameCount: number; sampleRate: number; channels: number;
};
type SoundMeterPlugin = {
  start(options: { runId: string }): Promise<void>;
  stop(options: { runId: string }): Promise<void>;
  addListener(event: "level", listener: (level: NativeSoundLevel) => void): Promise<PluginListenerHandle>;
  addListener(event: "stopped", listener: (event: { runId: string; reason: string }) => void): Promise<PluginListenerHandle>;
};
const meter = registerPlugin<SoundMeterPlugin>("SleepySoundMeter");

// Only derived numbers cross this boundary. No audio buffer/file/stream API.
export class NativeSoundInput {
  private readonly runId = crypto.randomUUID();
  private stopped = false;
  private handles: PluginListenerHandle[] = [];
  private lastLog = 0;

  async start(onLevel: (rms: number) => void, onStopped: () => void): Promise<void> {
    try {
      const level = await meter.addListener("level", value => {
        if (this.stopped || value.runId !== this.runId) return;
        if (!Number.isFinite(value.rms) || value.rms < 0 || value.rms > 1 ||
          !Number.isFinite(value.peak) || value.peak < 0 || value.peak > 1 ||
          !Number.isFinite(value.sampleRate) || value.sampleRate <= 0 ||
          !Number.isInteger(value.channels) || value.channels <= 0 ||
          !Number.isInteger(value.frameCount) || value.frameCount <= 0 ||
          !Number.isInteger(value.bufferCount) || value.bufferCount <= 0) {
          console.warn("[Sleepy sound] Invalid native level metadata; stopping capture");
          onStopped(); return;
        }
        // TEMPORARY diagnostics: never log the entire bridge event or raw audio.
        if (Date.now() - this.lastLog >= 1000) {
          this.lastLog = Date.now();
          console.info("[Sleepy sound] bridge level received", { rms: value.rms, peak: value.peak,
            dbFS: Number.isFinite(value.dbFS) ? value.dbFS : null, sampleRate: value.sampleRate,
            channels: value.channels, frameCount: value.frameCount, bufferCount: value.bufferCount });
        }
        onLevel(value.rms); // Linear amplitude, never convert dB into detector input.
      });
      this.handles.push(level);
      if (this.stopped) { this.removeListeners(); return; }
      const stopped = await meter.addListener("stopped", event => {
        if (!this.stopped && event.runId === this.runId) onStopped();
      });
      this.handles.push(stopped);
      if (this.stopped) { this.removeListeners(); return; }
      console.info("[Sleepy sound] native listeners ready; starting input");
      await meter.start({ runId: this.runId });
      if (this.stopped) await meter.stop({ runId: this.runId });
    } catch (error) {
      await this.stop().catch(() => {});
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.removeListeners();
    await meter.stop({ runId: this.runId });
  }
  private removeListeners() {
    this.handles.splice(0).forEach(handle => { void handle.remove().catch(() => {}); });
  }
}

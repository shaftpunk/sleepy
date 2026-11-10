import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type NativeSoundLevel = {
  runId: string; rms: number; peak: number; dbFS: number;
  bufferCount: number; frameCount: number; sampleRate: number; channels: number;
};
type SoundMeterPlugin = {
  start(options: { runId: string }): Promise<void>;
  stop(options: { runId: string; reason?: string }): Promise<void>;
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
  private firstLevel = false;
  private ignoredLevelLogged = false;

  async start(onLevel: (rms: number) => void, onStopped: (reason: string) => void): Promise<void> {
    try {
      const level = await meter.addListener("level", value => {
        if (this.stopped || value.runId !== this.runId) {
          if (!this.ignoredLevelLogged) {
            this.ignoredLevelLogged = true;
            console.info("[Sleepy sound] level ignored", { stopped: this.stopped, runMatches: value.runId === this.runId });
          }
          return;
        }
        if (!Number.isFinite(value.rms) || value.rms < 0 || value.rms > 1 ||
          !Number.isFinite(value.peak) || value.peak < 0 || value.peak > 1 ||
          !Number.isFinite(value.sampleRate) || value.sampleRate <= 0 ||
          !Number.isInteger(value.channels) || value.channels <= 0 ||
          !Number.isInteger(value.frameCount) || value.frameCount <= 0 ||
          !Number.isInteger(value.bufferCount) || value.bufferCount <= 0) {
          console.warn("[Sleepy sound] Invalid native level metadata; stopping capture");
          onStopped("invalid-native-level-metadata"); return;
        }
        if (!this.firstLevel) { this.firstLevel = true; console.info("[Sleepy sound] first level received"); }
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
      console.info("[Sleepy sound] listener installed", { event: "level" });
      if (this.stopped) { this.removeListeners(); return; }
      const stopped = await meter.addListener("stopped", event => {
        if (!this.stopped && event.runId === this.runId) {
          // Reasons are fixed native literals; never log arbitrary event data.
          const allowed = ["scene-background", "app-background", "audio-services-reset", "interrupted", "input-route-changed",
            "engine-configuration-changed", "cancelled", "stopped", "start-failed", "invalid-input-format"];
          const reason = allowed.includes(event.reason) ? event.reason : "unknown-native-stop";
          console.info(`[Sleepy sound] native stopped reason=${reason}`);
          onStopped(`native:${reason}`);
        }
      });
      this.handles.push(stopped);
      console.info("[Sleepy sound] listener installed", { event: "stopped" });
      if (this.stopped) { this.removeListeners(); return; }
      console.info("[Sleepy sound] native start requested");
      await meter.start({ runId: this.runId });
      console.info("[Sleepy sound] native start resolved", { stoppedDuringStart: this.stopped, firstLevelReceived: this.firstLevel });
      if (this.stopped) await meter.stop({ runId: this.runId, reason: "cancelled-start-completed" });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : "";
      const safeCode = ["START_FAILED", "UNAVAILABLE", "CANCELLED", "PERMISSION_DENIED"].includes(String(code)) ? code : "unknown";
      console.warn("[Sleepy sound] native start rejected", { code: safeCode });
      await this.stop("native-start-rejected").catch(() => {});
      throw error;
    }
  }

  async stop(reason = "stop"): Promise<void> {
    if (this.stopped) return;
    console.info(`[Sleepy sound] adapter stop requested reason=${reason}`);
    this.stopped = true;
    this.removeListeners();
    await meter.stop({ runId: this.runId, reason });
  }
  private removeListeners() {
    if (this.handles.length) console.info("[Sleepy sound] listeners removing", { count: this.handles.length });
    this.handles.splice(0).forEach(handle => { void handle.remove().catch(() => {}); });
  }
}

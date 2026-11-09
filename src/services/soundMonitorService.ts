import { SoundDetector, THRESHOLDS, type Sensitivity, type SoundObservation } from "../sound/detector";
import { Capacitor } from "@capacitor/core";
import { isSessionGenerationCurrent, registerBeforeSignOut, sessionGeneration } from "../auth/sessionLifecycle";

export const isNativeSoundIOS = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";

export type MonitorStatus = "off" | "starting" | "listening" | "detected" | "blocked" | "unsupported" | "unavailable" | "paused" | "error";
export type MonitorState = { status: MonitorStatus; level: number };

export class SoundMonitor {
  private stopped = false;
  private started = false;
  private nativeIOS = false;
  private generation = 0;
  private unregisterSignOut: (() => void) | null = null;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private detector: SoundDetector;
  private lastUi = 0;
  private lastSample: number | null = null;
  private update: (state: MonitorState) => void;

  constructor(sensitivity: Sensitivity, emit: (event: SoundObservation) => void,
    update: (state: MonitorState) => void) {
    this.update = update;
    this.detector = new SoundDetector(THRESHOLDS[sensitivity], emit);
  }

  async start(): Promise<void> {
    if (this.stopped || this.started) return;
    this.started = true;
    this.nativeIOS = isNativeSoundIOS();
    // WKWebView serves local capacitor:// assets, not a browser HTTPS URL.
    // The actual capture/analysis APIs must still exist; never fake support.
    if ((!this.nativeIOS && !window.isSecureContext) || !navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
      this.update({ status: this.nativeIOS ? "unavailable" : "unsupported", level: 0 }); return;
    }
    if (document.hidden) { this.interrupted(); return; }
    this.generation = sessionGeneration();
    this.unregisterSignOut = registerBeforeSignOut(async () => { this.interrupted(); });
    // Listen before awaiting permission so background/logout/unmount can cancel
    // a pending request. A late stream is stopped rather than adopted.
    document.addEventListener("visibilitychange", this.visibilityChanged);
    if (this.nativeIOS) document.addEventListener("pause", this.interrupted);
    window.addEventListener("pagehide", this.interrupted);
    this.update({ status: "starting", level: 0 });
    try {
      // Create/resume synchronously when invoked by the retry button on iOS.
      this.context = new AudioContext();
      void this.context.resume().catch(() => { /* State below offers a user-gesture retry. */ });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this.stopped || !isSessionGenerationCurrent(this.generation)) {
        stream.getTracks().forEach((track) => track.stop()); this.stop(); return;
      }
      this.stream = stream;
      if (document.hidden || this.context.state !== "running") {
        this.stop(); this.update({ status: "paused", level: 0 }); return;
      }
      this.source = this.context.createMediaStreamSource(stream);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.source.connect(this.analyser); // Never connect to speakers; no feedback.
      const samples = new Float32Array(this.analyser.fftSize);
      stream.getTracks().forEach((track) => {
        track.addEventListener("ended", this.interrupted);
        track.addEventListener("mute", this.interrupted);
      });
      this.context.addEventListener("statechange", this.stateChanged);
      this.timer = setInterval(() => {
        if (this.stopped || !this.analyser) return;
        if (!isSessionGenerationCurrent(this.generation) || document.hidden || this.context?.state !== "running") {
          this.interrupted(); return;
        }
        const now = Date.now();
        if (this.lastSample !== null && now - this.lastSample > 1000) {
          this.interrupted(); return;
        }
        this.lastSample = now;
        try { this.analyser.getFloatTimeDomainData(samples); }
        catch { this.stop(); this.update({ status: "error", level: 0 }); return; }
        const rms = Math.min(1, Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length));
        this.detector.sample(rms, now);
        if (now - this.lastUi >= 250) {
          this.lastUi = now;
          this.update({ status: this.detector.detected ? "detected" : "listening", level: rms });
        }
      }, 100);
      this.update({ status: "listening", level: 0 });
    } catch (error) {
      if (this.stopped) return;
      this.stop();
      const name = error instanceof DOMException ? error.name : "";
      const status = name === "NotAllowedError" ? "blocked"
        : this.nativeIOS && ["NotFoundError", "NotSupportedError", "SecurityError"].includes(name) ? "unavailable" : "error";
      this.update({ status, level: 0 });
    }
  }

  private interrupted = () => {
    if (this.stopped) return;
    this.stop(); this.update({ status: "paused", level: 0 });
  };
  private visibilityChanged = () => { if (document.hidden) this.interrupted(); };
  private stateChanged = () => { if (this.context?.state !== "running") this.interrupted(); };

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    if (this.nativeIOS) document.removeEventListener("pause", this.interrupted);
    window.removeEventListener("pagehide", this.interrupted);
    this.unregisterSignOut?.(); this.unregisterSignOut = null;
    this.context?.removeEventListener("statechange", this.stateChanged);
    this.stream?.getTracks().forEach((track) => {
      track.removeEventListener("ended", this.interrupted); track.stop();
      track.removeEventListener("mute", this.interrupted);
    });
    this.source?.disconnect(); this.analyser?.disconnect();
    if (this.context && this.context.state !== "closed") void this.context.close().catch(() => {});
    // Finalize only through the last observed sample, never across a suspension.
    this.detector.flush(this.lastSample ?? Date.now());
    this.stream = null; this.source = null; this.analyser = null; this.context = null;
  }
}

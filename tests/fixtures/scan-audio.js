// Observe real Web Audio nodes and sample the generated signal; no fake sound API.
export async function observeScanAudio(page) {
  return page.evaluate(() => {
    const NativeAudioContext = window.AudioContext || window.webkitAudioContext;
    if (typeof NativeAudioContext !== 'function') return false;
    window.scanAudio = { contexts: [], beeps: [], peak: 0 };
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        window.scanAudio.contexts.push(this);
        this.openedByGesture = navigator.userActivation.isActive;
        this.probe = this.createAnalyser();
        const samples = new Float32Array(this.probe.fftSize);
        const timer = setInterval(() => {
          if (this.state === 'closed') { clearInterval(timer); return; }
          this.probe.getFloatTimeDomainData(samples);
          for (const sample of samples) window.scanAudio.peak = Math.max(window.scanAudio.peak, Math.abs(sample));
        }, 10);
      }
      createGain() {
        const gain = super.createGain();
        gain.connect(this.probe);
        return gain;
      }
      createOscillator() {
        const oscillator = super.createOscillator();
        const beep = { ended: false };
        window.scanAudio.beeps.push(beep);
        oscillator.addEventListener('ended', () => { beep.ended = true; });
        return oscillator;
      }
    };
    return true;
  });
}

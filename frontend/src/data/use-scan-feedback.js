import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

const scanQuantity = new Intl.NumberFormat('es-DO', { maximumFractionDigits: 2 });
export function useScanFeedback() {
  const scanAudio = useRef(null);
  const scanToast = useRef(null);
  const prepareScanAudio = () => {
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!scanAudio.current && Audio) scanAudio.current = new Audio();
      const context = scanAudio.current;
      if (context && context.state !== 'running') context.resume().catch(() => {});
      return context;
    } catch { return null; }
  };
  const beep = async () => {
    const started = performance.now();
    const context = prepareScanAudio();
    if (!context) return;
    try {
      if (context.state !== 'running') await context.resume();
      // Never replay an old confirmation after a delayed permission or navigation.
      if (scanAudio.current !== context || document.hidden || context.state !== 'running' || performance.now() - started > 500) return;
      const tone = context.createOscillator();
      const volume = context.createGain();
      const now = context.currentTime;
      tone.frequency.value = 880;
      volume.gain.setValueAtTime(0, now);
      volume.gain.linearRampToValueAtTime(0.12, now + 0.01);
      volume.gain.setValueAtTime(0.12, now + 0.09);
      volume.gain.linearRampToValueAtTime(0, now + 0.14);
      tone.connect(volume);
      volume.connect(context.destination);
      tone.onended = () => { tone.disconnect(); volume.disconnect(); };
      tone.start(now);
      tone.stop(now + 0.14);
    } catch { /* The visual confirmation still works without an audio device. */ }
  };
  useEffect(() => () => {
    const context = scanAudio.current;
    scanAudio.current = null;
    context?.close().catch(() => {});
    if (scanToast.current !== null) toast.dismiss(scanToast.current);
  }, []);

  const dismissScan = () => {
    if (scanToast.current !== null) toast.dismiss(scanToast.current);
  };
  const confirmScan = (product, quantity, action) => {
    dismissScan();
    const message = `${scanQuantity.format(Number(quantity))} × ${product.name}`;
    scanToast.current = toast.success('Agregado a la venta', {
      description: message, duration: 2400, className: 'scan-confirmation', action,
    });
    void beep();
    return { ok: true, message };
  };
  return { prepareScanAudio, confirmScan, dismissScan };
}

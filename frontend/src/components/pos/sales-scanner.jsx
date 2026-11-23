import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ScanBarcode } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button.jsx';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip.jsx';
import { useSaleDraft } from '../../data/sale-draft.jsx';
import { createKeyboardScan, productForBarcode } from '../../data/barcode-scanner.js';
import { useScanFeedback } from '../../data/use-scan-feedback.js';

const editing = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="spinbutton"], [role="slider"]';
function blockedTarget(target) { return target instanceof Element && !!target.closest(editing); }

export function SalesScanner() {
  const draft = useSaleDraft();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem('felix-sales-scanner') !== 'off'; } catch { return true; }
  });
  const feedback = useScanFeedback();
  const latest = useRef(null);
  const paused = draft.locked || !!draft.receipt || !!draft.runtime.pending;
  latest.current = { draft, enabled, paused, feedback, pathname, navigate };
  const scanner = useRef(createKeyboardScan());
  useEffect(() => { scanner.current.reset(); }, [pathname, enabled, paused]);
  useEffect(() => {
    let spaceAction = null, spaceTimer = null;
    const cancelSpace = () => {
      clearTimeout(spaceTimer);
      spaceTimer = spaceAction = null;
    };
    const reset = () => { scanner.current.reset(); cancelSpace(); };
    const onKey = event => {
      const current = latest.current;
      if (!event.repeat) cancelSpace();
      if (!current.enabled || event.defaultPrevented || document.hidden || !document.hasFocus() ||
          blockedTarget(event.target) || blockedTarget(document.activeElement)) {
        reset(); return;
      }
      const code = scanner.current.push(event);
      // A barcode may BEGIN with Space. Defer a lone human Space on a button
      // briefly; subsequent reader keys cancel it before it can click/cobrar.
      const button = event.target.closest?.('button, [role="button"]');
      if (event.key === ' ' && button) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat && scanner.current.length === 1) spaceAction = button;
      }
      if (!code) return;
      // Consume the scanner's Enter before it can activate the focused button.
      event.preventDefault();
      event.stopPropagation();
      if (current.paused || event.target.closest?.('.sale-payment-content') ||
          document.querySelector('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"], .sale-summary[data-payment-open="true"]')) return;
      current.feedback.dismissScan();
      try {
        const product = productForBarcode(current.draft.products, code);
        if (!current.draft.editQuantity(product, current.draft.priceLevel, 1)) return;
        current.feedback.confirmScan(product, 1, current.pathname === '/ventas' ? undefined : {
          label: 'Ver venta', onClick: () => current.navigate('/ventas'),
        });
      } catch (error) { toast.error(error.message); }
    };
    const onKeyUp = event => {
      if (event.key !== ' ' || !spaceAction) return;
      event.preventDefault();
      event.stopPropagation();
      const button = spaceAction;
      spaceTimer = setTimeout(() => {
        cancelSpace();
        scanner.current.reset();
        if (!document.hidden && document.hasFocus() && button.isConnected && button === document.activeElement) button.click();
      }, 100);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    document.addEventListener('focusin', reset);
    document.addEventListener('pointerdown', reset);
    return () => {
      reset();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
      document.removeEventListener('focusin', reset);
      document.removeEventListener('pointerdown', reset);
    };
  }, []);
  const description = !enabled ? 'Escáner de ventas desactivado' : paused
    ? 'Escáner en pausa hasta resolver la venta' : 'Escáner de ventas activo · añade productos desde cualquier módulo';
  return <Tooltip>
    <TooltipTrigger asChild>
      <Button type="button" variant="outline" size="icon" aria-label="Escáner de ventas" aria-pressed={enabled}
        className={`h-10 w-10 rounded-xl ${enabled && !paused ? 'bg-accent text-primary' : 'bg-card'}`}
        onClick={() => {
          const next = !enabled;
          setEnabled(next);
          try { localStorage.setItem('felix-sales-scanner', next ? 'on' : 'off'); } catch { /* In-memory preference remains usable. */ }
          if (next) feedback.prepareScanAudio();
          toast(next ? 'Escáner de ventas activado' : 'Escáner de ventas desactivado');
        }}>
        <ScanBarcode />
      </Button>
    </TooltipTrigger>
    <TooltipContent>{description}</TooltipContent>
  </Tooltip>;
}

import { useEffect, useRef, useState } from "react";
import { Camera, Smartphone } from "lucide-react";
import { Button } from "../ui/button.jsx";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../ui/dialog.jsx";

function cameraError(error) {
  if (["NotAllowedError", "SecurityError"].includes(error?.name))
    return "No se concedió permiso para la cámara. Actívalo en los permisos del navegador o usa el lector USB.";
  if (["NotFoundError", "OverconstrainedError"].includes(error?.name))
    return "No se encontró una cámara disponible. Conecta una cámara o usa el lector USB.";
  if (error?.name === "NotReadableError")
    return "La cámara está ocupada o no se pudo abrir. Cierra otras aplicaciones que la estén usando.";
  return "No se pudo iniciar la cámara. Revisa sus permisos y vuelve a intentarlo, o usa el lector USB.";
}

export function BarcodeCameraDialog({ onCode, onClose }) {
  const [video, setVideo] = useState(null);
  const callbacks = useRef({ onCode, onClose });
  callbacks.current = { onCode, onClose };
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // The dialog portal mounts after its parent effect. Wait for its visible
    // video; ZXing otherwise creates a detached video that cannot be previewed.
    if (!video) return;
    let cancelled = false;
    let lastCode = null, absentSince = null;
    let stream;
    let controls;
    const stop = () => {
      cancelled = true;
      // ZXing may try to disable a torch after ending its track. Cleanup must
      // still finish on cameras that reject constraints on an ended track.
      const ending = controls?.stop();
      ending?.catch(() => {});
      stream?.getTracks().forEach(track => track.stop());
      if (video) video.srcObject = null;
    };
    const hide = () => {
      if (document.hidden) {
        stop();
        callbacks.current.onClose();
      }
    };
    const leave = () => {
      stop();
      callbacks.current.onClose();
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    setError("");
    setFeedback(null);
    setReady(false);
    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError("La cámara necesita HTTPS o la aplicación local compatible. Puedes usar el lector USB en el campo de código.");
        return;
      }
      try {
        // ZXing is bundled locally, including browsers without BarcodeDetector (Safari/iPhone).
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, NotFoundException, ChecksumException, FormatException }] =
          await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
        if (cancelled) return;
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) { stop(); return; }
        const reader = new BrowserMultiFormatReader(undefined, {
          delayBetweenScanAttempts: 150, delayBetweenScanSuccess: 150,
        });
        controls = await reader.decodeFromStream(stream, video, (result, failure) => {
          if (cancelled) return;
          if (result) {
            const code = result.getText(), format = BarcodeFormat[result.getBarcodeFormat()];
            // UPC-A and its zero-prefixed EAN-13 representation are the same bars.
            const key = format === 'UPC_A' && /^\d{12}$/.test(code) ? '0' + code : code;
            const reentered = absentSince !== null && performance.now() - absentSince >= 800;
            absentSince = null;
            if (key === lastCode && !reentered) return;
            lastCode = key;
            setFeedback(callbacks.current.onCode(code, format));
          } else if (failure && !(failure instanceof NotFoundException) &&
              !(failure instanceof ChecksumException) && !(failure instanceof FormatException)) {
            stop();
            setError(cameraError(failure));
          } else {
            // Require a sustained gap, not a single blurred frame, before
            // allowing another unit of the code that is still in view.
            absentSince ??= performance.now();
          }
        });
        if (cancelled) { stop(); return; }
        setReady(true);
      } catch (failure) {
        if (!cancelled) setError(cameraError(failure));
        stop();
      }
    })();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
    };
  }, [attempt, video]);

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        onCloseAutoFocus={event => { event.preventDefault(); callbacks.current.onClose(); }}
        data-camera-error={error ? "" : undefined}
        className="barcode-camera-dialog rounded-2xl">
        <DialogHeader className="barcode-camera-heading">
          <DialogTitle className="flex items-center gap-2"><Camera className="h-5 w-5 text-primary" />Escanear producto</DialogTitle>
          <DialogDescription>Alinea el código dentro del marco.</DialogDescription>
        </DialogHeader>
        <div className="barcode-camera-preview" hidden={!!error}>
          <video ref={setVideo} autoPlay playsInline muted aria-label="Vista de la cámara" />
          <div className="barcode-camera-guide" aria-hidden="true">
            {[0, 1, 2, 3].map(corner => <span key={corner} className="barcode-camera-corner" />)}
            <span className="barcode-camera-line" />
          </div>
        </div>
        <div className="barcode-camera-controls">
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> :
            <p role={feedback?.ok === false ? "alert" : "status"}
              className={`barcode-camera-message text-sm ${feedback?.ok ? 'text-emerald-700 dark:text-emerald-400' : feedback ? 'text-destructive' : 'text-muted-foreground'}`}>
              {feedback ? `${feedback.ok ? 'Agregado: ' : ''}${feedback.message}` : ready ? "Buscando un código…" : "Abriendo cámara…"}
            </p>}
          <p className="barcode-camera-rotate text-sm text-muted-foreground"><Smartphone aria-hidden="true" className="h-4 w-4 shrink-0" />Gira el teléfono para ampliar la vista.</p>
          <p className="text-xs text-muted-foreground">Sigue con otro producto. Para repetir el mismo, aparta el código un momento y vuelve a enfocarlo.</p>
          <DialogFooter className="barcode-camera-actions gap-2">
            <Button variant="outline" className="h-11 rounded-xl" onClick={onClose}>Cerrar cámara</Button>
            {error && <Button className="h-11 rounded-xl" onClick={() => setAttempt(value => value + 1)}>Reintentar cámara</Button>}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Button } from "../../components/ui/button.jsx";
import {
  Dialog2, DialogContent2, DialogHeader, DialogTitle2, DialogDescription2, DialogFooter,
} from "../../components/ui/dialog.jsx";

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
  const videoRef = useRef(null);
  const callbacks = useRef({ onCode, onClose });
  callbacks.current = { onCode, onClose };
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let delivered = false;
    let stream;
    let controls;
    const video = videoRef.current;
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
          delayBetweenScanAttempts: 150, delayBetweenScanSuccess: 500,
        });
        controls = await reader.decodeFromStream(stream, video, (result, failure, scan) => {
          if (cancelled || delivered) return;
          if (result) {
            delivered = true;
            scan.stop();
            callbacks.current.onCode(result.getText(), BarcodeFormat[result.getBarcodeFormat()]);
          } else if (failure && !(failure instanceof NotFoundException) &&
              !(failure instanceof ChecksumException) && !(failure instanceof FormatException)) {
            scan.stop();
            setError(cameraError(failure));
          }
        });
        if (cancelled || delivered) { stop(); return; }
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
  }, [attempt]);

  return (
    <Dialog2 open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent2
        onCloseAutoFocus={event => { event.preventDefault(); callbacks.current.onClose(); }}
        style={{ width: "calc(100vw - 2rem)", maxHeight: "calc(100dvh - 2rem)" }}
        className="max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle2 className="flex items-center gap-2"><Camera className="h-5 w-5 text-primary" />Escanear producto</DialogTitle2>
          <DialogDescription2>Centra un código de barras. Se agregará una vez a la factura, sin cobrarla.</DialogDescription2>
        </DialogHeader>
        <video ref={videoRef} autoPlay playsInline muted aria-label="Vista de la cámara"
          className="aspect-video w-full rounded-xl bg-muted object-cover" />
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> :
          <p role="status" className="text-sm text-muted-foreground">{ready ? "Buscando un código… Acerca el producto y procura buena iluminación." : "Abriendo cámara…"}</p>}
        <p className="text-xs text-muted-foreground">El código debe coincidir con el registrado en Inventario. La imagen se procesa en este equipo.</p>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11 rounded-xl" onClick={onClose}>Cerrar cámara</Button>
          {error && <Button className="h-11 rounded-xl" onClick={() => setAttempt(value => value + 1)}>Reintentar cámara</Button>}
        </DialogFooter>
      </DialogContent2>
    </Dialog2>
  );
}

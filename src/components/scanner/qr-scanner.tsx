"use client";

import { useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { CameraOff, Flashlight, FlashlightOff } from "lucide-react";

const ELEMENT_ID = "qr-reader";

/**
 * Camera QR / barcode reader built on html5-qrcode (no native app required).
 * Decodes QR, Data Matrix, Code 128/39 and EAN — covering our labels and most
 * legacy asset barcodes. Uses the native BarcodeDetector when available.
 */
export function QrScanner({ active, onDecode }: { active: boolean; onDecode: (text: string) => void }) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onDecodeRef = useRef(onDecode);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => {
    onDecodeRef.current = onDecode;
  }, [onDecode]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let instance: Html5Qrcode | null = null;
    setError(null);
    setStarting(true);
    (async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats: F } = await import("html5-qrcode");
        if (cancelled) return;
        instance = new Html5Qrcode(ELEMENT_ID, {
          verbose: false,
          formatsToSupport: [F.QR_CODE, F.DATA_MATRIX, F.CODE_128, F.CODE_39, F.EAN_13, F.EAN_8, F.UPC_A],
          useBarCodeDetectorIfSupported: true,
        });
        scannerRef.current = instance;
        await instance.start(
          { facingMode: "environment" },
          {
            fps: 12,
            aspectRatio: 1,
            qrbox: (w, h) => {
              const size = Math.max(160, Math.floor(Math.min(w, h) * 0.72));
              return { width: size, height: size };
            },
          },
          (text) => onDecodeRef.current(text),
          () => undefined,
        );
        if (cancelled) {
          await instance.stop().catch(() => undefined);
          return;
        }
        try {
          setTorchSupported(instance.getRunningTrackCameraCapabilities().torchFeature().isSupported());
        } catch {
          setTorchSupported(false);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(
          /Permission|NotAllowed/i.test(message)
            ? "Accès à la caméra refusé. Autorisez la caméra dans les réglages du navigateur, ou saisissez le code manuellement."
            : /secure|https/i.test(message)
              ? "La caméra nécessite une connexion sécurisée (HTTPS)."
              : "Caméra indisponible sur cet appareil. Utilisez la saisie manuelle ou une douchette.",
        );
      } finally {
        if (!cancelled) setStarting(false);
      }
    })();
    return () => {
      cancelled = true;
      const s = instance;
      scannerRef.current = null;
      setTorchOn(false);
      if (s) {
        void (async () => {
          try {
            if (s.isScanning) await s.stop();
            s.clear();
          } catch {
            /* already stopped */
          }
        })();
      }
    };
  }, [active]);

  const toggleTorch = async () => {
    const s = scannerRef.current;
    if (!s) return;
    try {
      await s.getRunningTrackCameraCapabilities().torchFeature().apply(!torchOn);
      setTorchOn(!torchOn);
    } catch {
      setTorchSupported(false);
    }
  };

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black">
      <div id={ELEMENT_ID} className="h-full w-full" />
      {active && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-content-center">
          <div className="h-[62vw] max-h-[340px] w-[62vw] max-w-[340px] rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>
      )}
      {starting && !error && <p className="absolute inset-x-0 bottom-3 text-center text-sm text-white/80">Ouverture de la caméra…</p>}
      {!active && (
        <div className="absolute inset-0 grid place-content-center gap-2 text-center text-white/70">
          <CameraOff className="mx-auto h-10 w-10" />
          <p className="text-sm">Caméra en pause</p>
        </div>
      )}
      {error && <p className="absolute inset-0 grid place-content-center p-6 text-center text-sm font-medium text-white">{error}</p>}
      {torchSupported && active && (
        <button
          type="button"
          onClick={toggleTorch}
          className="absolute right-3 top-3 grid h-11 w-11 place-content-center rounded-full bg-black/60 text-white"
          aria-label={torchOn ? "Éteindre la lampe" : "Allumer la lampe"}
        >
          {torchOn ? <FlashlightOff className="h-5 w-5" /> : <Flashlight className="h-5 w-5" />}
        </button>
      )}
    </div>
  );
}

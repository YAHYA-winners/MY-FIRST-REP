"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SignaturePadHandle {
  isEmpty: () => boolean;
  toDataURL: () => string;
  clear: () => void;
}

/** Pointer-based e-signature canvas (mouse, stylus, finger), exported as PNG. */
export const SignaturePad = forwardRef<SignaturePadHandle, { height?: number; onChange?: (empty: boolean) => void }>(
  function SignaturePad({ height = 180, onChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const last = useRef<{ x: number; y: number } | null>(null);
    const [empty, setEmpty] = useState(true);

    const setup = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      // Layout size (offsetWidth) is not affected by CSS transforms such as the dialog's zoom-in animation.
      const width = canvas.offsetWidth;
      const height = canvas.offsetHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0b1f4d";
      ctx.lineWidth = 2.2;
    }, []);

    const emptyRef = useRef(true);
    useEffect(() => {
      emptyRef.current = empty;
    }, [empty]);

    useEffect(() => {
      setup();
      const canvas = canvasRef.current;
      if (!canvas || typeof ResizeObserver === "undefined") return;
      // Re-initialise the backing store when the layout size changes, as long as nothing is drawn yet.
      const observer = new ResizeObserver(() => {
        if (emptyRef.current) setup();
      });
      observer.observe(canvas);
      return () => observer.disconnect();
    }, [setup]);

    /** Pointer position in layout pixels, compensating any ancestor CSS scale transform. */
    const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const scaleX = rect.width ? el.offsetWidth / rect.width : 1;
      const scaleY = rect.height ? el.offsetHeight / rect.height : 1;
      return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    };

    const markDirty = () => {
      if (empty) {
        setEmpty(false);
        onChange?.(false);
      }
    };

    const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      drawing.current = true;
      last.current = point(e);
      const ctx = canvasRef.current!.getContext("2d")!;
      ctx.beginPath();
      ctx.arc(last.current.x, last.current.y, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = "#0b1f4d";
      ctx.fill();
      markDirty();
    };

    const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawing.current || !last.current) return;
      const p = point(e);
      const ctx = canvasRef.current!.getContext("2d")!;
      ctx.lineWidth = e.pointerType === "pen" ? 1.5 + (e.pressure || 0.5) * 2 : 2.2;
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last.current = p;
      markDirty();
    };

    const onUp = () => {
      drawing.current = false;
      last.current = null;
    };

    const clear = useCallback(() => {
      setup();
      setEmpty(true);
      onChange?.(true);
    }, [setup, onChange]);

    useImperativeHandle(ref, () => ({
      isEmpty: () => empty,
      toDataURL: () => canvasRef.current?.toDataURL("image/png") ?? "",
      clear,
    }));

    return (
      <div className="space-y-2">
        <div className="relative rounded-lg border-2 border-dashed border-input bg-white">
          <canvas
            ref={canvasRef}
            style={{ height, touchAction: "none" }}
            className="block w-full cursor-crosshair rounded-lg"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
            aria-label="Zone de signature"
          />
          {empty && (
            <span className="pointer-events-none absolute inset-0 grid place-content-center text-sm text-muted-foreground">
              Signez ici avec le doigt, un stylet ou la souris
            </span>
          )}
          <span className="pointer-events-none absolute bottom-6 left-6 right-6 border-b border-muted-foreground/30" />
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={clear}>
          <Eraser /> Effacer
        </Button>
      </div>
    );
  },
);

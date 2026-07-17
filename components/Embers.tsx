"use client";

import { useEffect, useRef } from "react";

export default function Embers() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    type Particle = { x: number; y: number; r: number; speed: number; drift: number; alpha: number };
    let frame = 0;
    let particles: Particle[] = [];
    let width = window.innerWidth;
    let height = window.innerHeight;

    const create = (): Particle => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 1.4 + 0.3,
      speed: Math.random() * 0.22 + 0.05,
      drift: (Math.random() - 0.5) * 0.12,
      alpha: Math.random() * 0.35 + 0.06,
    });

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = Array.from({ length: Math.min(65, Math.max(24, Math.floor(width / 25))) }, create);
    };

    const animate = () => {
      ctx.clearRect(0, 0, width, height);
      for (const particle of particles) {
        particle.y -= particle.speed;
        particle.x += particle.drift;
        if (particle.y < -8 || particle.x < -8 || particle.x > width + 8) {
          Object.assign(particle, create(), { y: height + 8 });
        }
        ctx.beginPath();
        ctx.fillStyle = `rgba(230, 183, 91, ${particle.alpha})`;
        ctx.shadowColor = "rgba(235, 185, 92, .45)";
        ctx.shadowBlur = 7;
        ctx.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
        ctx.fill();
      }
      frame = requestAnimationFrame(animate);
    };

    resize();
    animate();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="embers" aria-hidden="true" />;
}

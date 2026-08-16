/* ==========================================================================
   Richman Estate — 15-atmosphere.ts
   Matrice Geist Pixel interactive & effets d'ambiance
   Porté de 15-atmosphere.js (découpage historique de main.js).
   ========================================================================== */


/* ==========================================================================
   Interactive Geist Pixel Matrix & Haute Couture Atmospheric Engine
   ========================================================================== */
export function initRichmanMatrixBackground() {
  const bgContainer = document.querySelector('.bg') as HTMLElement | null;
  if (!bgContainer) return;

  // Clear or reuse container
  bgContainer.innerHTML = '';

  // 1. Ambient Lighting & Depth Layer
  const ambientLayer = document.createElement('div');
  ambientLayer.className = 'bg-ambient-layer';
  bgContainer.appendChild(ambientLayer);

  // 2. Interactive Canvas
  const canvas = document.createElement('canvas');
  canvas.className = 'bg-matrix-canvas';
  canvas.id = 'bg-matrix-canvas';
  bgContainer.appendChild(canvas);

  // 3. Subtle Vignette
  const vignette = document.createElement('div');
  vignette.className = 'bg-vignette';
  bgContainer.appendChild(vignette);

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let cols = 0;
  let rows = 0;
  const SPACING = 12; // Tightly packed grid spacing in px

  // Mouse & Physics
  const mouse = { x: -1000, y: -1000, vx: 0, vy: 0 };
  const smoothMouse = { x: -1000, y: -1000 };
  let lastMoveTime = Date.now();
  let isPointerActive = false;

  // Ripples on click
  const ripples: any[] = [];

  // Ambient floating light beams / photons
  const photons = Array.from({ length: 6 }, () => ({
    x: Math.random() * (bgContainer.clientWidth || window.innerWidth),
    y: Math.random() * (bgContainer.clientHeight || window.innerHeight),
    vx: (Math.random() - 0.5) * 0.7,
    vy: (Math.random() - 0.5) * 0.7,
    radius: 140 + Math.random() * 100,
    intensity: 0.15 + Math.random() * 0.2
  }));

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = bgContainer.clientWidth || window.innerWidth;
    height = bgContainer.clientHeight || window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    cols = Math.ceil(width / SPACING) + 1;
    rows = Math.ceil(height / SPACING) + 1;
  }

  window.addEventListener('resize', resize, { passive: true });
  resize();

  window.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
    lastMoveTime = Date.now();
    isPointerActive = true;
  }, { passive: true });

  window.addEventListener('mouseleave', () => {
    isPointerActive = false;
  });

  window.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    ripples.push({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      radius: 5,
      maxRadius: Math.max(width, height) * 0.6,
      speed: 14,
      alpha: 1
    });
    if (ripples.length > 5) ripples.shift();
  });

  // Touch support for mobile devices
  window.addEventListener('touchmove', (e) => {
    if (e.touches.length > 0) {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.touches[0].clientX - rect.left;
      mouse.y = e.touches[0].clientY - rect.top;
      lastMoveTime = Date.now();
      isPointerActive = true;
    }
  }, { passive: true });

  let animFrameId: any = null;

  function render(time: number) {
    if (document.hidden) {
      animFrameId = requestAnimationFrame(render);
      return;
    }

    const t = (time || 0) * 0.001;

    // Instantaneous / Ultra-responsive tracking when mouse is active, smooth ease when idle
    const idleTime = Date.now() - lastMoveTime;
    let targetX = mouse.x;
    let targetY = mouse.y;

    if (!isPointerActive || idleTime > 3000) {
      // Gentle cinematic roaming trajectory when idle
      targetX = width * 0.5 + Math.sin(t * 0.6) * (width * 0.32);
      targetY = height * 0.5 + Math.cos(t * 0.4) * (height * 0.24);
      smoothMouse.x += (targetX - smoothMouse.x) * 0.05;
      smoothMouse.y += (targetY - smoothMouse.y) * 0.05;
    } else {
      // Direct 1:1 instantaneous tracking with zero latency
      smoothMouse.x = mouse.x;
      smoothMouse.y = mouse.y;
    }

    // Clear Canvas
    ctx.clearRect(0, 0, width, height);

    // Update & draw Photons (Ambient drifting energy)
    for (let p of photons) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -p.radius) p.x = width + p.radius;
      if (p.x > width + p.radius) p.x = -p.radius;
      if (p.y < -p.radius) p.y = height + p.radius;
      if (p.y > height + p.radius) p.y = -p.radius;
    }

    // Update Ripples
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.radius += r.speed;
      r.alpha = Math.max(0, 1 - (r.radius / r.maxRadius));
      if (r.radius >= r.maxRadius || r.alpha <= 0) {
        ripples.splice(i, 1);
      }
    }

    const cursorRadius = Math.min(220, Math.max(140, width * 0.18));
    const cursorRadiusSq = cursorRadius * cursorRadius;

    // Draw Subtle Mouse Torch Halo
    if (smoothMouse.x > 0 && smoothMouse.x < width && smoothMouse.y > 0 && smoothMouse.y < height) {
      const grad = ctx.createRadialGradient(
        smoothMouse.x, smoothMouse.y, 0,
        smoothMouse.x, smoothMouse.y, cursorRadius * 1.4
      );
      grad.addColorStop(0, 'rgba(197, 168, 128, 0.06)');
      grad.addColorStop(0.5, 'rgba(197, 168, 128, 0.015)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(smoothMouse.x, smoothMouse.y, cursorRadius * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw Tightly-Packed Geist Pixel Grid
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const baseX = c * SPACING;
        const baseY = r * SPACING;

        // Distance to smooth mouse
        const dx = smoothMouse.x - baseX;
        const dy = smoothMouse.y - baseY;
        const distSq = dx * dx + dy * dy;

        let dotX = baseX;
        let dotY = baseY;
        let size = 9.5; // Base dense cube size (gap ~2.5px)
        let alpha = 0.055;
        let rColor = 140;
        let gColor = 140;
        let bColor = 155;

        // Proximity to mouse interaction (Magnetic & Glow)
        if (distSq < cursorRadiusSq) {
          const dist = Math.sqrt(distSq);
          const ratio = 1 - (dist / cursorRadius); // 1 at center, 0 at border
          const easeRatio = ratio * ratio * (3 - 2 * ratio); // Smoothstep

          // Magnetic subtle displacement
          const disp = easeRatio * 3;
          dotX -= (dx / (dist || 1)) * disp;
          dotY -= (dy / (dist || 1)) * disp;

          // Scale & Color shift to Champagne Gold / White Core
          size = 9.5 + easeRatio * 2.2;
          alpha = 0.08 + easeRatio * 0.82;

          // Gold: 212, 186, 148 -> White core: 255, 250, 240
          rColor = Math.round(180 + easeRatio * 70);
          gColor = Math.round(160 + easeRatio * 75);
          bColor = Math.round(140 + easeRatio * 85);
        }

        // Photons influence
        for (let p of photons) {
          const pdx = p.x - baseX;
          const pdy = p.y - baseY;
          const pdistSq = pdx * pdx + pdy * pdy;
          const prSq = p.radius * p.radius;
          if (pdistSq < prSq) {
            const pratio = (1 - Math.sqrt(pdistSq) / p.radius) * p.intensity;
            alpha = Math.min(0.8, alpha + pratio * 0.35);
          }
        }

        // Ripples influence
        for (let rip of ripples) {
          const rdx = rip.x - baseX;
          const rdy = rip.y - baseY;
          const rdist = Math.sqrt(rdx * rdx + rdy * rdy);
          const diff = Math.abs(rdist - rip.radius);
          if (diff < 35) {
            const ripRatio = (1 - diff / 35) * rip.alpha;
            alpha = Math.min(0.9, alpha + ripRatio * 0.7);
            rColor = Math.round(212 + ripRatio * 43);
            gColor = Math.round(186 + ripRatio * 50);
            bColor = Math.round(148 + ripRatio * 60);
          }
        }

        // Render Pixel Cube (tightly packed matching Richman typography)
        ctx.fillStyle = `rgba(${rColor}, ${gColor}, ${bColor}, ${alpha.toFixed(3)})`;
        const halfSize = size * 0.5;
        ctx.fillRect(dotX - halfSize, dotY - halfSize, size, size);
      }
    }

    animFrameId = requestAnimationFrame(render);
  }

  animFrameId = requestAnimationFrame(render);
}

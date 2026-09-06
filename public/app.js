/**
 * app.js — Local Brain MCP Official Website Interactions
 * Lightweight, zero-dependency client logic.
 */

document.addEventListener('DOMContentLoaded', () => {
  initNeuralCanvas();
  initCodeTabs();
  initCopyButtons();
  initMobileNav();
});

// ─── Neural Synapse Canvas Background ─────────────────────────────────────────

function initNeuralCanvas() {
  const canvas = document.getElementById('neural-canvas');
  if (!canvas) return;

  // Check prefers-reduced-motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  const ctx = canvas.getContext('2d');
  let width, height;
  let particles = [];

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }

  window.addEventListener('resize', resize);
  resize();

  const particleCount = Math.min(Math.floor(window.innerWidth / 22), 45);

  class Particle {
    constructor() {
      this.x = Math.random() * width;
      this.y = Math.random() * height;
      this.vx = (Math.random() - 0.5) * 0.45;
      this.vy = (Math.random() - 0.5) * 0.45;
      this.radius = Math.random() * 1.5 + 1;
      this.color = Math.random() > 0.5 ? 'rgba(168, 85, 247, ' : 'rgba(6, 182, 212, ';
      this.alpha = Math.random() * 0.4 + 0.15;
    }

    update() {
      this.x += this.vx;
      this.y += this.vy;

      if (this.x < 0) this.x = width;
      if (this.x > width) this.x = 0;
      if (this.y < 0) this.y = height;
      if (this.y > height) this.y = 0;
    }

    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fillStyle = this.color + this.alpha + ')';
      ctx.fill();
    }
  }

  for (let i = 0; i < particleCount; i++) {
    particles.push(new Particle());
  }

  function animate() {
    ctx.clearRect(0, 0, width, height);

    // Draw connections
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 130) {
          const alpha = (1 - dist / 130) * 0.15;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(59, 130, 246, ${alpha})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
    }

    // Update & draw particles
    particles.forEach(p => {
      p.update();
      p.draw();
    });

    requestAnimationFrame(animate);
  }

  animate();
}

// ─── Code Tab Switcher ────────────────────────────────────────────────────────

function initCodeTabs() {
  const tabBtns = document.querySelectorAll('.code-tab-btn');
  const panels = document.querySelectorAll('.code-panel');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');

      tabBtns.forEach(b => b.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) {
        targetPanel.classList.add('active');
      }
    });
  });
}

// ─── Functional Copy to Clipboard ─────────────────────────────────────────────

function initCopyButtons() {
  const copyButtons = document.querySelectorAll('[data-copy-target], .btn-copy-tab');

  copyButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      let textToCopy = '';

      const targetSelector = btn.getAttribute('data-copy-target');
      if (targetSelector) {
        const el = document.querySelector(targetSelector);
        textToCopy = el ? el.innerText.trim() : '';
      } else {
        // Fallback: copy active code panel
        const activePanel = document.querySelector('.code-panel.active pre, .code-panel.active code');
        if (activePanel) {
          textToCopy = activePanel.innerText.trim();
        }
      }

      if (!textToCopy) return;

      try {
        await navigator.clipboard.writeText(textToCopy);
        const originalText = btn.innerHTML;
        btn.innerHTML = `<span style="color: var(--green);">✓ Copied</span>`;
        setTimeout(() => {
          btn.innerHTML = originalText;
        }, 2000);
      } catch (err) {
        console.warn('Clipboard write failed:', err);
      }
    });
  });
}

// ─── Mobile Navigation Toggle ─────────────────────────────────────────────────

function initMobileNav() {
  const toggleBtn = document.querySelector('.mobile-toggle');
  const mobileNav = document.querySelector('.mobile-nav');

  if (!toggleBtn || !mobileNav) return;

  toggleBtn.addEventListener('click', () => {
    mobileNav.classList.toggle('open');
  });

  // Close on nav link click
  mobileNav.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      mobileNav.classList.remove('open');
    });
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!mobileNav.contains(e.target) && !toggleBtn.contains(e.target)) {
      mobileNav.classList.remove('open');
    }
  });
}

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
  let animationId = null;
  let isVisible = true;

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
    if (!isVisible) {
      animationId = requestAnimationFrame(animate);
      return;
    }
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

    animationId = requestAnimationFrame(animate);
  }

  animate();

  // Visibility change pause/resume
  document.addEventListener('visibilitychange', () => {
    isVisible = !document.hidden;
  });

  // Cleanup
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotionQuery.addEventListener('change', (e) => {
    if (e.matches) {
      if (animationId) cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    }
  });
}

// ─── Code Tab Switcher ────────────────────────────────────────────

function initCodeTabs() {
  const tabBtns = document.querySelectorAll('.code-tab-btn');
  const panels = document.querySelectorAll('.code-panel');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');

      tabBtns.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      panels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) {
        targetPanel.classList.add('active');
      }
    });

    // Keyboard navigation for tabs
    btn.addEventListener('keydown', (e) => {
      const btnsArray = Array.from(tabBtns);
      const idx = btnsArray.indexOf(btn);
      let newIdx;

      if (e.key === 'ArrowRight') {
        newIdx = (idx + 1) % btnsArray.length;
      } else if (e.key === 'ArrowLeft') {
        newIdx = (idx - 1 + btnsArray.length) % btnsArray.length;
      } else if (e.key === 'Home') {
        newIdx = 0;
      } else if (e.key === 'End') {
        newIdx = btnsArray.length - 1;
      } else {
        return;
      }

      e.preventDefault();
      btnsArray[newIdx].focus();
      btnsArray[newIdx].click();
    });
  });
}

// ─── Functional Copy to Clipboard ─────────────────────────────────

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
        showCopySuccess(btn);
      } catch (err) {
        showCopyFailure(btn);
      }
    });

    // Keyboard support
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        btn.click();
      }
    });
  });
}

function showCopySuccess(btn) {
  const originalText = btn.innerHTML;
  btn.classList.add('copy-success');
  btn.innerHTML = '<span class="copy-feedback">✓ Copied</span>';
  setTimeout(() => {
    btn.classList.remove('copy-success');
    btn.innerHTML = originalText;
  }, 2000);
}

function showCopyFailure(btn) {
  const originalText = btn.innerHTML;
  btn.classList.add('copy-failure');
  btn.innerHTML = '<span class="copy-feedback">✕ Failed</span>';
  setTimeout(() => {
    btn.classList.remove('copy-failure');
    btn.innerHTML = originalText;
  }, 2000);
}

// ─── Mobile Navigation Toggle ─────────────────────────────────────

function initMobileNav() {
  const toggleBtn = document.querySelector('.mobile-toggle');
  const mobileNav = document.querySelector('.mobile-nav');

  if (!toggleBtn || !mobileNav) return;

  toggleBtn.addEventListener('click', () => {
    const isOpen = mobileNav.classList.toggle('open');
    toggleBtn.setAttribute('aria-expanded', String(isOpen));
  });

  // Close on nav link click
  mobileNav.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      mobileNav.classList.remove('open');
      toggleBtn.setAttribute('aria-expanded', 'false');
    });
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!mobileNav.contains(e.target) && !toggleBtn.contains(e.target)) {
      mobileNav.classList.remove('open');
      toggleBtn.setAttribute('aria-expanded', 'false');
    }
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mobileNav.classList.contains('open')) {
      mobileNav.classList.remove('open');
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.focus();
    }
  });

  // Focus management: focus first link when opened
  toggleBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleBtn.click();
      const firstLink = mobileNav.querySelector('.nav-link');
      if (firstLink) {
        setTimeout(() => firstLink.focus(), 50);
      }
    }
  });
}

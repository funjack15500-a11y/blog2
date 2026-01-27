const themeToggle = document.getElementById("themeToggle");
const nowTime = document.getElementById("nowTime");
const gradCountdownLine = document.getElementById("gradCountdownLine");
const daysCount = document.getElementById("daysCount");
const particleCanvas = document.getElementById("particleCanvas");
const particleCtx = particleCanvas ? particleCanvas.getContext("2d") : null;
const modeSelect = document.getElementById("modeSelect");
const pauseToggle = document.getElementById("pauseToggle");
const bgAudio = document.getElementById("bgAudio");
const audioToggle = document.getElementById("audioToggle");

const startDate = new Date("2024-01-01T00:00:00");

const updateTime = () => {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  if (nowTime) {
    nowTime.textContent = `${hh}:${mm}`;
  }
};

const getGraduationTarget = (baseDate) => {
  const year = baseDate.getFullYear();
  const targetThisYear = new Date(year, 5, 23, 0, 0, 0);
  if (baseDate > targetThisYear) {
    return new Date(year + 1, 5, 23, 0, 0, 0);
  }
  return targetThisYear;
};

const updateGraduationCountdown = () => {
  if (!gradCountdownLine) {
    return;
  }
  const now = new Date();
  const target = getGraduationTarget(now);
  const diffMs = Math.max(0, target - now);
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diffMs / (1000 * 60)) % 60);
  const seconds = Math.floor((diffMs / 1000) % 60);
  if (gradCountdownLine) {
    const hh = String(hours).padStart(2, "0");
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    gradCountdownLine.textContent = `${daysLeft}天 ${hh}:${mm}:${ss}`;
  }
};

const updateDays = () => {
  const now = new Date();
  const diff = Math.ceil((now - startDate) / (1000 * 60 * 60 * 24));
  daysCount.textContent = diff.toString();
};

const revealItems = () => {
  const cards = document.querySelectorAll(
    ".about-card, .post-card, .project-card, .note-card, .contact-card"
  );
  const trigger = window.innerHeight * 0.86;
  cards.forEach((card) => {
    const rect = card.getBoundingClientRect();
    if (rect.top < trigger) {
      card.classList.add("visible");
    }
  });
};

const particleState = {
  width: 0,
  height: 0,
  dpr: Math.min(window.devicePixelRatio || 1, 2),
  floaters: [],
  sparks: [],
  orbiters: [],
  stars: [],
  palette: ["#7f7bff", "#24d2ff", "#ff7bdc"],
  mouse: { x: 0, y: 0, vx: 0, vy: 0, active: false },
  mode: "aura",
  paused: false,
  ripple: { active: false, x: 0, y: 0, radius: 0 }
};

const syncPalette = () => {
  if (!particleCtx) {
    return;
  }
  const styles = getComputedStyle(document.body);
  const colors = [
    styles.getPropertyValue("--accent"),
    styles.getPropertyValue("--accent-2"),
    styles.getPropertyValue("--accent-3")
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  particleState.palette = colors.length ? colors : particleState.palette;
};

const randomPalette = () =>
  particleState.palette[Math.floor(Math.random() * particleState.palette.length)];

const initFloaters = () => {
  if (!particleCtx) {
    return;
  }
  const target = Math.max(
    60,
    Math.min(160, Math.floor((particleState.width * particleState.height) / 18000))
  );
  particleState.floaters = Array.from({ length: target }, () => ({
    x: Math.random() * particleState.width,
    y: Math.random() * particleState.height,
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.4,
    radius: 1 + Math.random() * 2.4,
    alpha: 0.15 + Math.random() * 0.4,
    pulse: Math.random() * Math.PI * 2,
    pulseSpeed: 0.004 + Math.random() * 0.01,
    color: randomPalette()
  }));
};

const initStars = () => {
  if (!particleCtx) {
    return;
  }
  const count = Math.max(
    90,
    Math.min(200, Math.floor((particleState.width * particleState.height) / 12000))
  );
  particleState.stars = Array.from({ length: count }, () => ({
    x: Math.random() * particleState.width,
    y: Math.random() * particleState.height,
    size: 0.6 + Math.random() * 1.6,
    twinkle: Math.random() * Math.PI * 2,
    twinkleSpeed: 0.004 + Math.random() * 0.012,
    alpha: 0.2 + Math.random() * 0.6,
    color: randomPalette()
  }));
};

const initOrbiters = () => {
  if (!particleCtx) {
    return;
  }
  const count = Math.max(5, Math.min(10, Math.floor(particleState.width / 220)));
  particleState.orbiters = Array.from({ length: count }, (_, index) => ({
    angle: (Math.PI * 2 * index) / count,
    radius: 50 + Math.random() * 180,
    speed: 0.002 + Math.random() * 0.004,
    size: 1.8 + Math.random() * 2.6,
    alpha: 0.5 + Math.random() * 0.4,
    color: randomPalette()
  }));
};

const resizeParticles = () => {
  if (!particleCtx) {
    return;
  }
  const rect = particleCanvas.getBoundingClientRect();
  particleState.width = rect.width;
  particleState.height = rect.height;
  particleState.dpr = Math.min(window.devicePixelRatio || 1, 2);
  particleCanvas.width = Math.round(rect.width * particleState.dpr);
  particleCanvas.height = Math.round(rect.height * particleState.dpr);
  particleCtx.setTransform(particleState.dpr, 0, 0, particleState.dpr, 0, 0);
  if (!particleState.mouse.x && !particleState.mouse.y) {
    particleState.mouse.x = particleState.width * 0.5;
    particleState.mouse.y = particleState.height * 0.4;
  }
  initFloaters();
  initOrbiters();
  initStars();
};

const spawnSparks = (x, y, energy) => {
  if (!particleCtx) {
    return;
  }
  const count = Math.min(12, 4 + Math.floor(energy / 6));
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.6 + Math.random() * 2.2 + energy * 0.02;
    particleState.sparks.push({
      x,
      y,
      vx: Math.cos(angle) * speed + particleState.mouse.vx * 0.05,
      vy: Math.sin(angle) * speed + particleState.mouse.vy * 0.05,
      radius: 1 + Math.random() * 2.4,
      life: 40 + Math.floor(Math.random() * 30),
      age: 0,
      color: randomPalette()
    });
  }
};

const handlePointerMove = (event) => {
  if (!particleCtx) {
    return;
  }
  const rect = particleCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  particleState.mouse.vx = x - particleState.mouse.x;
  particleState.mouse.vy = y - particleState.mouse.y;
  particleState.mouse.x = x;
  particleState.mouse.y = y;
  particleState.mouse.active = true;
  spawnSparks(x, y, Math.hypot(particleState.mouse.vx, particleState.mouse.vy));
  if (particleState.mode === "ripple") {
    particleState.ripple.active = true;
    particleState.ripple.x = x;
    particleState.ripple.y = y;
    particleState.ripple.radius = 0;
  }
};

const handleTouchMove = (event) => {
  if (!particleCtx) {
    return;
  }
  if (!event.touches.length) {
    return;
  }
  const touch = event.touches[0];
  handlePointerMove({ clientX: touch.clientX, clientY: touch.clientY });
};

const renderParticles = () => {
  if (!particleCtx) {
    return;
  }
  if (particleState.paused) {
    requestAnimationFrame(renderParticles);
    return;
  }
  const { width, height, floaters, sparks, orbiters, mouse } = particleState;
  particleCtx.clearRect(0, 0, width, height);
  particleCtx.globalCompositeOperation = "lighter";

  const focusX = mouse.active ? mouse.x : width * 0.5;
  const focusY = mouse.active ? mouse.y : height * 0.4;

  if (particleState.mode === "star") {
    particleState.stars.forEach((star) => {
      star.twinkle += star.twinkleSpeed;
      const twinkle = Math.sin(star.twinkle) * 0.4 + 0.6;
      particleCtx.globalAlpha = star.alpha * twinkle;
      particleCtx.fillStyle = star.color;
      particleCtx.beginPath();
      particleCtx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      particleCtx.fill();
    });
  }

  if (particleState.mode === "ripple" && particleState.ripple.active) {
    particleState.ripple.radius += 2.6;
    const rippleAlpha = Math.max(0, 0.6 - particleState.ripple.radius / 240);
    particleCtx.strokeStyle = particleState.palette[1] || "#24d2ff";
    particleCtx.lineWidth = 1.5;
    particleCtx.globalAlpha = rippleAlpha;
    particleCtx.beginPath();
    particleCtx.arc(
      particleState.ripple.x,
      particleState.ripple.y,
      particleState.ripple.radius,
      0,
      Math.PI * 2
    );
    particleCtx.stroke();
    if (rippleAlpha <= 0) {
      particleState.ripple.active = false;
    }
  }

  floaters.forEach((particle) => {
    particle.pulse += particle.pulseSpeed;
    const pulse = Math.sin(particle.pulse) * 0.4 + 0.6;
    const dx = particle.x - focusX;
    const dy = particle.y - focusY;
    const dist = Math.hypot(dx, dy);
    if (mouse.active && dist < 180) {
      const force = (1 - dist / 180) * 0.6;
      particle.vx += (dx / (dist || 1)) * force * 0.18;
      particle.vy += (dy / (dist || 1)) * force * 0.18;
    }
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.vx *= 0.98;
    particle.vy *= 0.98;
    if (particle.x < -40) particle.x = width + 40;
    if (particle.x > width + 40) particle.x = -40;
    if (particle.y < -40) particle.y = height + 40;
    if (particle.y > height + 40) particle.y = -40;
    particleCtx.globalAlpha = particle.alpha * pulse;
    particleCtx.fillStyle = particle.color;
    particleCtx.beginPath();
    particleCtx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
    particleCtx.fill();
  });

  for (let i = sparks.length - 1; i >= 0; i -= 1) {
    const spark = sparks[i];
    spark.age += 1;
    spark.x += spark.vx;
    spark.y += spark.vy;
    spark.vx *= 0.96;
    spark.vy *= 0.96;
    const lifeRatio = 1 - spark.age / spark.life;
    particleCtx.globalAlpha = Math.max(0, lifeRatio);
    particleCtx.fillStyle = spark.color;
    particleCtx.beginPath();
    particleCtx.arc(spark.x, spark.y, spark.radius * lifeRatio, 0, Math.PI * 2);
    particleCtx.fill();
    if (spark.age >= spark.life) {
      sparks.splice(i, 1);
    }
  }

  orbiters.forEach((orbiter, index) => {
    orbiter.angle += orbiter.speed;
    const swing = Math.sin(orbiter.angle * 2.2 + index) * 12;
    const x = focusX + Math.cos(orbiter.angle) * (orbiter.radius + swing);
    const y = focusY + Math.sin(orbiter.angle) * (orbiter.radius * 0.6 + swing);
    particleCtx.globalAlpha = orbiter.alpha;
    particleCtx.fillStyle = orbiter.color;
    particleCtx.beginPath();
    particleCtx.arc(x, y, orbiter.size, 0, Math.PI * 2);
    particleCtx.fill();
  });

  particleCtx.globalAlpha = 1;
  particleCtx.globalCompositeOperation = "source-over";
  requestAnimationFrame(renderParticles);
};

const applyTheme = (theme) => {
  document.body.setAttribute("data-theme", theme);
  themeToggle.textContent = theme === "light" ? "暗色" : "亮色";
  localStorage.setItem("theme", theme);
  syncPalette();
};

const savedTheme = localStorage.getItem("theme") || "dark";
applyTheme(savedTheme);

themeToggle.addEventListener("click", () => {
  const nextTheme =
    document.body.getAttribute("data-theme") === "light" ? "dark" : "light";
  applyTheme(nextTheme);
});

const updateAudioToggle = () => {
  if (!audioToggle || !bgAudio) {
    return;
  }
  audioToggle.textContent = bgAudio.paused ? "音乐播放" : "音乐暂停";
};

const tryAutoPlay = () => {
  if (!bgAudio) {
    return;
  }
  const attempt = bgAudio.play();
  if (attempt && typeof attempt.then === "function") {
    attempt.then(updateAudioToggle).catch(updateAudioToggle);
  } else {
    updateAudioToggle();
  }
};

if (audioToggle) {
  audioToggle.addEventListener("click", () => {
    if (!bgAudio) {
      return;
    }
    if (bgAudio.paused) {
      bgAudio.play().then(updateAudioToggle);
    } else {
      bgAudio.pause();
      updateAudioToggle();
    }
  });
}

document.addEventListener(
  "click",
  () => {
    if (bgAudio && bgAudio.paused) {
      bgAudio.play().then(updateAudioToggle);
    }
  },
  { once: true }
);

if (modeSelect) {
  modeSelect.addEventListener("change", (event) => {
    particleState.mode = event.target.value;
  });
}

if (pauseToggle) {
  pauseToggle.addEventListener("click", () => {
    particleState.paused = !particleState.paused;
    pauseToggle.textContent = particleState.paused ? "继续" : "暂停";
  });
}

window.addEventListener("scroll", revealItems);
window.addEventListener("load", () => {
  updateTime();
  updateDays();
  updateGraduationCountdown();
  revealItems();
  setInterval(updateTime, 1000);
  setInterval(updateGraduationCountdown, 1000);
  if (particleCtx) {
    syncPalette();
    resizeParticles();
    renderParticles();
  }
  tryAutoPlay();
});

window.addEventListener("resize", resizeParticles);
window.addEventListener("mousemove", handlePointerMove);
window.addEventListener("touchmove", handleTouchMove, { passive: true });
window.addEventListener("mouseleave", () => {
  particleState.mouse.active = false;
});

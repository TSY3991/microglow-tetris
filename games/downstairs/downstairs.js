(function () {
  const boardCanvas = document.querySelector("#downstairsBoard");
  const context = boardCanvas.getContext("2d");
  const overlay = document.querySelector("[data-overlay]");
  const overlayTitle = document.querySelector("[data-overlay-title]");
  const overlayMessage = document.querySelector("[data-overlay-message]");
  const scoreEl = document.querySelector("[data-score]");
  const bestEl = document.querySelector("[data-best]");
  const floorEl = document.querySelector("[data-floor]");
  const floorProgressEl = document.querySelector("[data-floor-progress]");
  const targetProgressEl = document.querySelector("[data-target-progress]");
  const playsEl = document.querySelector("[data-plays]");
  const gameShell = document.querySelector(".downstairs-shell");
  const touchControls = document.querySelector(".touch-controls");
  const instructionModal = document.querySelector("[data-instruction-modal]");
  const gameId = "microglow-downstairs";
  const gameTitle = "小朋友下樓梯";
  const portalStatsKey = "tsyMicroglowPortal.gameStats.v1";
  const width = boardCanvas.width;
  const height = boardCanvas.height;
  const playerWidth = 28;
  const playerHeight = 34;
  const platformHeight = 12;
  const gravity = 1120;
  const moveSpeed = 210;
  const maxFallSpeed = 470;
  const platformGap = 72;
  const targetFloor = 100;

  let player = null;
  let platforms = [];
  let stars = [];
  let particles = [];
  let score = 0;
  ensurePortalStats();
  let best = readBestScore();
  let plays = readPlays();
  let floor = 0;
  let scrollSpeed = 46;
  let running = false;
  let paused = false;
  let recordedThisRun = false;
  let animationFrameId = 0;
  let lastTime = 0;
  let elapsedTime = 0;
  let nextPlatformY = 0;
  let keys = { left: false, right: false, drop: false };
  let activePointerSide = null;
  let targetAnnounced = false;
  let lastTouchEnd = 0;

  resetState();
  updateUi();
  draw();

  function resetState() {
    score = 0;
    floor = 0;
    elapsedTime = 0;
    scrollSpeed = 46;
    paused = false;
    recordedThisRun = false;
    targetAnnounced = false;
    activePointerSide = null;
    keys = { left: false, right: false, drop: false };
    const startPlatformY = 360;
    player = {
      x: width / 2,
      y: startPlatformY - playerHeight / 2,
      vx: 0,
      vy: 0,
      groundedPlatformId: "start-platform",
      invincibleDrop: 0
    };
    platforms = [];
    stars = [];
    particles = [];
    nextPlatformY = startPlatformY;
    addPlatform(width / 2 - 62, nextPlatformY, 124, "start", "start-platform");
    nextPlatformY += platformGap;
    while (nextPlatformY < height + 80) {
      spawnPlatform(nextPlatformY);
      nextPlatformY += platformGap;
    }
  }

  function startGame() {
    if (running && paused) {
      togglePause();
      return;
    }

    if (running) return;

    resetState();
    running = true;
    hideOverlay();
    updateUi();
    lastTime = performance.now();
    animationFrameId = requestAnimationFrame(update);
  }

  function restartGame() {
    stopLoop();
    running = false;
    startGame();
  }

  function stopLoop() {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }
  }

  function update(time) {
    if (!running) return;
    const delta = Math.min(0.034, (time - lastTime) / 1000 || 0);
    lastTime = time;

    if (!paused) {
      elapsedTime += delta;
      updateDifficulty();
      moveWorld(delta);
      movePlayer(delta);
      collectStars();
      updateParticles(delta);
      removeOldObjects();
      ensurePlatforms();
      checkTargetReached();
      checkGameOver();
      updateUi();
      draw();
    }

    animationFrameId = requestAnimationFrame(update);
  }

  function updateDifficulty() {
    scrollSpeed = 46 + Math.min(64, floor * 1.6) + Math.min(20, score * 0.035);
  }

  function moveWorld(delta) {
    const shift = scrollSpeed * delta;
    platforms.forEach((platform) => {
      platform.y -= shift;
    });
    stars.forEach((star) => {
      star.y -= shift;
      star.spin += delta * 4;
    });

    if (player.groundedPlatformId) {
      player.y -= shift;
    }

    nextPlatformY -= shift;
  }

  function movePlayer(delta) {
    const previousBottom = player.y + playerHeight / 2;
    const horizontal = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    player.vx = horizontal * moveSpeed;
    player.x += player.vx * delta;
    if (player.x < -playerWidth / 2) player.x = width + playerWidth / 2;
    if (player.x > width + playerWidth / 2) player.x = -playerWidth / 2;

    if (keys.drop) {
      player.groundedPlatformId = null;
      player.invincibleDrop = Math.max(player.invincibleDrop, 0.16);
      player.vy = Math.max(player.vy, 150);
    }

    const currentPlatform = player.groundedPlatformId
      ? platforms.find((platform) => platform.id === player.groundedPlatformId)
      : null;
    if (currentPlatform && !keys.drop && isStandingOn(currentPlatform)) {
      player.y = currentPlatform.y - playerHeight / 2;
      player.vy = 0;
      return;
    }
    if (player.groundedPlatformId && !currentPlatform) {
      player.groundedPlatformId = null;
    }

    player.invincibleDrop = Math.max(0, player.invincibleDrop - delta);
    player.vy = Math.min(maxFallSpeed, player.vy + gravity * delta);
    player.y += player.vy * delta;

    landOnPlatform(previousBottom);
  }

  function landOnPlatform(previousBottom) {
    if (player.invincibleDrop > 0) return;

    const nextBottom = player.y + playerHeight / 2;
    if (player.vy < 0) return;

    const candidates = platforms.filter((platform) => {
      const crossedTop = previousBottom <= platform.y && nextBottom >= platform.y;
      const overlaps = player.x + playerWidth / 2 > platform.x && player.x - playerWidth / 2 < platform.x + platform.width;
      return crossedTop && overlaps;
    });

    if (!candidates.length) {
      if (player.groundedPlatformId && !platforms.some((platform) => platform.id === player.groundedPlatformId)) {
        player.groundedPlatformId = null;
      }
      return;
    }

    const platform = candidates.sort((a, b) => a.y - b.y)[0];
    if (platform.type === "hazard") {
      player.y = platform.y - playerHeight / 2;
      player.vy = 0;
      spawnParticles(player.x, platform.y, "#ff5ebc", 18);
      endGame("踩到危險平台", "紅色警示階梯會讓微光小機器人短路");
      return;
    }
    player.y = platform.y - playerHeight / 2;
    player.vy = 0;
    player.groundedPlatformId = platform.id;
    if (!platform.visited && platform.type !== "start") {
      platform.visited = true;
      floor += 1;
      score += 5 + Math.floor(floor / 5);
      spawnParticles(player.x, player.y + playerHeight / 2, "#ffd84d", 5);
    }
  }

  function isStandingOn(platform) {
    const overlaps = player.x + playerWidth * 0.38 > platform.x && player.x - playerWidth * 0.38 < platform.x + platform.width;
    const closeToTop = Math.abs(player.y + playerHeight / 2 - platform.y) < 18;
    return overlaps && closeToTop;
  }

  function collectStars() {
    stars = stars.filter((star) => {
      const distance = Math.hypot(player.x - star.x, player.y - star.y);
      if (distance < 24) {
        score += 25;
        spawnParticles(star.x, star.y, "#ffd84d", 12);
        return false;
      }
      return true;
    });
  }

  function removeOldObjects() {
    platforms = platforms.filter((platform) => platform.y > -60);
    stars = stars.filter((star) => star.y > -50);
    particles = particles.filter((particle) => particle.life > 0);
  }

  function ensurePlatforms() {
    while (nextPlatformY < height + 120) {
      spawnPlatform(nextPlatformY);
      nextPlatformY += platformGap + Math.random() * 18;
    }
  }

  function spawnPlatform(y) {
    const widthRange = Math.max(74, 122 - floor * 0.7);
    const platformWidth = Math.max(66, widthRange + Math.random() * 44);
    const x = 18 + Math.random() * (width - platformWidth - 36);
    const roll = Math.random();
    const type = floor > 8 && roll > 0.86 ? "hazard" : "normal";
    const platform = addPlatform(x, y, platformWidth, type);
    if (type !== "hazard" && Math.random() < 0.34) {
      stars.push({
        x: platform.x + platform.width / 2,
        y: platform.y - 30,
        spin: Math.random() * Math.PI * 2
      });
    }
  }

  function addPlatform(x, y, platformWidth, type, forcedId) {
    const platform = {
      id: forcedId || `${Date.now()}-${Math.random()}`,
      x,
      y,
      width: platformWidth,
      type,
      visited: type === "start"
    };
    platforms.push(platform);
    return platform;
  }

  function checkGameOver() {
    if (floor > 2 && elapsedTime > 8 && player.y - playerHeight / 2 <= 8) {
      endGame("被畫面頂到了", "再往下一點就安全了");
    } else if (player.y - playerHeight / 2 > height + 22) {
      endGame("掉出樓梯了", "下一次慢一點找平台");
    }
  }

  function checkTargetReached() {
    if (targetAnnounced || floor < targetFloor) return;
    targetAnnounced = true;
    spawnParticles(player.x, player.y, "#8df45f", 24);
    showOverlay("達成 100 層", "你已完成 100 層挑戰，可以按繼續往更深樓層前進。", "繼續挑戰");
    paused = true;
  }

  function endGame(title, message) {
    if (recordedThisRun) return;
    recordedThisRun = true;
    running = false;
    paused = false;
    stopLoop();
    spawnParticles(player.x, player.y, "#2fd7ff", 16);
    best = Math.max(best, score);
    plays = writePortalStats(score, best).plays;
    updateUi();
    draw();
    showOverlay(title, `${message}，本局 ${score} 分，最高分 ${best} 分`, "再玩一次");
  }

  function togglePause() {
    if (!running) {
      startGame();
      return;
    }

    paused = !paused;
    if (paused) {
      releasePointerSide();
      keys.left = false;
      keys.right = false;
      keys.drop = false;
      showOverlay("已暫停", "按空白鍵、繼續或開始按鈕回到遊戲", "繼續遊戲");
    } else {
      hideOverlay();
      lastTime = performance.now();
    }
  }

  function spawnParticles(x, y, color, count) {
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 28 + Math.random() * 70;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.5 + Math.random() * 0.32,
        maxLife: 0.82,
        color
      });
    }
  }

  function updateParticles(delta) {
    particles.forEach((particle) => {
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vy += 80 * delta;
      particle.life -= delta;
    });
  }

  function draw() {
    drawBackground();
    drawStars();
    drawPlatforms();
    drawPlayer();
    drawParticles();
    drawProgressHud();
  }

  function drawBackground() {
    const sky = context.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#e7fbff");
    sky.addColorStop(0.48, "#bdf2f4");
    sky.addColorStop(1, "#fff2bd");
    context.fillStyle = sky;
    context.fillRect(0, 0, width, height);

    context.fillStyle = "rgba(13, 148, 136, 0.12)";
    for (let index = 0; index < 52; index += 1) {
      const x = (index * 61) % width;
      const y = (index * 97 + floor * 9) % height;
      context.fillRect(x, y, 2, 2);
    }

    context.strokeStyle = "rgba(47, 215, 255, 0.16)";
    context.lineWidth = 1;
    for (let y = -24; y < height; y += 32) {
      context.beginPath();
      context.moveTo(0, y + ((floor * 5) % 32));
      context.lineTo(width, y + ((floor * 5) % 32));
      context.stroke();
    }
  }

  function drawPlatforms() {
    platforms.forEach((platform) => {
      const gradient = context.createLinearGradient(platform.x, platform.y, platform.x, platform.y + platformHeight);
      const topColor = platform.type === "hazard" ? "#ff5ebc" : platform.type === "start" ? "#8df45f" : "#2fd7ff";
      const bottomColor = platform.type === "hazard" ? "#ba285f" : platform.type === "start" ? "#0d9488" : "#0d9488";
      gradient.addColorStop(0, topColor);
      gradient.addColorStop(1, bottomColor);
      context.fillStyle = gradient;
      context.shadowColor = platform.type === "hazard" ? "rgba(255, 94, 188, 0.5)" : "rgba(47, 215, 255, 0.46)";
      context.shadowBlur = 12;
      roundRect(platform.x, platform.y, platform.width, platformHeight, 6);
      context.fill();
      context.shadowBlur = 0;

      context.fillStyle = "rgba(255, 255, 255, 0.46)";
      roundRect(platform.x + 8, platform.y + 3, Math.max(12, platform.width - 16), 2, 2);
      context.fill();

      if (platform.type === "hazard") {
        context.fillStyle = "rgba(255, 255, 255, 0.8)";
        for (let x = platform.x + 10; x < platform.x + platform.width - 8; x += 18) {
          context.beginPath();
          context.moveTo(x, platform.y + 2);
          context.lineTo(x + 7, platform.y + platformHeight - 2);
          context.lineTo(x + 14, platform.y + 2);
          context.fill();
        }
      }
    });
  }

  function drawStars() {
    stars.forEach((star) => {
      context.save();
      context.translate(star.x, star.y);
      context.rotate(star.spin);
      context.fillStyle = "#ffd84d";
      context.shadowColor = "#ffd84d";
      context.shadowBlur = 18;
      context.beginPath();
      for (let point = 0; point < 10; point += 1) {
        const radius = point % 2 === 0 ? 10 : 4.5;
        const angle = -Math.PI / 2 + point * Math.PI / 5;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (point === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      context.fill();
      context.restore();
      context.shadowBlur = 0;
    });
  }

  function drawPlayer() {
    const x = player.x;
    const y = player.y;
    context.save();
    context.translate(x, y);

    context.fillStyle = "rgba(7, 36, 43, 0.26)";
    context.beginPath();
    context.ellipse(0, 22, 17, 5, 0, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#eaffff";
    context.shadowColor = "rgba(47, 215, 255, 0.42)";
    context.shadowBlur = 12;
    roundRect(-13, -25, 26, 22, 8);
    context.fill();

    context.fillStyle = "#2fd7ff";
    roundRect(-12, -3, 24, 24, 7);
    context.fill();

    context.fillStyle = "#07343d";
    roundRect(-9, -20, 18, 11, 4);
    context.fill();

    context.fillStyle = "#8df45f";
    context.beginPath();
    context.arc(-4, -15, 1.8, 0, Math.PI * 2);
    context.arc(4, -15, 1.8, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = "#8df45f";
    context.lineWidth = 1.6;
    context.beginPath();
    context.moveTo(-4, -11);
    context.quadraticCurveTo(0, -8, 4, -11);
    context.stroke();

    context.strokeStyle = "#2fd7ff";
    context.lineWidth = 4;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(-9, 6);
    context.lineTo(-15, 15);
    context.moveTo(9, 6);
    context.lineTo(15, 15);
    context.stroke();

    context.fillStyle = "#ffd84d";
    context.beginPath();
    context.arc(0, -30, 3, 0, Math.PI * 2);
    context.fill();

    context.restore();
    context.shadowBlur = 0;
  }

  function drawParticles() {
    particles.forEach((particle) => {
      const alpha = Math.max(0, particle.life / particle.maxLife);
      context.globalAlpha = alpha;
      context.fillStyle = particle.color;
      context.shadowColor = particle.color;
      context.shadowBlur = 10;
      context.beginPath();
      context.arc(particle.x, particle.y, 3.2, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;
      context.shadowBlur = 0;
    });
  }

  function drawProgressHud() {
    const progress = Math.min(1, floor / targetFloor);
    context.fillStyle = "rgba(4, 14, 20, 0.5)";
    roundRect(12, 12, 138, 32, 8);
    context.fill();
    context.fillStyle = "rgba(255, 255, 255, 0.28)";
    roundRect(24, 36, 102, 5, 3);
    context.fill();
    context.fillStyle = "#ffd84d";
    roundRect(24, 36, 102 * progress, 5, 3);
    context.fill();
    context.fillStyle = "#ffffff";
    context.font = "900 13px Microsoft JhengHei, sans-serif";
    context.fillText(`100 層 ${floor}/${targetFloor}`, 24, 29);
  }

  function roundRect(x, y, rectWidth, rectHeight, radius) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + rectWidth - radius, y);
    context.quadraticCurveTo(x + rectWidth, y, x + rectWidth, y + radius);
    context.lineTo(x + rectWidth, y + rectHeight - radius);
    context.quadraticCurveTo(x + rectWidth, y + rectHeight, x + rectWidth - radius, y + rectHeight);
    context.lineTo(x + radius, y + rectHeight);
    context.quadraticCurveTo(x, y + rectHeight, x, y + rectHeight - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
    context.closePath();
  }

  function updateUi() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    floorEl.textContent = String(floor);
    floorProgressEl.textContent = String(floor);
    targetProgressEl.style.width = `${Math.min(100, floor)}%`;
    playsEl.textContent = String(plays);
  }

  function readPortalStats() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(portalStatsKey) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function readGameStats() {
    const stats = readPortalStats();
    const games = stats.games && typeof stats.games === "object" ? stats.games : {};
    const existing = games[gameId] && typeof games[gameId] === "object" ? games[gameId] : {};
    return existing;
  }

  function readBestScore() {
    return Number(readGameStats().bestScore) || 0;
  }

  function readPlays() {
    return Number(readGameStats().plays) || 0;
  }

  function ensurePortalStats() {
    const stats = readPortalStats();
    const games = stats.games && typeof stats.games === "object" ? { ...stats.games } : {};
    const existing = games[gameId] && typeof games[gameId] === "object" ? games[gameId] : null;
    if (existing && existing.title === gameTitle && "bestScore" in existing && "lastScore" in existing && "plays" in existing) {
      return;
    }
    games[gameId] = {
      title: gameTitle,
      bestScore: Number(existing?.bestScore) || 0,
      lastScore: Number(existing?.lastScore) || 0,
      plays: Number(existing?.plays) || 0,
      updatedAt: existing?.updatedAt || new Date().toISOString()
    };
    try {
      window.localStorage.setItem(portalStatsKey, JSON.stringify({ ...stats, games }));
    } catch {
      // Ignore private-mode storage failures.
    }
  }

  function writePortalStats(lastScore, bestScore) {
    const stats = readPortalStats();
    const games = stats.games && typeof stats.games === "object" ? { ...stats.games } : {};
    const existing = games[gameId] && typeof games[gameId] === "object" ? games[gameId] : {};
    const playCount = (Number(existing.plays) || 0) + 1;

    games[gameId] = {
      title: gameTitle,
      bestScore: Math.max(Number(existing.bestScore) || 0, bestScore),
      lastScore,
      plays: playCount,
      updatedAt: new Date().toISOString()
    };

    try {
      window.localStorage.setItem(portalStatsKey, JSON.stringify({ ...stats, games }));
    } catch {
      // Ignore private-mode storage failures.
    }

    return games[gameId];
  }

  function showOverlay(title, message, buttonText) {
    overlayTitle.textContent = title;
    overlayMessage.textContent = message;
    overlay.querySelector("button").textContent = buttonText;
    overlay.hidden = false;
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  function handleAction(action) {
    if (action === "instructions") {
      openInstruction();
      return;
    }
    if (action === "start" || action === "overlay-start") {
      if (!running) startGame();
      else if (paused) togglePause();
      return;
    }
    if (action === "pause") togglePause();
    if (action === "restart") restartGame();
  }

  function isSpaceKey(key) {
    return key === " " || key === "Space" || key === "Spacebar";
  }

  function isInstructionOpen() {
    return Boolean(instructionModal && !instructionModal.hidden);
  }

  function openInstruction() {
    if (instructionModal) instructionModal.hidden = false;
  }

  function closeInstruction(shouldStart) {
    if (instructionModal) instructionModal.hidden = true;
    if (shouldStart && !running) startGame();
  }

  function setPointerSide(clientX) {
    const rect = boardCanvas.getBoundingClientRect();
    activePointerSide = clientX < rect.left + rect.width / 2 ? "left" : "right";
    keys.left = activePointerSide === "left";
    keys.right = activePointerSide === "right";
    if (!running) startGame();
  }

  function releasePointerSide() {
    activePointerSide = null;
    keys.left = false;
    keys.right = false;
  }

  function preventDefaultTouch(event) {
    event.preventDefault();
  }

  function firstTouch(event) {
    return event.changedTouches?.[0] || event.touches?.[0] || null;
  }

  function handleControlPress(control) {
    if (!running) startGame();
    if (control === "left") keys.left = true;
    if (control === "right") keys.right = true;
    if (control === "drop") keys.drop = true;
  }

  function handleControlRelease(control) {
    if (control === "left") keys.left = false;
    if (control === "right") keys.right = false;
    if (control === "drop") keys.drop = false;
  }

  function blockPageZoom(event) {
    if (event.touches && event.touches.length > 1) {
      event.preventDefault();
    }
  }

  document.addEventListener("keydown", (event) => {
    if (isInstructionOpen()) {
      if (event.key === "Enter" || isSpaceKey(event.key)) {
        event.preventDefault();
        closeInstruction(true);
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeInstruction(false);
      }
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
      event.preventDefault();
      keys.left = true;
      if (!running) startGame();
    }
    if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
      event.preventDefault();
      keys.right = true;
      if (!running) startGame();
    }
    if (event.key === "ArrowDown" || event.key === "s" || event.key === "S") {
      event.preventDefault();
      keys.drop = true;
      if (!running) startGame();
    }
    if (isSpaceKey(event.key)) {
      event.preventDefault();
      togglePause();
    }
    if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      restartGame();
    }
  });

  document.addEventListener("keyup", (event) => {
    if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") keys.left = false;
    if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") keys.right = false;
    if (event.key === "ArrowDown" || event.key === "s" || event.key === "S") keys.drop = false;
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button.dataset.action));
  });

  document.querySelector("[data-instruction-start]")?.addEventListener("click", () => {
    closeInstruction(true);
  });

  document.querySelector("[data-instruction-close]")?.addEventListener("click", () => {
    closeInstruction(false);
  });

  document.querySelectorAll("[data-control]").forEach((button) => {
    const control = button.dataset.control;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      handleControlPress(control);
    }, { passive: false });

    ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
      button.addEventListener(eventName, () => {
        handleControlRelease(control);
      });
    });

    button.addEventListener("touchstart", (event) => {
      event.preventDefault();
      handleControlPress(control);
    }, { passive: false });

    ["touchend", "touchcancel"].forEach((eventName) => {
      button.addEventListener(eventName, (event) => {
        event.preventDefault();
        handleControlRelease(control);
      }, { passive: false });
    });
  });

  boardCanvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (paused || !running) return;
    setPointerSide(event.clientX);
    try {
      boardCanvas.setPointerCapture?.(event.pointerId);
    } catch {
      // Ignore pointer capture failures from interrupted gestures.
    }
  }, { passive: false });

  boardCanvas.addEventListener("pointermove", (event) => {
    if (!activePointerSide) return;
    if (paused || !running) {
      releasePointerSide();
      keys.left = false;
      keys.right = false;
      return;
    }
    event.preventDefault();
    setPointerSide(event.clientX);
  }, { passive: false });

  boardCanvas.addEventListener("pointerup", (event) => {
    event.preventDefault();
    releasePointerSide();
    try {
      boardCanvas.releasePointerCapture?.(event.pointerId);
    } catch {
      // Ignore if the pointer was not captured.
    }
  }, { passive: false });

  boardCanvas.addEventListener("pointercancel", releasePointerSide);

  boardCanvas.addEventListener("touchstart", (event) => {
    event.preventDefault();
    const touch = firstTouch(event);
    if (!touch || paused || !running) return;
    setPointerSide(touch.clientX);
  }, { passive: false });

  boardCanvas.addEventListener("touchmove", (event) => {
    event.preventDefault();
    const touch = firstTouch(event);
    if (!touch || !activePointerSide) return;
    if (paused || !running) {
      releasePointerSide();
      return;
    }
    setPointerSide(touch.clientX);
  }, { passive: false });

  ["touchend", "touchcancel"].forEach((eventName) => {
    boardCanvas.addEventListener(eventName, (event) => {
      event.preventDefault();
      releasePointerSide();
    }, { passive: false });
  });

  document.addEventListener("touchstart", blockPageZoom, { passive: false, capture: true });
  document.addEventListener("touchmove", blockPageZoom, { passive: false, capture: true });
  touchControls?.addEventListener("touchmove", preventDefaultTouch, { passive: false });

  gameShell?.addEventListener("touchmove", (event) => {
    event.preventDefault();
  }, { passive: false });

  gameShell?.addEventListener("touchend", (event) => {
    const now = Date.now();
    if (now - lastTouchEnd < 360) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });

  ["gesturestart", "gesturechange", "gestureend"].forEach((eventName) => {
    document.addEventListener(eventName, (event) => {
      event.preventDefault();
    }, { passive: false });
    window.addEventListener(eventName, (event) => {
      event.preventDefault();
    }, { passive: false });
  });

  window.addEventListener("pagehide", () => {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }
  });
})();

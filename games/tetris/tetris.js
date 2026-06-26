(function () {
  const columns = 10;
  const rows = 20;
  const cellSize = 30;
  const maxPreviewCount = 5;
  const boardCanvas = document.querySelector("#gameBoard");
  const boardContext = boardCanvas.getContext("2d");
  const previewCanvases = Array.from(document.querySelectorAll("[data-preview-canvas]"));
  const previewStatusEl = document.querySelector("[data-preview-status]");
  const overlay = document.querySelector("[data-overlay]");
  const overlayTitle = document.querySelector("[data-overlay-title]");
  const overlayMessage = document.querySelector("[data-overlay-message]");
  const scoreEl = document.querySelector("[data-score]");
  const bestEl = document.querySelector("[data-best]");
  const levelEl = document.querySelector("[data-level]");
  const linesEl = document.querySelector("[data-lines]");
  const gameShell = document.querySelector(".tetris-shell");
  const instructionModal = document.querySelector("[data-instruction-modal]");
  const storage = window.MicroglowStorage;
  const gameId = "microglow-tetris";
  const gameTitle = "微光俄羅斯方塊";
  const bestKey = "tetris.bestScore.v1";
  const gestureKey = "tetris.gesturesEnabled.v1";
  const portalStatsKey = "tsyMicroglowPortal.gameStats.v1";
  let lastTouchEnd = 0;

  const colors = {
    I: "#2fd7ff",
    J: "#3d75ff",
    L: "#ff9f43",
    O: "#ffd84d",
    S: "#8df45f",
    T: "#c77dff",
    Z: "#ff5e9f"
  };

  const shapes = {
    I: [[1, 1, 1, 1]],
    J: [
      [1, 0, 0],
      [1, 1, 1]
    ],
    L: [
      [0, 0, 1],
      [1, 1, 1]
    ],
    O: [
      [1, 1],
      [1, 1]
    ],
    S: [
      [0, 1, 1],
      [1, 1, 0]
    ],
    T: [
      [0, 1, 0],
      [1, 1, 1]
    ],
    Z: [
      [1, 1, 0],
      [0, 1, 1]
    ]
  };

  let board = createBoard();
  let current = null;
  let queue = createQueue();
  let score = 0;
  let lines = 0;
  let level = 1;
  let best = readBestScore();
  let dropCounter = 0;
  let dropInterval = 820;
  let lastTime = 0;
  let animationFrameId = 0;
  let running = false;
  let paused = false;
  let swapUsed = false;
  let soundOn = true;
  let gesturesOn = storage?.read(gestureKey, true) !== false;
  let audioContext = null;
  let gestureStart = null;
  let lastTap = {
    time: 0,
    x: 0,
    y: 0
  };

  ensurePortalStats();
  updateGestureButton();
  updateSwapButton();
  bestEl.textContent = String(best);
  draw();
  drawPreviews();

  function createBoard() {
    return Array.from({ length: rows }, () => Array(columns).fill(null));
  }

  function randomType() {
    const types = Object.keys(shapes);
    return types[Math.floor(Math.random() * types.length)];
  }

  function createPiece(type = randomType()) {
    const matrix = shapes[type].map((row) => row.slice());
    return {
      type,
      matrix,
      x: Math.floor((columns - matrix[0].length) / 2),
      y: 0
    };
  }

  function createQueue() {
    return Array.from({ length: maxPreviewCount }, randomType);
  }

  function fillQueue() {
    while (queue.length < maxPreviewCount) {
      queue.push(randomType());
    }
  }

  function visiblePreviewCount() {
    return Math.min(maxPreviewCount, Math.max(1, level));
  }

  function resetGame() {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }
    board = createBoard();
    queue = createQueue();
    current = createPiece(queue.shift());
    fillQueue();
    score = 0;
    lines = 0;
    level = 1;
    swapUsed = false;
    dropInterval = 820;
    dropCounter = 0;
    lastTime = 0;
    running = true;
    paused = false;
    if (collides(current)) {
      gameOver();
      return;
    }
    hideOverlay();
    updateUi();
    drawPreviews();
    updateSwapButton();
    animationFrameId = requestAnimationFrame(update);
  }

  function update(time = 0) {
    if (!running) return;
    const delta = time - lastTime;
    lastTime = time;

    if (!paused) {
      dropCounter += delta;
      if (dropCounter > dropInterval) {
        softDrop();
      }
      draw();
    }

    animationFrameId = requestAnimationFrame(update);
  }

  function collides(piece, offsetX = 0, offsetY = 0, matrix = piece.matrix) {
    for (let y = 0; y < matrix.length; y += 1) {
      for (let x = 0; x < matrix[y].length; x += 1) {
        if (!matrix[y][x]) continue;
        const nextX = piece.x + x + offsetX;
        const nextY = piece.y + y + offsetY;
        if (nextX < 0 || nextX >= columns || nextY >= rows) return true;
        if (nextY >= 0 && board[nextY][nextX]) return true;
      }
    }
    return false;
  }

  function mergePiece() {
    current.matrix.forEach((row, y) => {
      row.forEach((value, x) => {
        if (value) {
          const boardY = current.y + y;
          const boardX = current.x + x;
          if (boardY >= 0) board[boardY][boardX] = current.type;
        }
      });
    });
  }

  function clearLines() {
    let cleared = 0;
    for (let y = rows - 1; y >= 0; y -= 1) {
      if (board[y].every(Boolean)) {
        board.splice(y, 1);
        board.unshift(Array(columns).fill(null));
        cleared += 1;
        y += 1;
      }
    }

    if (!cleared) return;

    const lineScores = [0, 100, 300, 500, 800];
    score += lineScores[cleared] * level;
    lines += cleared;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(140, 820 - (level - 1) * 68);
    playTone(420 + cleared * 80, 0.08);
    updateUi();
    drawPreviews();
  }

  function spawnPiece() {
    current = createPiece(queue.shift());
    current.x = Math.floor((columns - current.matrix[0].length) / 2);
    current.y = 0;
    fillQueue();
    swapUsed = false;
    drawPreviews();
    updateSwapButton();
    if (collides(current)) gameOver();
  }

  function move(offset) {
    if (!canPlay()) return;
    if (!collides(current, offset, 0)) {
      current.x += offset;
      playTone(220, 0.025);
      draw();
    }
  }

  function softDrop() {
    if (!canPlay()) return;
    if (!collides(current, 0, 1)) {
      current.y += 1;
      score += 1;
    } else {
      mergePiece();
      clearLines();
      spawnPiece();
      playTone(150, 0.04);
    }
    dropCounter = 0;
    updateUi();
    draw();
  }

  function hardDrop() {
    if (!canPlay()) return;
    let distance = 0;
    while (!collides(current, 0, 1)) {
      current.y += 1;
      distance += 1;
    }
    score += distance * 2;
    mergePiece();
    clearLines();
    spawnPiece();
    dropCounter = 0;
    playTone(120, 0.08);
    updateUi();
    draw();
  }

  function swapWithNext() {
    if (!canPlay() || swapUsed || !queue.length) return;

    const previousType = current.type;
    const incomingType = queue.shift();
    const incoming = createPiece(incomingType);
    incoming.y = current.y;

    if (collides(incoming)) {
      incoming.y = 0;
    }

    if (collides(incoming)) {
      queue.unshift(incomingType);
      return;
    }

    queue.unshift(previousType);
    current = incoming;
    swapUsed = true;
    updateSwapButton();
    drawPreviews();
    draw();
    playTone(520, 0.05);
  }

  function rotatePiece() {
    if (!canPlay() || current.type === "O") return;
    const rotated = rotateMatrix(current.matrix);
    const kicks = [0, -1, 1, -2, 2];
    for (const kick of kicks) {
      if (!collides(current, kick, 0, rotated)) {
        current.matrix = rotated;
        current.x += kick;
        playTone(320, 0.035);
        draw();
        return;
      }
    }
  }

  function rotateMatrix(matrix) {
    return matrix[0].map((_, x) => matrix.map((row) => row[x]).reverse());
  }

  function canPlay() {
    return running && !paused && current;
  }

  function togglePause() {
    if (!running) return;
    paused = !paused;
    if (paused) {
      showOverlay("已暫停", "按暫停、P 或開始按鈕繼續", "繼續遊戲");
    } else {
      hideOverlay();
      lastTime = 0;
    }
  }

  function gameOver() {
    running = false;
    paused = false;
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }
    best = Math.max(best, score);
    storage?.write(bestKey, best);
    writePortalStats(score, best);
    updateUi();
    draw();
    showOverlay("遊戲結束", `本局 ${score} 分，最高分 ${best} 分`, "再玩一次");
    updateSwapButton();
    playTone(90, 0.16);
  }

  function draw() {
    boardContext.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
    drawBackground(boardContext, boardCanvas.width, boardCanvas.height, cellSize);
    board.forEach((row, y) => {
      row.forEach((type, x) => {
        if (type) drawBlock(boardContext, x, y, colors[type], cellSize);
      });
    });

    if (current) {
      current.matrix.forEach((row, y) => {
        row.forEach((value, x) => {
          if (value) {
            drawBlock(boardContext, current.x + x, current.y + y, colors[current.type], cellSize);
          }
        });
      });
    }
  }

  function drawPreviews() {
    const visibleCount = visiblePreviewCount();
    if (previewStatusEl) previewStatusEl.textContent = `Lv.${level} 顯示 ${visibleCount} 顆`;

    previewCanvases.forEach((canvas, index) => {
      const context = canvas.getContext("2d");
      const slot = canvas.closest(".next-slot");
      const type = queue[index];
      const locked = index >= visibleCount;

      slot?.classList.toggle("is-locked", locked);
      drawBackground(context, canvas.width, canvas.height, 23);

      if (!type || locked) return;

      const matrix = shapes[type];
      const offsetX = Math.floor((4 - matrix[0].length) / 2);
      const offsetY = Math.floor((4 - matrix.length) / 2);
      matrix.forEach((row, y) => {
        row.forEach((value, x) => {
          if (value) drawBlock(context, offsetX + x, offsetY + y, colors[type], 23);
        });
      });
    });
  }

  function drawBackground(context, width, height, size) {
    context.fillStyle = "#07171f";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "rgba(47, 215, 255, 0.1)";
    context.lineWidth = 1;
    for (let x = 0; x <= width; x += size) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 0; y <= height; y += size) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
  }

  function drawBlock(context, x, y, color, size) {
    const inset = 2;
    const px = x * size + inset;
    const py = y * size + inset;
    const blockSize = size - inset * 2;
    context.fillStyle = color;
    context.shadowColor = color;
    context.shadowBlur = 12;
    context.fillRect(px, py, blockSize, blockSize);
    context.shadowBlur = 0;
    context.fillStyle = "rgba(255, 255, 255, 0.24)";
    context.fillRect(px + 3, py + 3, blockSize - 6, 4);
    context.strokeStyle = "rgba(255, 255, 255, 0.3)";
    context.lineWidth = 1;
    context.strokeRect(px + 0.5, py + 0.5, blockSize - 1, blockSize - 1);
  }

  function updateUi() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    levelEl.textContent = String(level);
    linesEl.textContent = String(lines);
    updateSwapButton();
  }

  function readPortalStats() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(portalStatsKey) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function writePortalStats(lastScore, bestScore) {
    const stats = readPortalStats();
    const games = stats.games && typeof stats.games === "object" ? stats.games : {};
    const existing = games[gameId] && typeof games[gameId] === "object" ? games[gameId] : {};

    games[gameId] = {
      title: gameTitle,
      bestScore: Math.max(Number(existing.bestScore) || 0, bestScore),
      lastScore,
      plays: (Number(existing.plays) || 0) + 1,
      updatedAt: new Date().toISOString()
    };

    try {
      window.localStorage.setItem(portalStatsKey, JSON.stringify({ ...stats, games }));
    } catch {
      // Ignore private-mode storage failures.
    }
  }

  function ensurePortalStats() {
    const stats = readPortalStats();
    const games = stats.games && typeof stats.games === "object" ? stats.games : {};
    const existing = games[gameId] && typeof games[gameId] === "object" ? games[gameId] : null;
    const existingBest = Number(existing?.bestScore) || 0;
    const nextBest = Math.max(existingBest, best);

    games[gameId] = {
      title: gameTitle,
      bestScore: nextBest,
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

  function readBestScore() {
    const portalBest = Number(readPortalStats().games?.[gameId]?.bestScore) || 0;
    const legacyBest = storage?.number(bestKey, 0) || 0;
    return Math.max(portalBest, legacyBest);
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

  function playTone(frequency, duration) {
    if (!soundOn) return;
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.04, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + duration);
    } catch {
      soundOn = false;
    }
  }

  function handleAction(action) {
    if (action === "start") {
      if (!running) resetGame();
      else if (paused) togglePause();
    }
    if (action === "pause") togglePause();
    if (action === "restart") resetGame();
    if (action === "swap") swapWithNext();
    if (action === "sound") {
      soundOn = !soundOn;
      const button = document.querySelector('[data-action="sound"]');
      button.textContent = soundOn ? "音效開" : "音效關";
      button.setAttribute("aria-pressed", String(soundOn));
    }
    if (action === "gesture") {
      gesturesOn = !gesturesOn;
      storage?.write(gestureKey, gesturesOn);
      updateGestureButton();
    }
  }

  function isInstructionOpen() {
    return Boolean(instructionModal && !instructionModal.hidden);
  }

  function closeInstruction(shouldStart) {
    if (instructionModal) instructionModal.hidden = true;
    if (shouldStart && !running) resetGame();
  }

  function updateGestureButton() {
    const button = document.querySelector('[data-action="gesture"]');
    if (!button) return;
    button.textContent = gesturesOn ? "手勢開" : "手勢關";
    button.setAttribute("aria-pressed", String(gesturesOn));
  }

  function updateSwapButton() {
    const disabled = !running || paused || swapUsed || !current;
    document.querySelectorAll('[data-action="swap"], [data-control="swap"]').forEach((button) => {
      button.disabled = disabled;
      button.textContent = swapUsed ? "已換" : "換下顆";
    });
  }

  function ensureGestureGame() {
    if (!running) {
      resetGame();
      return true;
    }
    return !paused;
  }

  function handleBoardGesture(start, end) {
    if (!gesturesOn || !start || !ensureGestureGame()) return;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const elapsed = end.time - start.time;
    const tapDistance = Math.hypot(dx, dy);
    const isTap = tapDistance < 14 && elapsed < 260;

    if (isTap) {
      const tapGap = end.time - lastTap.time;
      const tapMove = Math.hypot(end.x - lastTap.x, end.y - lastTap.y);
      if (tapGap > 0 && tapGap < 320 && tapMove < 28) {
        rotatePiece();
        lastTap = { time: 0, x: 0, y: 0 };
        return;
      }
      lastTap = { time: end.time, x: end.x, y: end.y };
      return;
    }

    lastTap = { time: 0, x: 0, y: 0 };

    if (dy > 34 && absY > absX * 1.18) {
      hardDrop();
      return;
    }

    if (absX > 24 && absX > absY * 1.12) {
      const direction = dx > 0 ? 1 : -1;
      const steps = Math.min(3, Math.max(1, Math.round(absX / 44)));
      for (let index = 0; index < steps; index += 1) {
        move(direction);
      }
    }
  }

  document.addEventListener("keydown", (event) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", " ", "p", "P", "c", "C", "Enter"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    if (isInstructionOpen()) {
      if (event.key === "Enter" || event.key === " ") closeInstruction(true);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && !running) {
      resetGame();
      return;
    }
    if (event.key === "ArrowLeft") move(-1);
    if (event.key === "ArrowRight") move(1);
    if (event.key === "ArrowDown") softDrop();
    if (event.key === "ArrowUp") rotatePiece();
    if (event.key === " ") hardDrop();
    if (event.key === "p" || event.key === "P") togglePause();
    if (event.key === "c" || event.key === "C") swapWithNext();
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
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const control = button.dataset.control;
      if (!running) resetGame();
      if (control === "left") move(-1);
      if (control === "right") move(1);
      if (control === "down") softDrop();
      if (control === "rotate") rotatePiece();
      if (control === "swap") swapWithNext();
      if (control === "drop") hardDrop();
    }, { passive: false });
  });

  boardCanvas.addEventListener("pointerdown", (event) => {
    if (!gesturesOn) return;
    event.preventDefault();
    gestureStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: Date.now()
    };
    try {
      boardCanvas.setPointerCapture?.(event.pointerId);
    } catch {
      // Some browsers reject capture for synthetic or interrupted pointers.
    }
  }, { passive: false });

  boardCanvas.addEventListener("pointermove", (event) => {
    if (!gesturesOn || !gestureStart) return;
    event.preventDefault();
  }, { passive: false });

  boardCanvas.addEventListener("pointerup", (event) => {
    if (!gesturesOn || !gestureStart || event.pointerId !== gestureStart.pointerId) return;
    event.preventDefault();
    handleBoardGesture(gestureStart, {
      x: event.clientX,
      y: event.clientY,
      time: Date.now()
    });
    try {
      boardCanvas.releasePointerCapture?.(event.pointerId);
    } catch {
      // Ignore if the pointer was not captured.
    }
    gestureStart = null;
  }, { passive: false });

  boardCanvas.addEventListener("pointercancel", () => {
    gestureStart = null;
  });

  gameShell?.addEventListener("touchmove", (event) => {
    event.preventDefault();
  }, { passive: false });

  gameShell?.addEventListener("dblclick", (event) => {
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
  });
})();

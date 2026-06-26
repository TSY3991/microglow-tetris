(function () {
  const gridSize = 16;
  const cellSize = 30;
  const boardCanvas = document.querySelector("#snakeBoard");
  const context = boardCanvas.getContext("2d");
  const overlay = document.querySelector("[data-overlay]");
  const overlayTitle = document.querySelector("[data-overlay-title]");
  const overlayMessage = document.querySelector("[data-overlay-message]");
  const scoreEl = document.querySelector("[data-score]");
  const bestEl = document.querySelector("[data-best]");
  const lengthEl = document.querySelector("[data-length]");
  const playsEl = document.querySelector("[data-plays]");
  const gameShell = document.querySelector(".snake-shell");
  const gameId = "microglow-snake";
  const gameTitle = "微光貪吃蛇";
  const portalStatsKey = "tsyMicroglowPortal.gameStats.v1";

  const directions = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  };

  let snake = [];
  let direction = directions.right;
  let queuedDirection = directions.right;
  let food = { x: 11, y: 8 };
  let score = 0;
  let best = readBestScore();
  let plays = readPlays();
  let running = false;
  let paused = false;
  let recordedThisRun = false;
  let tickId = 0;
  let speed = 132;
  let touchStart = null;
  let lastTouchEnd = 0;

  resetState();
  updateUi();
  draw();

  function resetState() {
    snake = [
      { x: 7, y: 8 },
      { x: 6, y: 8 },
      { x: 5, y: 8 }
    ];
    direction = directions.right;
    queuedDirection = directions.right;
    food = createFood();
    score = 0;
    speed = 132;
    paused = false;
    recordedThisRun = false;
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
    draw();
    scheduleTick();
  }

  function restartGame() {
    stopTick();
    running = false;
    startGame();
  }

  function scheduleTick() {
    stopTick();
    tickId = window.setTimeout(tick, speed);
  }

  function stopTick() {
    if (tickId) {
      window.clearTimeout(tickId);
      tickId = 0;
    }
  }

  function tick() {
    if (!running || paused) return;

    direction = queuedDirection;
    const head = snake[0];
    const nextHead = {
      x: head.x + direction.x,
      y: head.y + direction.y
    };

    if (hitsWall(nextHead) || hitsSnake(nextHead)) {
      endGame();
      return;
    }

    snake.unshift(nextHead);

    if (nextHead.x === food.x && nextHead.y === food.y) {
      score += 10;
      speed = Math.max(76, speed - 2);
      food = createFood();
    } else {
      snake.pop();
    }

    updateUi();
    draw();
    scheduleTick();
  }

  function hitsWall(cell) {
    return cell.x < 0 || cell.x >= gridSize || cell.y < 0 || cell.y >= gridSize;
  }

  function hitsSnake(cell) {
    return snake.some((part) => part.x === cell.x && part.y === cell.y);
  }

  function createFood() {
    const emptyCells = [];
    for (let y = 0; y < gridSize; y += 1) {
      for (let x = 0; x < gridSize; x += 1) {
        if (!snake.some((part) => part.x === x && part.y === y)) {
          emptyCells.push({ x, y });
        }
      }
    }
    return emptyCells[Math.floor(Math.random() * emptyCells.length)] || { x: 0, y: 0 };
  }

  function endGame() {
    if (recordedThisRun) return;
    recordedThisRun = true;
    running = false;
    paused = false;
    stopTick();
    best = Math.max(best, score);
    plays = writePortalStats(score, best).plays;
    updateUi();
    draw();
    showOverlay("遊戲結束", `本局 ${score} 分，最高分 ${best} 分`, "再玩一次");
  }

  function togglePause() {
    if (!running) {
      startGame();
      return;
    }

    paused = !paused;
    if (paused) {
      stopTick();
      showOverlay("已暫停", "按空白鍵、繼續或開始按鈕回到遊戲", "繼續遊戲");
    } else {
      hideOverlay();
      scheduleTick();
    }
  }

  function setDirection(nextName) {
    const next = directions[nextName];
    if (!next) return;
    if (!running || paused) return;
    if (next.x + direction.x === 0 && next.y + direction.y === 0) return;
    queuedDirection = next;
  }

  function draw() {
    drawBackground();
    drawFood();
    drawSnake();
  }

  function drawBackground() {
    context.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
    context.fillStyle = "#07171f";
    context.fillRect(0, 0, boardCanvas.width, boardCanvas.height);

    context.strokeStyle = "rgba(141, 244, 95, 0.1)";
    context.lineWidth = 1;
    for (let index = 0; index <= gridSize; index += 1) {
      const position = index * cellSize;
      context.beginPath();
      context.moveTo(position, 0);
      context.lineTo(position, boardCanvas.height);
      context.stroke();
      context.beginPath();
      context.moveTo(0, position);
      context.lineTo(boardCanvas.width, position);
      context.stroke();
    }
  }

  function drawSnake() {
    snake.forEach((part, index) => {
      const isHead = index === 0;
      const color = isHead ? "#2fd7ff" : "#8df45f";
      const inset = isHead ? 3 : 4;
      const x = part.x * cellSize + inset;
      const y = part.y * cellSize + inset;
      const size = cellSize - inset * 2;

      context.fillStyle = color;
      context.shadowColor = color;
      context.shadowBlur = isHead ? 16 : 10;
      context.fillRect(x, y, size, size);
      context.shadowBlur = 0;
      context.fillStyle = "rgba(255, 255, 255, 0.24)";
      context.fillRect(x + 4, y + 4, Math.max(4, size - 8), 4);
      context.strokeStyle = "rgba(255, 255, 255, 0.3)";
      context.lineWidth = 1;
      context.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    });
  }

  function drawFood() {
    const centerX = food.x * cellSize + cellSize / 2;
    const centerY = food.y * cellSize + cellSize / 2;

    context.fillStyle = "#ff5ebc";
    context.shadowColor = "#ff5ebc";
    context.shadowBlur = 18;
    context.beginPath();
    context.arc(centerX, centerY, cellSize * 0.32, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    context.fillStyle = "rgba(255, 255, 255, 0.42)";
    context.beginPath();
    context.arc(centerX - 4, centerY - 4, 4, 0, Math.PI * 2);
    context.fill();
  }

  function updateUi() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    lengthEl.textContent = String(snake.length);
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

  function readSnakeStats() {
    const stats = readPortalStats();
    const games = stats.games && typeof stats.games === "object" ? stats.games : {};
    const existing = games[gameId] && typeof games[gameId] === "object" ? games[gameId] : {};
    return existing;
  }

  function readBestScore() {
    return Number(readSnakeStats().bestScore) || 0;
  }

  function readPlays() {
    return Number(readSnakeStats().plays) || 0;
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
    if (action === "start" || action === "overlay-start") {
      if (!running) startGame();
      else if (paused) togglePause();
      return;
    }
    if (action === "pause") togglePause();
    if (action === "restart") restartGame();
  }

  function directionFromKey(key) {
    if (key === "ArrowUp" || key === "w" || key === "W") return "up";
    if (key === "ArrowDown" || key === "s" || key === "S") return "down";
    if (key === "ArrowLeft" || key === "a" || key === "A") return "left";
    if (key === "ArrowRight" || key === "d" || key === "D") return "right";
    return "";
  }

  function isSpaceKey(key) {
    return key === " " || key === "Space" || key === "Spacebar";
  }

  function handleSwipe(start, end) {
    if (!start) return;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (Math.max(absX, absY) < 24) return;
    if (absX > absY) {
      setDirection(dx > 0 ? "right" : "left");
    } else {
      setDirection(dy > 0 ? "down" : "up");
    }
  }

  document.addEventListener("keydown", (event) => {
    const directionName = directionFromKey(event.key);
    if (directionName) {
      event.preventDefault();
      setDirection(directionName);
      return;
    }

    if (isSpaceKey(event.key)) {
      event.preventDefault();
      togglePause();
      return;
    }

    if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      restartGame();
    }
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button.dataset.action));
  });

  document.querySelectorAll("[data-control]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      setDirection(button.dataset.control);
    }, { passive: false });
  });

  boardCanvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    touchStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY
    };
    try {
      boardCanvas.setPointerCapture?.(event.pointerId);
    } catch {
      // Ignore pointer capture failures from interrupted gestures.
    }
  }, { passive: false });

  boardCanvas.addEventListener("pointermove", (event) => {
    if (!touchStart) return;
    event.preventDefault();
  }, { passive: false });

  boardCanvas.addEventListener("pointerup", (event) => {
    if (!touchStart || event.pointerId !== touchStart.pointerId) return;
    event.preventDefault();
    handleSwipe(touchStart, { x: event.clientX, y: event.clientY });
    try {
      boardCanvas.releasePointerCapture?.(event.pointerId);
    } catch {
      // Ignore if the pointer was not captured.
    }
    touchStart = null;
  }, { passive: false });

  boardCanvas.addEventListener("pointercancel", () => {
    touchStart = null;
  });

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
  });
})();

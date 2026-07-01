(function () {
  const boardCanvas = document.querySelector("#gemBoard");
  const context = boardCanvas.getContext("2d");
  const overlay = document.querySelector("[data-overlay]");
  const overlayTitle = document.querySelector("[data-overlay-title]");
  const overlayMessage = document.querySelector("[data-overlay-message]");
  const scoreEl = document.querySelector("[data-score]");
  const bestEl = document.querySelector("[data-best]");
  const stageEl = document.querySelector("[data-stage]");
  const playsEl = document.querySelector("[data-plays]");
  const targetCurrentEl = document.querySelector("[data-target-current]");
  const targetGoalEl = document.querySelector("[data-target-goal]");
  const targetProgressEl = document.querySelector("[data-target-progress]");
  const stageHintEl = document.querySelector("[data-stage-hint]");
  const movesEl = document.querySelector("[data-moves]");
  const starsEl = document.querySelector("[data-stars]");
  const overlaySecondary = document.querySelector("[data-overlay-secondary]");
  const instructionModal = document.querySelector("[data-instruction-modal]");
  const storage = window.MicroglowStorage;

  const gameId = "microglow-gem";
  const gameTitle = "微光寶石";
  const portalStatsKey = "tsyMicroglowPortal.gameStats.v1";

  const COLS = 8;
  const ROWS = 8;
  const CELL = Math.floor(boardCanvas.width / COLS);
  const COLORS = [
    { id: 0, name: "teal", fill: "#0d9488", glow: "rgba(13, 148, 136, 0.55)" },
    { id: 1, name: "pink", fill: "#ff5ebc", glow: "rgba(255, 94, 188, 0.55)" },
    { id: 2, name: "yellow", fill: "#ffd84d", glow: "rgba(255, 216, 77, 0.55)" },
    { id: 3, name: "purple", fill: "#9b6bff", glow: "rgba(155, 107, 255, 0.55)" },
    { id: 4, name: "cyan", fill: "#2fd7ff", glow: "rgba(47, 215, 255, 0.55)" },
    { id: 5, name: "amber", fill: "#ff9a3d", glow: "rgba(255, 154, 61, 0.55)" },
    { id: 6, name: "lime", fill: "#8df45f", glow: "rgba(141, 244, 95, 0.55)" },
    { id: 7, name: "rose", fill: "#ff4d6a", glow: "rgba(255, 77, 106, 0.55)" }
  ];

  // gem object: { color, special: null | "line-h" | "line-v" | "wrapped" | "color-bomb" }
  const SPECIAL_LINE_H = "line-h";
  const SPECIAL_LINE_V = "line-v";
  const SPECIAL_WRAPPED = "wrapped";
  const SPECIAL_COLOR_BOMB = "color-bomb";

  // Finite campaign: 15 hand-tuned stages (goal score / move budget / active gem colors),
  // then an endless mode with escalating goals and shrinking move budgets.
  const STAGE_TABLE = [
    { goal: 2000, moves: 20, colors: 5 },
    { goal: 3000, moves: 20, colors: 5 },
    { goal: 4000, moves: 18, colors: 5 },
    { goal: 5000, moves: 18, colors: 6 },
    { goal: 6500, moves: 18, colors: 6 },
    { goal: 8000, moves: 16, colors: 6 },
    { goal: 9500, moves: 16, colors: 7 },
    { goal: 11500, moves: 16, colors: 7 },
    { goal: 13500, moves: 15, colors: 7 },
    { goal: 16000, moves: 15, colors: 8 },
    { goal: 18500, moves: 14, colors: 8 },
    { goal: 21000, moves: 14, colors: 8 },
    { goal: 24000, moves: 13, colors: 8 },
    { goal: 27000, moves: 13, colors: 8 },
    { goal: 30000, moves: 12, colors: 8 }
  ];
  const MAX_STORY_STAGE = STAGE_TABLE.length;
  const ENDLESS_GOAL_STEP = 4000;
  const ENDLESS_MIN_MOVES = 10;

  function stageConfig(s) {
    if (s <= MAX_STORY_STAGE) return STAGE_TABLE[s - 1];
    const over = s - MAX_STORY_STAGE;
    const lastGoal = STAGE_TABLE[MAX_STORY_STAGE - 1].goal;
    return {
      goal: lastGoal + over * ENDLESS_GOAL_STEP,
      moves: Math.max(ENDLESS_MIN_MOVES, 12 - Math.floor(over / 3)),
      colors: 8
    };
  }

  let board = [];
  let score = 0;
  let best = 0;
  let plays = 0;
  let bestStars = 0;
  let totalStars = 0;
  let stage = 1;
  let stageScoreAtStart = 0;
  let movesLeft = stageConfig(1).moves;
  let colorCount = stageConfig(1).colors;
  let endlessMode = false;
  let running = false;
  let busy = false; // true while animations / resolution running
  let selected = null; // {r, c} or null
  let cursor = { r: 4, c: 4 }; // keyboard cursor
  let cursorVisible = false;
  let hintPair = null; // [{r,c},{r,c}] for blinking hint
  let hintBlinkUntil = 0;
  let pointer = null; // { startR, startC, startX, startY, pointerId, moved }
  let animationFrameId = 0;
  let lastTime = 0;
  let particles = [];
  let chainPopups = []; // {x,y,text,life,maxLife}
  let backgroundCanvas = null; // cached static board background, rendered once on first draw

  ensurePortalStats();
  best = readBestScore();
  plays = readPlays();
  bestStars = readBestStars();

  initBoard();
  updateUi();
  draw();
  showOverlay("準備開始", "交換相鄰寶石形成 3 連，在步數用盡前達成目標分數進入下一關。", "開始遊戲");

  /* ---------- portal stats ---------- */

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

  function readBestStars() {
    return Number(readGameStats().bestStars) || 0;
  }

  function ensurePortalStats() {
    const stats = readPortalStats();
    const games = stats.games && typeof stats.games === "object" ? { ...stats.games } : {};
    const existing = games[gameId] && typeof games[gameId] === "object" ? games[gameId] : null;
    if (existing && existing.title === gameTitle && "bestScore" in existing && "lastScore" in existing && "plays" in existing && "bestStars" in existing) {
      return;
    }
    games[gameId] = {
      title: gameTitle,
      bestScore: Number(existing?.bestScore) || 0,
      lastScore: Number(existing?.lastScore) || 0,
      plays: Number(existing?.plays) || 0,
      bestStage: Number(existing?.bestStage) || 1,
      bestStars: Number(existing?.bestStars) || 0,
      updatedAt: existing?.updatedAt || new Date().toISOString()
    };
    try {
      window.localStorage.setItem(portalStatsKey, JSON.stringify({ ...stats, games }));
    } catch {
      // Ignore private-mode storage failures.
    }
  }

  function writePortalStats(lastScore, bestScore, bestStage, totalStarsThisRun) {
    const stats = readPortalStats();
    const games = stats.games && typeof stats.games === "object" ? { ...stats.games } : {};
    const existing = games[gameId] && typeof games[gameId] === "object" ? games[gameId] : {};
    const playCount = (Number(existing.plays) || 0) + 1;
    games[gameId] = {
      title: gameTitle,
      bestScore: Math.max(Number(existing.bestScore) || 0, bestScore),
      lastScore,
      plays: playCount,
      bestStage: Math.max(Number(existing.bestStage) || 1, bestStage),
      bestStars: Math.max(Number(existing.bestStars) || 0, totalStarsThisRun || 0),
      updatedAt: new Date().toISOString()
    };
    try {
      window.localStorage.setItem(portalStatsKey, JSON.stringify({ ...stats, games }));
    } catch {
      // Ignore private-mode storage failures.
    }
    return games[gameId];
  }

  /* ---------- board init ---------- */

  function randomColor() {
    return Math.floor(Math.random() * colorCount);
  }

  function makeGem(color) {
    return { color, special: null };
  }

  function initBoard() {
    // Fill with no immediate matches.
    board = [];
    for (let r = 0; r < ROWS; r += 1) {
      const row = [];
      for (let c = 0; c < COLS; c += 1) {
        let color;
        do {
          color = randomColor();
        } while (
          (c >= 2 && row[c - 1].color === color && row[c - 2].color === color) ||
          (r >= 2 && board[r - 1][c].color === color && board[r - 2][c].color === color)
        );
        row.push(makeGem(color));
      }
      board.push(row);
    }
    // Ensure at least one solvable move; reshuffle if not.
    if (!findFirstMove()) {
      shuffleBoardSilently();
    }
  }

  /* ---------- match detection ---------- */

  function findMatches() {
    // Returns Set of "r,c" strings.
    const matched = new Set();
    // Horizontal runs
    for (let r = 0; r < ROWS; r += 1) {
      let runStart = 0;
      for (let c = 1; c <= COLS; c += 1) {
        const sameAsPrev = c < COLS && board[r][c].color === board[r][runStart].color;
        if (!sameAsPrev) {
          const runLen = c - runStart;
          if (runLen >= 3) {
            for (let k = runStart; k < c; k += 1) matched.add(`${r},${k}`);
          }
          runStart = c;
        }
      }
    }
    // Vertical runs
    for (let c = 0; c < COLS; c += 1) {
      let runStart = 0;
      for (let r = 1; r <= ROWS; r += 1) {
        const sameAsPrev = r < ROWS && board[r][c].color === board[runStart][c].color;
        if (!sameAsPrev) {
          const runLen = r - runStart;
          if (runLen >= 3) {
            for (let k = runStart; k < r; k += 1) matched.add(`${k},${c}`);
          }
          runStart = r;
        }
      }
    }
    return matched;
  }

  function classifyMatchGroups(matched) {
    // For special-gem creation: walk the matched set, find connected groups (4-neighbour),
    // determine size and shape category.
    const visited = new Set();
    const groups = [];
    for (const key of matched) {
      if (visited.has(key)) continue;
      const queue = [key];
      const cells = [];
      while (queue.length) {
        const k = queue.pop();
        if (visited.has(k)) continue;
        visited.add(k);
        cells.push(k);
        const [r, c] = k.split(",").map(Number);
        const neighbours = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
        for (const [nr, nc] of neighbours) {
          const nk = `${nr},${nc}`;
          if (matched.has(nk) && !visited.has(nk) && board[r][c].color === board[nr]?.[nc]?.color) {
            queue.push(nk);
          }
        }
      }
      groups.push(cells);
    }
    return groups;
  }

  /* ---------- swap & resolve ---------- */

  function inBounds(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
  }

  function isAdjacent(a, b) {
    return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
  }

  // Adds the cell keys affected by a non-bomb special (line / wrapped) anchored at (r,c) into `set`.
  function addAreaCells(set, special, r, c) {
    if (special === SPECIAL_LINE_H) {
      for (let cc = 0; cc < COLS; cc += 1) set.add(`${r},${cc}`);
    } else if (special === SPECIAL_LINE_V) {
      for (let rr = 0; rr < ROWS; rr += 1) set.add(`${rr},${c}`);
    } else if (special === SPECIAL_WRAPPED) {
      for (let rr = r - 1; rr <= r + 1; rr += 1) {
        for (let cc = c - 1; cc <= c + 1; cc += 1) {
          if (inBounds(rr, cc)) set.add(`${rr},${cc}`);
        }
      }
    }
  }

  function swap(a, b) {
    const tmp = board[a.r][a.c];
    board[a.r][a.c] = board[b.r][b.c];
    board[b.r][b.c] = tmp;
  }

  function trySwap(a, b) {
    if (busy || !running) return;
    if (!inBounds(a.r, a.c) || !inBounds(b.r, b.c)) return;
    if (!isAdjacent(a, b)) return;
    busy = true;
    wake();
    swap(a, b);
    // Special triggers always succeed (color-bomb on anything)
    const aGem = board[b.r][b.c]; // after swap, original a is now at b
    const bGem = board[a.r][a.c];
    const specialTriggered = handleSpecialSwap(a, b, aGem, bGem);
    const matches = findMatches();
    if (matches.size === 0 && !specialTriggered) {
      // Revert
      swap(a, b);
      busy = false;
      flashInvalid(a, b);
      return;
    }
    movesLeft = Math.max(0, movesLeft - 1);
    updateUi();
    resolveChain(1, specialTriggered).then(() => {
      busy = false;
      checkStageProgress();
      if (!running) return;
      if (movesLeft <= 0) {
        triggerGameOver();
        return;
      }
      // If no move exists, auto shuffle.
      if (!findFirstMove()) {
        announce("無解，自動洗牌");
        shuffleBoard();
      }
    });
  }

  function handleSpecialSwap(a, b, aGem, bGem) {
    const aIsBomb = aGem.special === SPECIAL_COLOR_BOMB;
    const bIsBomb = bGem.special === SPECIAL_COLOR_BOMB;
    const isAreaSpecial = (s) => s === SPECIAL_LINE_H || s === SPECIAL_LINE_V || s === SPECIAL_WRAPPED;

    if (aIsBomb && bIsBomb) {
      // Both bombs: remove everything.
      const all = new Set();
      for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) all.add(`${r},${c}`);
      eliminate(all, 1, []);
      applyGravityAndRefill();
      return true;
    }
    if (aIsBomb || bIsBomb) {
      const other = aIsBomb ? bGem : aGem;
      const cells = new Set();
      if (isAreaSpecial(other.special)) {
        // Bomb + special: every gem of the special's color also detonates that special's effect.
        for (let r = 0; r < ROWS; r += 1) {
          for (let c = 0; c < COLS; c += 1) {
            if (board[r][c].color === other.color) addAreaCells(cells, other.special, r, c);
          }
        }
      } else {
        // Bomb + plain gem: clear every gem of that color.
        for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) {
          if (board[r][c].color === other.color) cells.add(`${r},${c}`);
        }
      }
      cells.add(`${a.r},${a.c}`);
      cells.add(`${b.r},${b.c}`);
      eliminate(cells, 1, []);
      applyGravityAndRefill();
      return true;
    }

    if (isAreaSpecial(aGem.special) && isAreaSpecial(bGem.special)) {
      const cells = new Set();
      const aIsWrapped = aGem.special === SPECIAL_WRAPPED;
      const bIsWrapped = bGem.special === SPECIAL_WRAPPED;
      if (aIsWrapped && bIsWrapped) {
        // Wrapped + wrapped: a big 5x5 blast.
        for (let rr = a.r - 2; rr <= a.r + 2; rr += 1) {
          for (let cc = a.c - 2; cc <= a.c + 2; cc += 1) {
            if (inBounds(rr, cc)) cells.add(`${rr},${cc}`);
          }
        }
      } else if (aIsWrapped || bIsWrapped) {
        // Line + wrapped: clear 3 rows (horizontal line) or 3 columns (vertical line).
        const lineGem = aIsWrapped ? bGem : aGem;
        const horizontal = lineGem.special === SPECIAL_LINE_H;
        if (horizontal) {
          for (let dr = -1; dr <= 1; dr += 1) {
            const rr = a.r + dr;
            if (rr >= 0 && rr < ROWS) for (let cc = 0; cc < COLS; cc += 1) cells.add(`${rr},${cc}`);
          }
        } else {
          for (let dc = -1; dc <= 1; dc += 1) {
            const cc = a.c + dc;
            if (cc >= 0 && cc < COLS) for (let rr = 0; rr < ROWS; rr += 1) cells.add(`${rr},${cc}`);
          }
        }
      } else {
        // Line + line: clear the full row and column through both swapped cells.
        addAreaCells(cells, SPECIAL_LINE_H, a.r, a.c);
        addAreaCells(cells, SPECIAL_LINE_V, a.r, a.c);
        addAreaCells(cells, SPECIAL_LINE_H, b.r, b.c);
        addAreaCells(cells, SPECIAL_LINE_V, b.r, b.c);
      }
      eliminate(cells, 1, []);
      applyGravityAndRefill();
      return true;
    }
    return false;
  }

  function resolveChain(chainLevel, alreadyEliminated) {
    return new Promise((resolve) => {
      const tick = () => {
        const matches = findMatches();
        if (matches.size === 0) {
          resolve();
          return;
        }
        const groups = classifyMatchGroups(matches);
        const specials = computeSpecialsToPlace(groups);
        eliminate(matches, chainLevel, specials);
        applyGravityAndRefill();
        if (chainLevel > 1) {
          const center = pickCenter(matches);
          chainPopups.push({
            x: center.x,
            y: center.y,
            text: `連鎖 x${chainLevel}`,
            life: 0,
            maxLife: 0.9
          });
        }
        chainLevel += 1;
        // Allow brief delay so popups/particles read
        window.setTimeout(tick, 120);
      };
      tick();
    });
  }

  function pickCenter(matched) {
    let sumR = 0, sumC = 0, n = 0;
    for (const key of matched) {
      const [r, c] = key.split(",").map(Number);
      sumR += r; sumC += c; n += 1;
    }
    const cr = sumR / Math.max(1, n);
    const cc = sumC / Math.max(1, n);
    return { x: cc * CELL + CELL / 2, y: cr * CELL + CELL / 2 };
  }

  function computeSpecialsToPlace(groups) {
    // Returns array of { r, c, special } describing where to drop a special gem after eliminating.
    const specials = [];
    for (const group of groups) {
      const size = group.length;
      if (size < 4) continue;
      // Anchor: middle cell of the group
      const mid = group[Math.floor(group.length / 2)];
      const [r, c] = mid.split(",").map(Number);
      const color = board[r][c].color;
      if (size >= 5) {
        specials.push({ r, c, special: SPECIAL_COLOR_BOMB, color: -1 });
      } else {
        // size === 4: distinguish a straight line from an L/T junction (two runs crossing).
        let minR = ROWS, maxR = 0, minC = COLS, maxC = 0;
        for (const key of group) {
          const [gr, gc] = key.split(",").map(Number);
          if (gr < minR) minR = gr;
          if (gr > maxR) maxR = gr;
          if (gc < minC) minC = gc;
          if (gc > maxC) maxC = gc;
        }
        const collinear = minR === maxR || minC === maxC;
        if (collinear) {
          const horizontal = (maxC - minC) >= (maxR - minR);
          specials.push({ r, c, special: horizontal ? SPECIAL_LINE_H : SPECIAL_LINE_V, color });
        } else {
          specials.push({ r, c, special: SPECIAL_WRAPPED, color });
        }
      }
    }
    return specials;
  }

  function eliminate(cells, chainLevel, specialsToPlace) {
    // Expand special-gem effects iteratively: removing a line-h removes its whole row, etc.
    const expanded = new Set(cells);
    const queue = Array.from(cells);
    while (queue.length) {
      const key = queue.shift();
      const [r, c] = key.split(",").map(Number);
      const gem = board[r]?.[c];
      if (!gem || !gem.special) continue;
      if (gem.special === SPECIAL_LINE_H || gem.special === SPECIAL_LINE_V || gem.special === SPECIAL_WRAPPED) {
        const areaCells = new Set();
        addAreaCells(areaCells, gem.special, r, c);
        for (const nk of areaCells) {
          if (!expanded.has(nk)) { expanded.add(nk); queue.push(nk); }
        }
      } else if (gem.special === SPECIAL_COLOR_BOMB) {
        // Remove all of the most common adjacent color
        const color = pickDominantColor();
        for (let rr = 0; rr < ROWS; rr += 1) for (let cc = 0; cc < COLS; cc += 1) {
          if (board[rr][cc].color === color) {
            const nk = `${rr},${cc}`;
            if (!expanded.has(nk)) { expanded.add(nk); queue.push(nk); }
          }
        }
      }
    }
    // Score
    const baseGain = expanded.size * 30;
    const multiplier = Math.pow(1.2, chainLevel - 1);
    const gain = Math.round(baseGain * multiplier);
    score += gain;
    // Particles
    for (const key of expanded) {
      const [r, c] = key.split(",").map(Number);
      const gem = board[r][c];
      const x = c * CELL + CELL / 2;
      const y = r * CELL + CELL / 2;
      const color = gem.special === SPECIAL_COLOR_BOMB ? "#ffffff" : COLORS[gem.color].fill;
      spawnBurst(x, y, color, 8);
    }
    // Clear cells
    for (const key of expanded) {
      const [r, c] = key.split(",").map(Number);
      board[r][c] = null;
    }
    // Place specials
    for (const spec of specialsToPlace) {
      if (!board[spec.r][spec.c]) {
        const color = spec.special === SPECIAL_COLOR_BOMB ? 0 : spec.color;
        board[spec.r][spec.c] = { color, special: spec.special };
      }
    }
    updateUi();
  }

  function pickDominantColor() {
    const counts = new Array(COLORS.length).fill(0);
    for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) {
      const gem = board[r][c];
      if (gem) counts[gem.color] += 1;
    }
    let best = 0;
    for (let i = 1; i < counts.length; i += 1) if (counts[i] > counts[best]) best = i;
    return best;
  }

  function applyGravityAndRefill() {
    for (let c = 0; c < COLS; c += 1) {
      // Compact non-null cells downward
      let writeR = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r -= 1) {
        if (board[r][c]) {
          if (r !== writeR) {
            board[writeR][c] = board[r][c];
            board[r][c] = null;
          }
          writeR -= 1;
        }
      }
      // Fill the remaining top cells
      for (let r = writeR; r >= 0; r -= 1) {
        board[r][c] = makeGem(randomColor());
      }
    }
  }

  /* ---------- deadlock & hint ---------- */

  function findFirstMove() {
    // Try every adjacent swap, see if it creates a match. Returns [{r,c},{r,c}] or null.
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        if (c + 1 < COLS) {
          swap({ r, c }, { r, c: c + 1 });
          const hasMatch = findMatches().size > 0 || hasSpecial(r, c) || hasSpecial(r, c + 1);
          swap({ r, c }, { r, c: c + 1 });
          if (hasMatch) return [{ r, c }, { r, c: c + 1 }];
        }
        if (r + 1 < ROWS) {
          swap({ r, c }, { r: r + 1, c });
          const hasMatch = findMatches().size > 0 || hasSpecial(r, c) || hasSpecial(r + 1, c);
          swap({ r, c }, { r: r + 1, c });
          if (hasMatch) return [{ r, c }, { r: r + 1, c }];
        }
      }
    }
    return null;
  }

  function hasSpecial(r, c) {
    return Boolean(board[r]?.[c]?.special);
  }

  function shuffleBoard() {
    busy = true;
    wake();
    shuffleBoardSilently();
    busy = false;
  }

  function shuffleBoardSilently() {
    let attempts = 0;
    do {
      const flat = [];
      for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) flat.push(board[r][c]);
      for (let i = flat.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [flat[i], flat[j]] = [flat[j], flat[i]];
      }
      for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) board[r][c] = flat[r * COLS + c];
      attempts += 1;
    } while ((findMatches().size > 0 || !findFirstMove()) && attempts < 20);
    // If shuffle failed to produce a valid board, fall back to full reinit.
    if (findMatches().size > 0 || !findFirstMove()) {
      initBoard();
    }
  }

  function triggerHint() {
    if (!running || busy) return;
    const pair = findFirstMove();
    if (!pair) {
      announce("找不到提示，將自動洗牌");
      shuffleBoard();
      return;
    }
    hintPair = pair;
    hintBlinkUntil = performance.now() + 2400;
    wake();
  }

  /* ---------- stage progression ---------- */

  // Stars reward finishing a stage with moves to spare (skill signal), like most match-3 games.
  function computeStars(movesBudget, movesRemaining) {
    const ratio = movesBudget > 0 ? movesRemaining / movesBudget : 0;
    if (ratio >= 0.5) return 3;
    if (ratio >= 0.2) return 2;
    return 1;
  }

  function starGlyphs(stars) {
    return "★".repeat(stars) + "☆".repeat(3 - stars);
  }

  function checkStageProgress() {
    const cfg = stageConfig(stage);
    const gained = score - stageScoreAtStart;
    if (gained < cfg.goal) return;
    const stars = computeStars(cfg.moves, movesLeft);
    totalStars += stars;
    if (stage >= MAX_STORY_STAGE && !endlessMode) {
      triggerVictory(stars);
      return;
    }
    stage += 1;
    stageScoreAtStart = score;
    const nextCfg = stageConfig(stage);
    movesLeft = nextCfg.moves;
    colorCount = nextCfg.colors;
    announce(`${starGlyphs(stars)} 進入第 ${stage} 關！`);
    updateUi();
  }

  function triggerVictory(lastStageStars) {
    running = false;
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }
    const result = writePortalStats(score, Math.max(best, score), stage, totalStars);
    plays = result.plays;
    best = result.bestScore;
    bestStars = result.bestStars;
    updateUi();
    draw();
    showOverlay(
      "恭喜通關！",
      `${starGlyphs(lastStageStars)} 完成全部 ${MAX_STORY_STAGE} 關，最終分數 ${score}，總星數 ${totalStars}（歷史最佳 ${bestStars}）。可以重新開始，或進入無限模式持續刷分（步數更少、難度更高）。`,
      "重新開始",
      true
    );
  }

  function triggerGameOver() {
    running = false;
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }
    const result = writePortalStats(score, Math.max(best, score), stage, totalStars);
    plays = result.plays;
    best = result.bestScore;
    bestStars = result.bestStars;
    updateUi();
    draw();
    showOverlay(
      "步數用盡",
      `本局停在第 ${stage} 關，得分 ${score}，總星數 ${totalStars}（歷史最佳 ${bestStars}）。按重新開始再挑戰一次！`,
      "重新開始",
      false
    );
  }

  function continueEndless() {
    endlessMode = true;
    stage += 1;
    stageScoreAtStart = score;
    const cfg = stageConfig(stage);
    movesLeft = cfg.moves;
    colorCount = cfg.colors;
    running = true;
    hideOverlay();
    updateUi();
    wake();
  }

  function updateUi() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(Math.max(best, score));
    stageEl.textContent = String(stage);
    playsEl.textContent = String(plays);
    if (movesEl) {
      movesEl.textContent = String(movesLeft);
      movesEl.classList.toggle("is-low", movesLeft <= 5);
    }
    if (starsEl) starsEl.textContent = String(totalStars);
    const cfg = stageConfig(stage);
    const goal = cfg.goal;
    const gained = Math.max(0, score - stageScoreAtStart);
    targetCurrentEl.textContent = String(gained);
    targetGoalEl.textContent = String(goal);
    targetProgressEl.style.width = `${Math.min(100, Math.round((gained / goal) * 100))}%`;
    if (stageHintEl) {
      stageHintEl.textContent = endlessMode
        ? `無限模式第 ${stage - MAX_STORY_STAGE} 階，目標 ${goal} 分，剩餘 ${movesLeft} 步，使用 ${cfg.colors} 色寶石。`
        : `第 ${stage} / ${MAX_STORY_STAGE} 關目標 ${goal} 分，剩餘 ${movesLeft} 步，使用 ${cfg.colors} 色寶石。`;
    }
  }

  /* ---------- particles & popups ---------- */

  function spawnBurst(x, y, color, count) {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 190;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        life: 0,
        maxLife: 0.62 + Math.random() * 0.34,
        size: 2.2 + Math.random() * 3.8,
        trail: 10 + Math.random() * 18,
        twinkle: Math.random() * Math.PI * 2
      });
    }
  }

  function updateParticles(delta) {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.life += delta;
      if (p.life >= p.maxLife) { particles.splice(i, 1); continue; }
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.vy += 220 * delta;
    }
    for (let i = chainPopups.length - 1; i >= 0; i -= 1) {
      const p = chainPopups[i];
      p.life += delta;
      if (p.life >= p.maxLife) chainPopups.splice(i, 1);
    }
  }

  /* ---------- draw ---------- */

  // The board glow/checkerboard/grid never change shape or position, so they're rendered once to
  // an offscreen canvas and blitted every frame instead of rebuilding gradients on every paint
  // (this was a big chunk of the per-frame CPU/GPU cost that made phones run hot).
  function getBackgroundCanvas() {
    if (backgroundCanvas) return backgroundCanvas;
    const w = boardCanvas.width;
    const h = boardCanvas.height;
    backgroundCanvas = document.createElement("canvas");
    backgroundCanvas.width = w;
    backgroundCanvas.height = h;
    const bg = backgroundCanvas.getContext("2d");
    const boardGlow = bg.createRadialGradient(w * 0.28, h * 0.18, 20, w * 0.5, h * 0.45, w * 0.85);
    boardGlow.addColorStop(0, "rgba(47, 215, 255, 0.18)");
    boardGlow.addColorStop(0.45, "rgba(13, 148, 136, 0.11)");
    boardGlow.addColorStop(1, "rgba(6, 18, 24, 0.98)");
    bg.fillStyle = boardGlow;
    bg.fillRect(0, 0, w, h);
    bg.save();
    bg.globalAlpha = 0.62;
    bg.fillStyle = "rgba(255,255,255,0.035)";
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        if ((r + c) % 2 === 0) bg.fillRect(c * CELL + 2, r * CELL + 2, CELL - 4, CELL - 4);
      }
    }
    bg.restore();
    bg.save();
    bg.shadowColor = "rgba(47, 215, 255, 0.55)";
    bg.shadowBlur = 12;
    bg.strokeStyle = "rgba(147, 244, 255, 0.13)";
    bg.lineWidth = 1;
    for (let i = 0; i <= COLS; i += 1) {
      bg.beginPath();
      bg.moveTo(i * CELL, 0);
      bg.lineTo(i * CELL, h);
      bg.stroke();
    }
    for (let i = 0; i <= ROWS; i += 1) {
      bg.beginPath();
      bg.moveTo(0, i * CELL);
      bg.lineTo(w, i * CELL);
      bg.stroke();
    }
    bg.restore();
    return backgroundCanvas;
  }

  function draw() {
    const w = boardCanvas.width;
    const h = boardCanvas.height;
    context.clearRect(0, 0, w, h);
    context.drawImage(getBackgroundCanvas(), 0, 0);
    // Hint highlight
    const blinkPhase = (Math.floor(performance.now() / 200) % 2 === 0);
    const showHint = hintPair && performance.now() < hintBlinkUntil && blinkPhase;
    // Gems
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        const gem = board[r][c];
        if (!gem) continue;
        const x = c * CELL + CELL / 2;
        const y = r * CELL + CELL / 2;
        const isSelected = selected && selected.r === r && selected.c === c;
        const isCursor = cursorVisible && cursor.r === r && cursor.c === c;
        const isHint = showHint && hintPair.some((p) => p.r === r && p.c === c);
        drawGem(x, y, gem, isSelected, isCursor, isHint);
      }
    }
    // Particles
    for (const p of particles) {
      const alpha = 1 - p.life / p.maxLife;
      const liveAlpha = Math.max(0, alpha);
      const trailGradient = context.createLinearGradient(p.x - p.vx * 0.035, p.y - p.vy * 0.035, p.x, p.y);
      trailGradient.addColorStop(0, "rgba(255,255,255,0)");
      trailGradient.addColorStop(0.35, p.color);
      trailGradient.addColorStop(1, "#ffffff");
      context.save();
      context.globalAlpha = liveAlpha * 0.58;
      context.strokeStyle = trailGradient;
      context.lineWidth = Math.max(1, p.size * 0.72);
      context.lineCap = "round";
      context.shadowColor = p.color;
      context.shadowBlur = 13;
      context.beginPath();
      context.moveTo(p.x - p.vx * 0.006 * p.trail, p.y - p.vy * 0.006 * p.trail);
      context.lineTo(p.x, p.y);
      context.stroke();
      context.globalAlpha = liveAlpha;
      context.fillStyle = "#ffffff";
      context.beginPath();
      context.arc(p.x, p.y, p.size * (0.75 + Math.sin(p.life * 16 + p.twinkle) * 0.18), 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
    context.globalAlpha = 1;
    // Chain popups
    for (const popup of chainPopups) {
      const t = popup.life / popup.maxLife;
      const alpha = Math.max(0, 1 - t);
      const y = popup.y - t * 48;
      const scale = 0.82 + Math.sin(Math.min(1, t) * Math.PI) * 0.34 + t * 0.18;
      const gradient = context.createLinearGradient(popup.x - 66, y - 16, popup.x + 66, y + 16);
      gradient.addColorStop(0, "#2fd7ff");
      gradient.addColorStop(0.28, "#8df45f");
      gradient.addColorStop(0.54, "#ffd84d");
      gradient.addColorStop(0.78, "#ff5ebc");
      gradient.addColorStop(1, "#9b6bff");
      context.save();
      context.globalAlpha = alpha;
      context.translate(popup.x, y);
      context.scale(scale, scale);
      context.shadowColor = "rgba(255, 216, 77, 0.9)";
      context.shadowBlur = 18;
      context.lineWidth = 4;
      context.strokeStyle = "rgba(5, 18, 24, 0.72)";
      context.font = "900 23px 'Noto Sans TC', 'Microsoft JhengHei', sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.strokeText(popup.text, 0, 0);
      context.fillStyle = gradient;
      context.fillText(popup.text, 0, 0);
      context.restore();
    }
    context.globalAlpha = 1;
  }

  function drawGem(x, y, gem, selected, cursor, hint) {
    const color = COLORS[gem.color] || COLORS[0];
    const r = CELL * 0.34;
    const now = performance.now();
    const pulse = 0.5 + Math.sin(now / 150) * 0.5;
    const phase = now / 480;
    const shapeId = gem.color % 8;

    function makeGemPath(radius, inset = 0) {
      const rr = radius - inset;
      context.beginPath();
      if (shapeId === 0) {
        context.moveTo(x, y - rr);
        context.lineTo(x + rr * 0.82, y - rr * 0.46);
        context.lineTo(x + rr * 0.82, y + rr * 0.46);
        context.lineTo(x, y + rr);
        context.lineTo(x - rr * 0.82, y + rr * 0.46);
        context.lineTo(x - rr * 0.82, y - rr * 0.46);
      } else if (shapeId === 1) {
        context.moveTo(x, y - rr * 1.05);
        context.lineTo(x + rr * 0.86, y);
        context.lineTo(x, y + rr * 1.05);
        context.lineTo(x - rr * 0.86, y);
      } else if (shapeId === 2) {
        context.moveTo(x - rr * 0.62, y - rr * 0.8);
        context.lineTo(x + rr * 0.62, y - rr * 0.8);
        context.lineTo(x + rr, y);
        context.lineTo(x + rr * 0.62, y + rr * 0.8);
        context.lineTo(x - rr * 0.62, y + rr * 0.8);
        context.lineTo(x - rr, y);
      } else if (shapeId === 3) {
        context.moveTo(x, y - rr * 1.08);
        context.lineTo(x + rr * 0.95, y - rr * 0.18);
        context.lineTo(x + rr * 0.48, y + rr);
        context.lineTo(x - rr * 0.48, y + rr);
        context.lineTo(x - rr * 0.95, y - rr * 0.18);
      } else if (shapeId === 4) {
        context.moveTo(x - rr * 0.5, y - rr);
        context.lineTo(x + rr * 0.5, y - rr);
        context.lineTo(x + rr, y - rr * 0.2);
        context.lineTo(x + rr * 0.72, y + rr * 0.86);
        context.lineTo(x, y + rr * 1.08);
        context.lineTo(x - rr * 0.72, y + rr * 0.86);
        context.lineTo(x - rr, y - rr * 0.2);
      } else if (shapeId === 5) {
        context.moveTo(x, y - rr);
        context.lineTo(x + rr * 0.72, y - rr * 0.72);
        context.lineTo(x + rr, y);
        context.lineTo(x + rr * 0.72, y + rr * 0.72);
        context.lineTo(x, y + rr);
        context.lineTo(x - rr * 0.72, y + rr * 0.72);
        context.lineTo(x - rr, y);
        context.lineTo(x - rr * 0.72, y - rr * 0.72);
      } else if (shapeId === 6) {
        const spikes = 5;
        const outerR = rr * 1.05;
        const innerR = rr * 0.46;
        for (let i = 0; i < spikes * 2; i += 1) {
          const rad = i % 2 === 0 ? outerR : innerR;
          const angle = -Math.PI / 2 + (i * Math.PI) / spikes;
          const px = x + Math.cos(angle) * rad;
          const py = y + Math.sin(angle) * rad;
          if (i === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        }
      } else {
        const w1 = rr * 0.42;
        context.moveTo(x - w1, y - rr);
        context.lineTo(x + w1, y - rr);
        context.lineTo(x + w1, y - w1);
        context.lineTo(x + rr, y - w1);
        context.lineTo(x + rr, y + w1);
        context.lineTo(x + w1, y + w1);
        context.lineTo(x + w1, y + rr);
        context.lineTo(x - w1, y + rr);
        context.lineTo(x - w1, y + w1);
        context.lineTo(x - rr, y + w1);
        context.lineTo(x - rr, y - w1);
        context.lineTo(x - w1, y - w1);
      }
      context.closePath();
    }

    function drawFacets(radius) {
      context.save();
      makeGemPath(radius, 1);
      context.clip();
      context.strokeStyle = "rgba(255,255,255,0.42)";
      context.lineWidth = 1.4;
      context.beginPath();
      context.moveTo(x, y - radius * 0.92);
      context.lineTo(x, y + radius * 0.92);
      context.moveTo(x - radius * 0.78, y - radius * 0.18);
      context.lineTo(x + radius * 0.78, y - radius * 0.18);
      context.moveTo(x - radius * 0.58, y + radius * 0.54);
      context.lineTo(x + radius * 0.58, y + radius * 0.54);
      if (shapeId % 2 === 0) {
        context.moveTo(x - radius * 0.7, y - radius * 0.58);
        context.lineTo(x + radius * 0.66, y + radius * 0.66);
      } else {
        context.moveTo(x + radius * 0.7, y - radius * 0.58);
        context.lineTo(x - radius * 0.66, y + radius * 0.66);
      }
      context.stroke();
      context.restore();
    }

    context.save();
    if (selected || hint || cursor) {
      const ringRadius = r + 7 + pulse * 5;
      context.strokeStyle = selected
        ? `rgba(255,255,255,${0.58 + pulse * 0.32})`
        : `rgba(47,215,255,${0.46 + pulse * 0.28})`;
      context.lineWidth = selected ? 3.2 : 2.2;
      context.shadowColor = selected ? "rgba(255,255,255,0.9)" : "rgba(47,215,255,0.85)";
      context.shadowBlur = 16 + pulse * 12;
      context.beginPath();
      context.arc(x, y, ringRadius, 0, Math.PI * 2);
      context.stroke();
    }

    if (gem.special === SPECIAL_COLOR_BOMB) {
      context.translate(x, y);
      context.rotate(phase * 0.9);
      const rainbow = ["#2fd7ff", "#8df45f", "#ffd84d", "#ff9a3d", "#ff5ebc", "#9b6bff"];
      for (let i = 0; i < 12; i += 1) {
        context.rotate(Math.PI / 6);
        context.fillStyle = rainbow[i % rainbow.length];
        context.shadowColor = rainbow[i % rainbow.length];
        context.shadowBlur = 16;
        context.beginPath();
        context.moveTo(0, -r * 1.35);
        context.lineTo(r * 0.16, -r * 0.35);
        context.lineTo(0, -r * 0.08);
        context.lineTo(-r * 0.16, -r * 0.35);
        context.closePath();
        context.fill();
      }
      const bombGlow = context.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
      bombGlow.addColorStop(0, "#ffffff");
      bombGlow.addColorStop(0.42, "#fff8bd");
      bombGlow.addColorStop(1, "rgba(47,215,255,0.76)");
      context.shadowColor = "#ffffff";
      context.shadowBlur = 18;
      context.fillStyle = bombGlow;
      context.beginPath();
      context.arc(0, 0, r * 0.72, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "rgba(255,255,255,0.82)";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(0, 0, r * 0.43, 0, Math.PI * 2);
      context.stroke();
      context.restore();
      return;
    }

    context.shadowColor = color.glow;
    context.shadowBlur = 16;
    makeGemPath(r);
    const fill = context.createLinearGradient(x - r, y - r, x + r, y + r);
    fill.addColorStop(0, "#ffffff");
    fill.addColorStop(0.16, color.fill);
    fill.addColorStop(0.58, color.fill);
    fill.addColorStop(1, "rgba(5,18,24,0.72)");
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = "rgba(255,255,255,0.5)";
    context.lineWidth = 1.6;
    context.stroke();
    drawFacets(r);

    context.save();
    makeGemPath(r, 2);
    context.clip();
    context.fillStyle = "rgba(255,255,255,0.68)";
    context.beginPath();
    context.ellipse(x - r * 0.28, y - r * 0.34, r * 0.28, r * 0.12, -0.6, 0, Math.PI * 2);
    context.fill();
    context.restore();

    context.strokeStyle = "rgba(5,18,24,0.58)";
    context.lineWidth = 2;
    if (shapeId === 0) {
      context.beginPath();
      context.arc(x, y, r * 0.32, 0, Math.PI * 2);
      context.stroke();
    } else if (shapeId === 1) {
      context.beginPath();
      context.moveTo(x, y - r * 0.5);
      context.lineTo(x + r * 0.42, y);
      context.lineTo(x, y + r * 0.5);
      context.lineTo(x - r * 0.42, y);
      context.closePath();
      context.stroke();
    } else if (shapeId === 2) {
      context.beginPath();
      context.moveTo(x - r * 0.44, y);
      context.lineTo(x + r * 0.44, y);
      context.moveTo(x, y - r * 0.44);
      context.lineTo(x, y + r * 0.44);
      context.stroke();
    } else if (shapeId === 3) {
      context.beginPath();
      context.moveTo(x, y - r * 0.56);
      context.lineTo(x + r * 0.48, y + r * 0.38);
      context.lineTo(x - r * 0.48, y + r * 0.38);
      context.closePath();
      context.stroke();
    } else if (shapeId === 4) {
      context.beginPath();
      context.arc(x, y, r * 0.42, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.arc(x, y, r * 0.16, 0, Math.PI * 2);
      context.fillStyle = "rgba(5,18,24,0.5)";
      context.fill();
    } else if (shapeId === 5) {
      context.beginPath();
      context.moveTo(x - r * 0.42, y - r * 0.42);
      context.lineTo(x + r * 0.42, y + r * 0.42);
      context.moveTo(x + r * 0.42, y - r * 0.42);
      context.lineTo(x - r * 0.42, y + r * 0.42);
      context.stroke();
    } else if (shapeId === 6) {
      context.beginPath();
      for (let i = 0; i < 5; i += 1) {
        const angle = -Math.PI / 2 + (i * Math.PI * 2) / 5;
        context.moveTo(x, y);
        context.lineTo(x + Math.cos(angle) * r * 0.46, y + Math.sin(angle) * r * 0.46);
      }
      context.stroke();
    } else {
      context.strokeRect(x - r * 0.3, y - r * 0.3, r * 0.6, r * 0.6);
    }

    if (gem.special === SPECIAL_WRAPPED) {
      context.save();
      context.translate(x, y);
      context.rotate(phase * 0.4);
      context.strokeStyle = "rgba(255,255,255,0.85)";
      context.lineWidth = 1.6;
      context.shadowColor = "#ffffff";
      context.shadowBlur = 10;
      const nr = r * 0.98;
      context.beginPath();
      context.moveTo(-nr, -nr * 0.4);
      context.lineTo(nr, nr * 0.4);
      context.moveTo(-nr, nr * 0.4);
      context.lineTo(nr, -nr * 0.4);
      context.moveTo(-nr * 0.4, -nr);
      context.lineTo(nr * 0.4, nr);
      context.moveTo(nr * 0.4, -nr);
      context.lineTo(-nr * 0.4, nr);
      context.stroke();
      context.restore();
    } else if (gem.special === SPECIAL_LINE_H || gem.special === SPECIAL_LINE_V) {
      const horizontal = gem.special === SPECIAL_LINE_H;
      context.save();
      context.translate(x, y);
      if (!horizontal) context.rotate(Math.PI / 2);
      context.shadowColor = "#ffffff";
      context.shadowBlur = 10;
      context.fillStyle = "rgba(255,255,255,0.86)";
      for (let i = -1; i <= 1; i += 1) {
        context.beginPath();
        context.moveTo(-r * 0.66 + i * r * 0.32, -r * 0.26);
        context.lineTo(-r * 0.32 + i * r * 0.32, 0);
        context.lineTo(-r * 0.66 + i * r * 0.32, r * 0.26);
        context.lineTo(-r * 0.5 + i * r * 0.32, 0);
        context.closePath();
        context.fill();
      }
      context.fillStyle = "rgba(5,18,24,0.42)";
      context.fillRect(-r * 0.62, -2, r * 1.24, 4);
      context.restore();
    }
    context.restore();
    if (cursor) {
      context.strokeStyle = "rgba(255,255,255,0.7)";
      context.lineWidth = 2;
      context.setLineDash([4, 4]);
      context.strokeRect(x - CELL / 2 + 2, y - CELL / 2 + 2, CELL - 4, CELL - 4);
      context.setLineDash([]);
    }
  }

  /* ---------- main loop ---------- */

  // Only the rainbow bomb and wrapped gem spin/rotate per frame; line specials render statically,
  // so their presence alone shouldn't keep the loop spinning.
  function boardHasSpinningSpecial() {
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        const special = board[r]?.[c]?.special;
        if (special === SPECIAL_COLOR_BOMB || special === SPECIAL_WRAPPED) return true;
      }
    }
    return false;
  }

  // Whether the next frame still needs to change anything. When the board is fully idle
  // (nothing selected/hinted/animating and no bomb/wrapped gem mid-rotation), we stop scheduling
  // frames entirely instead of redrawing 60x/sec — this is what was keeping phones warm while
  // the player was just looking at a static board deciding on a move.
  function needsContinuousRender() {
    return (
      busy ||
      particles.length > 0 ||
      chainPopups.length > 0 ||
      Boolean(pointer) ||
      selected !== null ||
      cursorVisible ||
      (hintPair !== null && performance.now() < hintBlinkUntil) ||
      boardHasSpinningSpecial()
    );
  }

  function loop(time) {
    if (!running) return;
    const delta = Math.min(0.05, (time - lastTime) / 1000 || 0);
    lastTime = time;
    updateParticles(delta);
    draw();
    animationFrameId = needsContinuousRender() ? requestAnimationFrame(loop) : 0;
  }

  // Resumes the render loop (and forces one fresh frame) after user input, if it had idled out.
  function wake() {
    if (!running || animationFrameId) return;
    lastTime = performance.now();
    animationFrameId = requestAnimationFrame(loop);
  }

  function startGame() {
    if (running) return;
    running = true;
    score = 0;
    stage = 1;
    stageScoreAtStart = 0;
    endlessMode = false;
    totalStars = 0;
    const cfg = stageConfig(1);
    movesLeft = cfg.moves;
    colorCount = cfg.colors;
    selected = null;
    hintPair = null;
    initBoard();
    updateUi();
    hideOverlay();
    wake();
  }

  function restartGame() {
    // End current run (count as a play and write stats), then start fresh.
    if (running) {
      const result = writePortalStats(score, Math.max(best, score), stage, totalStars);
      plays = result.plays;
      best = result.bestScore;
      bestStars = result.bestStars;
    }
    running = false;
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }
    score = 0;
    stage = 1;
    stageScoreAtStart = 0;
    endlessMode = false;
    totalStars = 0;
    const cfg = stageConfig(1);
    movesLeft = cfg.moves;
    colorCount = cfg.colors;
    selected = null;
    hintPair = null;
    initBoard();
    updateUi();
    draw();
    showOverlay("已重新開始", "按開始遊戲挑戰新的一局。", "開始遊戲", false);
  }

  /* ---------- overlay / instructions ---------- */

  function showOverlay(title, message, buttonText, showSecondary) {
    if (!overlay) return;
    overlayTitle.textContent = title;
    overlayMessage.textContent = message;
    const button = overlay.querySelector("[data-action='overlay-start']");
    if (button) button.textContent = buttonText;
    if (overlaySecondary) overlaySecondary.hidden = !showSecondary;
    overlay.hidden = false;
  }

  function hideOverlay() {
    if (overlay) overlay.hidden = true;
  }

  function announce(text) {
    chainPopups.push({
      x: boardCanvas.width / 2,
      y: 40,
      text,
      life: 0,
      maxLife: 1.4
    });
  }

  function flashInvalid(a, b) {
    spawnBurst(a.c * CELL + CELL / 2, a.r * CELL + CELL / 2, "#ff5ebc", 6);
    spawnBurst(b.c * CELL + CELL / 2, b.r * CELL + CELL / 2, "#ff5ebc", 6);
    draw();
  }

  /* ---------- input: pointer ---------- */

  function getCellFromPointer(event) {
    const rect = boardCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const cx = x / rect.width * boardCanvas.width;
    const cy = y / rect.height * boardCanvas.height;
    const c = Math.floor(cx / CELL);
    const r = Math.floor(cy / CELL);
    if (!inBounds(r, c)) return null;
    return { r, c, x: cx, y: cy };
  }

  boardCanvas.addEventListener("pointerdown", (event) => {
    if (!running || busy) return;
    const cell = getCellFromPointer(event);
    if (!cell) return;
    event.preventDefault();
    pointer = {
      startR: cell.r,
      startC: cell.c,
      startX: cell.x,
      startY: cell.y,
      pointerId: event.pointerId,
      moved: false
    };
    try { boardCanvas.setPointerCapture?.(event.pointerId); } catch {}
    wake();
  }, { passive: false });

  boardCanvas.addEventListener("pointermove", (event) => {
    if (!pointer || event.pointerId !== pointer.pointerId) return;
    if (!running || busy) {
      pointer = null;
      return;
    }
    const rect = boardCanvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * boardCanvas.width;
    const y = (event.clientY - rect.top) / rect.height * boardCanvas.height;
    const dx = x - pointer.startX;
    const dy = y - pointer.startY;
    const threshold = CELL * 0.4;
    if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
    pointer.moved = true;
    let target;
    if (Math.abs(dx) > Math.abs(dy)) {
      target = { r: pointer.startR, c: pointer.startC + (dx > 0 ? 1 : -1) };
    } else {
      target = { r: pointer.startR + (dy > 0 ? 1 : -1), c: pointer.startC };
    }
    const start = { r: pointer.startR, c: pointer.startC };
    pointer = null;
    selected = null;
    trySwap(start, target);
  }, { passive: false });

  boardCanvas.addEventListener("pointerup", (event) => {
    if (!pointer || event.pointerId !== pointer.pointerId) return;
    if (!running || busy) {
      pointer = null;
      return;
    }
    // Tap: select or attempt swap with previously selected.
    const tapped = { r: pointer.startR, c: pointer.startC };
    pointer = null;
    if (!selected) {
      selected = tapped;
    } else if (selected.r === tapped.r && selected.c === tapped.c) {
      selected = null;
    } else if (isAdjacent(selected, tapped)) {
      const from = selected;
      selected = null;
      trySwap(from, tapped);
    } else {
      selected = tapped;
    }
    wake();
  });

  boardCanvas.addEventListener("pointercancel", () => {
    pointer = null;
  });

  /* ---------- input: keyboard ---------- */

  document.addEventListener("keydown", (event) => {
    if (event.target?.tagName === "INPUT" || event.target?.tagName === "TEXTAREA") return;
    const key = event.key;
    if (!running) {
      if (key === " " || key === "Enter") {
        event.preventDefault();
        startGame();
      }
      return;
    }
    if (busy) return;
    let handled = true;
    if (key === "ArrowUp") cursor = { r: Math.max(0, cursor.r - 1), c: cursor.c };
    else if (key === "ArrowDown") cursor = { r: Math.min(ROWS - 1, cursor.r + 1), c: cursor.c };
    else if (key === "ArrowLeft") cursor = { r: cursor.r, c: Math.max(0, cursor.c - 1) };
    else if (key === "ArrowRight") cursor = { r: cursor.r, c: Math.min(COLS - 1, cursor.c + 1) };
    else if (key === " " || key === "Enter") {
      if (!selected) selected = { ...cursor };
      else if (isAdjacent(selected, cursor)) {
        const from = selected;
        selected = null;
        trySwap(from, cursor);
      } else {
        selected = { ...cursor };
      }
    } else if (key.toLowerCase() === "h") triggerHint();
    else if (key.toLowerCase() === "s") shuffleBoard();
    else handled = false;
    if (handled) {
      event.preventDefault();
      cursorVisible = true;
      wake();
    }
  });

  /* ---------- input: buttons ---------- */

  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "start" || action === "overlay-start") startGame();
      else if (action === "restart") restartGame();
      else if (action === "overlay-secondary") continueEndless();
      else if (action === "hint") triggerHint();
      else if (action === "shuffle") shuffleBoard();
      else if (action === "instructions") {
        if (instructionModal) instructionModal.hidden = false;
      }
    });
  });

  document.querySelectorAll("[data-instruction-close]").forEach((button) => {
    button.addEventListener("click", () => { if (instructionModal) instructionModal.hidden = true; });
  });
  document.querySelectorAll("[data-instruction-start]").forEach((button) => {
    button.addEventListener("click", () => {
      if (instructionModal) instructionModal.hidden = true;
      startGame();
    });
  });

  /* ---------- cleanup ---------- */

  window.addEventListener("pagehide", () => {
    if (running) {
      writePortalStats(score, Math.max(best, score), stage, totalStars);
    }
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }
  });
})();

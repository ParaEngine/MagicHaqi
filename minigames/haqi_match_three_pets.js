(function () {
	const BOARD_SIZE = 8;
	const TYPE_COUNT = 6;
	const MAX_MOVES = 28;
	const TARGET_SCORE = 900;
	const FALLBACK_PETS = [
		{ name: '星星', emoji: '⭐' },
		{ name: '花花', emoji: '🌸' },
		{ name: '太阳', emoji: '☀️' },
		{ name: '月亮', emoji: '🌙' },
		{ name: '彩虹', emoji: '🌈' },
		{ name: '水晶', emoji: '💎' },
	];
	const JELLY_COLORS = [
		{ from: '#ff8aa1', to: '#f43f5e', shine: 'rgba(255,255,255,.72)' },
		{ from: '#6dd6ff', to: '#0284c7', shine: 'rgba(255,255,255,.7)' },
		{ from: '#86efac', to: '#16a34a', shine: 'rgba(255,255,255,.68)' },
		{ from: '#fde68a', to: '#f59e0b', shine: 'rgba(255,255,255,.76)' },
		{ from: '#d8b4fe', to: '#9333ea', shine: 'rgba(255,255,255,.7)' },
		{ from: '#f9a8d4', to: '#db2777', shine: 'rgba(255,255,255,.68)' },
	];

	const state = {
		board: [],
		pets: [],
		selected: null,
		moves: MAX_MOVES,
		score: 0,
		combo: 0,
		locked: true,
		started: false,
		finished: false,
		drag: null,
		objectUrls: [],
	};

	const root = document.createElement('div');
	root.id = 'haqiMatchThreePets';
	root.innerHTML = `
		<style>
			* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
			html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
			body {
				font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
				color: #16324f;
				background: linear-gradient(180deg, #dff7ff 0%, #fef3c7 52%, #dcfce7 100%);
				touch-action: none;
				user-select: none;
			}
			.mh-shell { height: 100vh; display: grid; grid-template-rows: auto 1fr auto; gap: 10px; padding: 10px; }
			.mh-top {
				min-height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 10px;
				padding: 9px 11px; border-radius: 14px; border: 2px solid rgba(255,255,255,.86);
				background: rgba(255,255,255,.88); box-shadow: 0 5px 0 rgba(14,116,144,.14);
			}
			.mh-title { font-size: 18px; font-weight: 900; white-space: nowrap; }
			.mh-stats { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
			.mh-pill {
				height: 30px; min-width: 58px; display: inline-flex; align-items: center; justify-content: center; gap: 3px;
				padding: 0 8px; border-radius: 999px; background: #fff; border: 1px solid rgba(14,116,144,.2);
				color: #0f766e; font-size: 12px; font-weight: 900; box-shadow: 0 2px 0 rgba(14,116,144,.12);
			}
			.mh-help, .mh-restart, .mh-start {
				border: 0; border-radius: 999px; padding: 9px 14px; background: #f97316; color: white;
				font-weight: 900; box-shadow: 0 4px 0 #9a3412; cursor: pointer;
			}
			.mh-stage { min-height: 0; display: grid; place-items: center; }
			.mh-board-wrap {
				width: min(86vmin, 520px); max-width: calc(100vw - 20px); aspect-ratio: 1;
				padding: 7px; border-radius: 18px; background: linear-gradient(180deg, #7dd3fc, #34d399);
				border: 3px solid rgba(255,255,255,.9); box-shadow: 0 12px 28px rgba(15,23,42,.2);
			}
			.mh-board { width: 100%; height: 100%; display: grid; grid-template-columns: repeat(8, 1fr); gap: 5px; }
			.mh-cell {
				position: relative; border: 0; border-radius: 12px; overflow: hidden; cursor: pointer;
				background: transparent;
				box-shadow: none;
				transition: transform .15s ease, filter .15s ease, opacity .15s ease;
			}
			.mh-cell:disabled { cursor: default; }
			.mh-cell.selected { outline: 4px solid #f97316; transform: translateY(-2px) scale(1.04); z-index: 2; }
			.mh-cell.dragging { z-index: 8; cursor: grabbing; filter: brightness(1.08) saturate(1.08); transition: none; }
			.mh-cell.swap-target { z-index: 6; outline: 4px solid rgba(56,189,248,.82); filter: brightness(1.12); transition: none; }
			.mh-cell.swapping { z-index: 7; transition: transform .18s ease; }
			.mh-cell.hint { animation: mhHint .9s ease-in-out infinite; }
			.mh-cell.matching { animation: mhPop .35s ease-out forwards; }
			.mh-cell.matching::after {
				content: ''; position: absolute; inset: 10%; border-radius: 999px; pointer-events: none;
				background: radial-gradient(circle, rgba(255,255,255,.94) 0%, rgba(250,204,21,.72) 35%, rgba(250,204,21,0) 70%);
				animation: mhBurst .35s ease-out forwards;
			}
			.mh-cell.drop { animation: mhDrop .22s ease-out; }
			.mh-cell.invalid { animation: mhInvalid .28s ease-in-out; }
			.mh-token {
				position: absolute; inset: 0; display: grid; place-items: center; border-radius: 16px; overflow: hidden;
				background: linear-gradient(145deg, var(--jelly-from), var(--jelly-to));
				box-shadow: inset 0 3px 9px rgba(255,255,255,.42), inset 0 -6px 11px rgba(15,23,42,.22), 0 4px 8px rgba(15,23,42,.18);
			}
			.mh-token::before {
				content: ''; position: absolute; left: 14%; top: 10%; width: 42%; height: 28%; border-radius: 999px;
				background: radial-gradient(circle at 30% 35%, #fff 0%, var(--jelly-shine) 42%, rgba(255,255,255,0) 72%);
				transform: rotate(-22deg); pointer-events: none; z-index: 1;
			}
			.mh-cell.dragging .mh-token { transform: scale(1.08); }
			.mh-emoji {
				position: absolute; left: 50%; top: 50%; z-index: 2; transform: translate(-50%, -50%);
				font-size: clamp(28px, 8vmin, 54px); line-height: 1; filter: drop-shadow(0 2px 1px rgba(15,23,42,.18));
			}
			.mh-sprite {
				position: absolute; left: 50%; top: 50%; z-index: 2; width: 92%; height: 92%; transform: translate(-50%, -50%);
				background-repeat: no-repeat; filter: drop-shadow(0 4px 2px rgba(15,23,42,.2));
			}
			.mh-bottom {
				display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 44px; font-weight: 900; color: #0f766e;
			}
			.mh-restart { background: #0ea5e9; box-shadow-color: #1e3a8a; }
			.mh-tip { max-width: min(92vw, 500px); text-align: center; font-size: 13px; line-height: 1.35; color: #0f766e; }
			.mh-toast {
				position: fixed; left: 50%; top: 50%; z-index: 25; transform: translate(-50%, -50%);
				padding: 18px 22px; border-radius: 16px; background: white; border: 3px solid #7dd3fc;
				box-shadow: 0 18px 42px rgba(15,23,42,.24); color: #0f766e; font-size: 22px; font-weight: 900;
				animation: mhToast 1.35s ease-out forwards; pointer-events: none; text-align: center;
			}
			.mh-score-float {
				position: fixed; z-index: 24; transform: translate(-50%, -50%); pointer-events: none;
				color: #f97316; font-size: 22px; font-weight: 1000; text-shadow: 0 2px 0 #fff, 0 5px 14px rgba(15,23,42,.28);
				animation: mhScoreFloat .95s ease-out forwards;
			}
			.mh-particle {
				position: fixed; z-index: 23; width: 9px; height: 9px; border-radius: 999px; pointer-events: none;
				background: var(--mh-particle-color, #facc15); box-shadow: 0 0 10px currentColor;
				animation: mhParticle .62s ease-out forwards;
			}
			.mh-combo-banner {
				position: fixed; left: 50%; top: 17%; z-index: 26; transform: translate(-50%, -50%);
				padding: 8px 16px; border-radius: 999px; background: linear-gradient(90deg, #f97316, #ec4899);
				color: #fff; font-weight: 1000; font-size: 20px; box-shadow: 0 10px 24px rgba(236,72,153,.28);
				animation: mhComboBanner .95s ease-out forwards; pointer-events: none;
			}
			.mh-board-wrap.combo { animation: mhBoardGlow .5s ease-out; }
			.mh-confetti {
				position: fixed; top: -14px; z-index: 28; width: 9px; height: 15px; border-radius: 3px;
				background: var(--mh-confetti-color, #facc15); pointer-events: none;
				animation: mhConfetti var(--mh-confetti-duration, 1.6s) ease-in forwards;
			}
			.mh-overlay {
				position: fixed; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center; padding: 18px;
				background: rgba(15,39,71,.44);
			}
			.mh-card {
				width: min(92vw, 390px); padding: 20px; border-radius: 18px; background: #fff;
				border: 3px solid #7dd3fc; box-shadow: 0 18px 44px rgba(15,23,42,.28); text-align: center;
			}
			.mh-card h1 { margin: 0 0 10px; color: #16324f; font-size: 24px; font-weight: 900; }
			.mh-card p { margin: 0 0 16px; color: #0f766e; font-size: 15px; font-weight: 800; line-height: 1.55; }
			.mh-pet-preview { display: flex; justify-content: center; gap: 7px; margin: 12px 0 16px; }
			.mh-preview-token { position: relative; width: 42px; height: 42px; border-radius: 14px; background: transparent; display: grid; place-items: center; overflow: hidden; }
			.mh-preview-token .mh-token { inset: 0; }
			.mh-preview-token .mh-sprite { width: 92%; height: 92%; }
			[hidden] { display: none !important; }
			@keyframes mhPop { 0% { transform: scale(1); opacity: 1; } 70% { transform: scale(1.18); opacity: .75; } 100% { transform: scale(.1); opacity: 0; } }
			@keyframes mhBurst { 0% { transform: scale(.3); opacity: .9; } 100% { transform: scale(1.9); opacity: 0; } }
			@keyframes mhDrop { 0% { transform: translateY(-18px); } 100% { transform: translateY(0); } }
			@keyframes mhInvalid { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }
			@keyframes mhHint { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.22); } }
			@keyframes mhToast { 0% { opacity: 0; transform: translate(-50%, -42%) scale(.82); } 18% { opacity: 1; transform: translate(-50%, -50%) scale(1); } 100% { opacity: 0; transform: translate(-50%, -72%) scale(.96); } }
			@keyframes mhScoreFloat { 0% { opacity: 0; transform: translate(-50%, -30%) scale(.75); } 20% { opacity: 1; transform: translate(-50%, -50%) scale(1.15); } 100% { opacity: 0; transform: translate(-50%, -135%) scale(1); } }
			@keyframes mhParticle { 0% { opacity: 1; transform: translate(-50%, -50%) scale(.8); } 100% { opacity: 0; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(.1); } }
			@keyframes mhComboBanner { 0% { opacity: 0; transform: translate(-50%, -30%) scale(.65); } 18% { opacity: 1; transform: translate(-50%, -50%) scale(1.08); } 100% { opacity: 0; transform: translate(-50%, -96%) scale(.96); } }
			@keyframes mhBoardGlow { 0% { filter: brightness(1); } 45% { filter: brightness(1.22) saturate(1.18); } 100% { filter: brightness(1); } }
			@keyframes mhConfetti { 0% { opacity: 1; transform: translate3d(0, 0, 0) rotate(0deg); } 100% { opacity: 0; transform: translate3d(var(--dx), 112vh, 0) rotate(680deg); } }
			@media (max-width: 430px) {
				.mh-shell { gap: 7px; padding: 8px; }
				.mh-top { align-items: flex-start; flex-direction: column; }
				.mh-stats { width: 100%; justify-content: space-between; }
				.mh-board { gap: 4px; }
				.mh-cell { border-radius: 10px; }
			}
			@media (max-height: 610px) {
				.mh-shell { grid-template-rows: auto 1fr; }
				.mh-bottom { display: none; }
				.mh-board-wrap { width: min(78vmin, 500px); }
			}
		</style>
		<div class="mh-shell">
			<div class="mh-top">
				<div class="mh-title">🐾 宠物三消</div>
				<div class="mh-stats">
					<span class="mh-pill">步数 <b id="mhMoves">${MAX_MOVES}</b></span>
					<span class="mh-pill">分数 <b id="mhScore">0</b></span>
					<span class="mh-pill">目标 <b>${TARGET_SCORE}</b></span>
					<button class="mh-help" id="mhHelp" type="button">玩法</button>
				</div>
			</div>
			<main class="mh-stage">
				<div class="mh-board-wrap"><div id="mhBoard" class="mh-board" aria-label="宠物三消棋盘"></div></div>
			</main>
			<div class="mh-bottom"><span class="mh-tip" id="mhTip">交换相邻宠物，连成 3 个以上就能消除。</span><button class="mh-restart" id="mhRestart" type="button">重新开始</button></div>
		</div>
		<div class="mh-overlay" id="mhHowTo" role="dialog" aria-modal="true" aria-labelledby="mhHowToTitle" hidden>
			<div class="mh-card">
				<h1 id="mhHowToTitle">宠物三消</h1>
				<p>交换相邻格子，让 3 个或更多相同宠物排成一行或一列。用尽步数前达到目标分数即可完成玩耍。</p>
				<div class="mh-pet-preview" id="mhPetPreview"></div>
				<button class="mh-start" id="mhStart" type="button">开始玩</button>
			</div>
		</div>
	`;

	function boot() {
		document.body.appendChild(root);
		bindEvents();
		loadPetAssets().then((pets) => {
			state.pets = pets;
			renderPreview();
			showHowTo();
			post('gameLoaded');
		});
	}

	function bindEvents() {
		byId('mhHelp').onclick = showHowTo;
		byId('mhStart').onclick = () => {
			byId('mhHowTo').hidden = true;
			if (!state.started || state.finished) startGame();
		};
		byId('mhRestart').onclick = startGame;
		window.addEventListener('message', (event) => {
			if (event.data?.type === 'gameContinue') startGame();
		});
		window.addEventListener('beforeunload', cleanupObjectUrls);
	}

	async function loadPetAssets() {
		const requestId = `match_three_pets_${Date.now()}`;
		const parentPets = await requestPetImages(requestId);
		const assets = [];
		for (const pet of parentPets.slice(0, TYPE_COUNT)) {
			const asset = petAssetFromPayload(pet, assets.length);
			if (asset) assets.push(asset);
		}
		for (const fallback of FALLBACK_PETS) {
			if (assets.length >= TYPE_COUNT) break;
			assets.push({ kind: 'emoji', name: fallback.name, emoji: fallback.emoji, jelly: JELLY_COLORS[assets.length % JELLY_COLORS.length] });
		}
		return assets.slice(0, TYPE_COUNT);
	}

	function requestPetImages(requestId) {
		return new Promise((resolve) => {
			let settled = false;
			const timer = setTimeout(() => finish([]), 1200);
			function finish(pets) {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				window.removeEventListener('message', onMessage);
				resolve(Array.isArray(pets) ? pets : []);
			}
			function onMessage(event) {
				const msg = event.data || {};
				if (msg.type !== 'haqi_pet_images' || msg.requestId !== requestId) return;
				finish(msg.ok ? msg.data?.pets : []);
			}
			window.addEventListener('message', onMessage);
			post('haqi_get_pet_images', { requestId, anim: 'happy' }, { requestId, anim: 'happy' });
		});
	}

	function petAssetFromPayload(pet, index) {
		if (!pet?.imageBlob || !pet?.uv) return null;
		const url = URL.createObjectURL(pet.imageBlob);
		state.objectUrls.push(url);
		return {
			kind: 'pet',
			name: pet.name || '宠物',
			url,
			uv: pet.uv,
			imageWidth: pet.imageWidth || 0,
			imageHeight: pet.imageHeight || 0,
			jelly: JELLY_COLORS[index % JELLY_COLORS.length],
		};
	}

	function startGame() {
		state.started = true;
		state.finished = false;
		state.locked = false;
		state.selected = null;
		state.moves = MAX_MOVES;
		state.score = 0;
		state.combo = 0;
		state.board = createBoard();
		post('gameStarted');
		updateStats();
		renderBoard();
		setTip('交换相邻宠物，连成 3 个以上就能消除。');
	}

	function createBoard() {
		const board = [];
		for (let row = 0; row < BOARD_SIZE; row++) {
			board[row] = [];
			for (let col = 0; col < BOARD_SIZE; col++) {
				let type = randomType();
				let guard = 0;
				while (wouldCreateMatch(board, row, col, type) && guard < 20) {
					type = randomType();
					guard++;
				}
				board[row][col] = type;
			}
		}
		return board;
	}

	function wouldCreateMatch(board, row, col, type) {
		const left = col >= 2 && board[row][col - 1] === type && board[row][col - 2] === type;
		const up = row >= 2 && board[row - 1][col] === type && board[row - 2][col] === type;
		return left || up;
	}

	function renderPreview() {
		const preview = byId('mhPetPreview');
		preview.innerHTML = '';
		state.pets.forEach((asset) => {
			const node = document.createElement('div');
			node.className = 'mh-preview-token';
			node.appendChild(createToken(asset));
			preview.appendChild(node);
		});
	}

	function renderBoard(changed = new Set()) {
		const boardEl = byId('mhBoard');
		boardEl.innerHTML = '';
		for (let row = 0; row < BOARD_SIZE; row++) {
			for (let col = 0; col < BOARD_SIZE; col++) {
				const cell = document.createElement('button');
				cell.type = 'button';
				cell.className = 'mh-cell';
				cell.disabled = state.locked || state.finished;
				cell.dataset.row = row;
				cell.dataset.col = col;
				if (state.selected && state.selected.row === row && state.selected.col === col) cell.classList.add('selected');
				if (changed.has(key(row, col))) cell.classList.add('drop');
				cell.setAttribute('aria-label', `${state.pets[state.board[row][col]]?.name || '宠物'} ${row + 1}-${col + 1}`);
				cell.appendChild(createToken(state.pets[state.board[row][col]]));
				cell.addEventListener('pointerdown', (event) => handlePointerDown(event, row, col));
				boardEl.appendChild(cell);
			}
		}
	}

	function handlePointerDown(event, row, col) {
		if (state.locked || state.finished) return;
		event.preventDefault();
		const cell = event.currentTarget;
		cell.setPointerCapture?.(event.pointerId);
		cell.classList.add('dragging');
		state.drag = {
			row,
			col,
			startX: event.clientX,
			startY: event.clientY,
			pointerId: event.pointerId,
			cell,
			target: null,
			targetCell: null,
			didMove: false,
			dx: 0,
			dy: 0,
		};
		window.addEventListener('pointermove', handlePointerMove, { passive: false });
		window.addEventListener('pointerup', handlePointerUp, { passive: false });
		window.addEventListener('pointercancel', handlePointerCancel, { passive: false });
	}

	function handlePointerMove(event) {
		if (!state.drag || event.pointerId !== state.drag.pointerId) return;
		event.preventDefault();
		const rawDx = event.clientX - state.drag.startX;
		const rawDy = event.clientY - state.drag.startY;
		const cellStep = getCellStep();
		const distance = Math.sqrt(rawDx * rawDx + rawDy * rawDy);
		state.drag.didMove = distance > 6;

		let dx = rawDx;
		let dy = rawDy;
		let target = null;
		if (Math.abs(rawDx) > Math.abs(rawDy)) {
			dy = 0;
			dx = clamp(rawDx, -cellStep, cellStep);
			if (Math.abs(dx) > cellStep * 0.28) target = { row: state.drag.row, col: state.drag.col + (dx > 0 ? 1 : -1) };
		} else {
			dx = 0;
			dy = clamp(rawDy, -cellStep, cellStep);
			if (Math.abs(dy) > cellStep * 0.28) target = { row: state.drag.row + (dy > 0 ? 1 : -1), col: state.drag.col };
		}

		state.drag.dx = dx;
		state.drag.dy = dy;
		state.drag.cell.style.transform = `translate(${dx}px, ${dy}px) scale(1.06)`;
		setDragTarget(target && isInsideBoard(target.row, target.col) ? target : null);
		updateDragTargetTransform();
	}

	function handlePointerUp(event) {
		if (!state.drag || event.pointerId !== state.drag.pointerId) return;
		event.preventDefault();
		const drag = state.drag;
		const target = drag.target;
		cleanupPointerDrag(false, Boolean(target));
		if (target) {
			swapAndResolve({ row: drag.row, col: drag.col }, target, { dragged: true, dragOffset: { dx: drag.dx, dy: drag.dy } });
			return;
		}
		animateDragBack(drag.cell);
		if (!drag.didMove) selectCell(drag.row, drag.col);
	}

	function handlePointerCancel(event) {
		if (!state.drag || event.pointerId !== state.drag.pointerId) return;
		const cell = state.drag.cell;
		cleanupPointerDrag(false);
		animateDragBack(cell);
	}

	function setDragTarget(target) {
		if (sameOptionalCell(state.drag?.target, target)) return;
		clearDragTarget();
		state.drag.target = target;
		state.drag.targetCell = null;
		if (!target) return;
		state.drag.targetCell = document.querySelector(`[data-row="${target.row}"][data-col="${target.col}"]`);
		state.drag.targetCell?.classList.add('swap-target');
	}

	function updateDragTargetTransform() {
		if (!state.drag?.targetCell) return;
		state.drag.targetCell.style.transform = `translate(${-state.drag.dx}px, ${-state.drag.dy}px)`;
	}

	function clearDragTarget() {
		document.querySelectorAll('.mh-cell.swap-target').forEach((cell) => {
			cell.classList.remove('swap-target');
			cell.style.transform = '';
		});
	}

	function cleanupPointerDrag(resetTransform = true, keepTargetTransform = false) {
		window.removeEventListener('pointermove', handlePointerMove);
		window.removeEventListener('pointerup', handlePointerUp);
		window.removeEventListener('pointercancel', handlePointerCancel);
		if (keepTargetTransform && state.drag?.targetCell) {
			state.drag.targetCell.classList.remove('swap-target');
		} else {
			clearDragTarget();
		}
		if (state.drag?.cell) {
			state.drag.cell.classList.remove('dragging');
			if (resetTransform) state.drag.cell.style.transform = '';
		}
		state.drag = null;
	}

	function animateDragBack(cell) {
		if (!cell) return;
		cell.classList.add('swapping');
		requestAnimationFrame(() => {
			cell.style.transform = '';
			setTimeout(() => cell.classList.remove('swapping'), 190);
		});
	}

	function animateSwapCells(first, second, options = {}) {
		const firstCell = document.querySelector(`[data-row="${first.row}"][data-col="${first.col}"]`);
		const secondCell = document.querySelector(`[data-row="${second.row}"][data-col="${second.col}"]`);
		if (!firstCell || !secondCell) return Promise.resolve();

		const firstRect = firstCell.getBoundingClientRect();
		const secondRect = secondCell.getBoundingClientRect();
		const dx = secondRect.left - firstRect.left;
		const dy = secondRect.top - firstRect.top;
		firstCell.classList.add('swapping');
		secondCell.classList.add('swapping');

		if (options.dragged && options.dragOffset) {
			firstCell.style.transform = `translate(${options.dragOffset.dx}px, ${options.dragOffset.dy}px) scale(1.06)`;
			secondCell.style.transform = `translate(${-options.dragOffset.dx}px, ${-options.dragOffset.dy}px)`;
		} else {
			firstCell.style.transform = 'translate(0, 0)';
			secondCell.style.transform = 'translate(0, 0)';
		}

		return new Promise((resolve) => {
			requestAnimationFrame(() => {
				firstCell.style.transform = `translate(${dx}px, ${dy}px)`;
				secondCell.style.transform = `translate(${-dx}px, ${-dy}px)`;
				setTimeout(() => {
					if (options.holdFinal) {
						resolve();
						return;
					}
					firstCell.classList.remove('swapping');
					secondCell.classList.remove('swapping');
					firstCell.style.transform = '';
					secondCell.style.transform = '';
					resolve();
				}, 190);
			});
		});
	}

	function animateSwapBackFromHeld(first, second) {
		const firstCell = document.querySelector(`[data-row="${first.row}"][data-col="${first.col}"]`);
		const secondCell = document.querySelector(`[data-row="${second.row}"][data-col="${second.col}"]`);
		if (!firstCell || !secondCell) return Promise.resolve();

		firstCell.classList.add('swapping');
		secondCell.classList.add('swapping');

		return new Promise((resolve) => {
			requestAnimationFrame(() => {
				firstCell.style.transform = 'translate(0, 0)';
				secondCell.style.transform = 'translate(0, 0)';
				setTimeout(() => {
					firstCell.classList.remove('swapping');
					secondCell.classList.remove('swapping');
					firstCell.style.transform = '';
					secondCell.style.transform = '';
					resolve();
				}, 190);
			});
		});
	}

	function createToken(asset) {
		const token = document.createElement('span');
		token.className = 'mh-token';
		applyJellyStyle(token, asset);
		if (asset?.kind === 'pet') {
			const sprite = document.createElement('span');
			const uv = asset.uv;
			sprite.className = 'mh-sprite';
			sprite.style.backgroundImage = `url("${asset.url}")`;
				if (asset.imageWidth && asset.imageHeight && uv.width && uv.height) {
					const sizeX = asset.imageWidth / uv.width * 100;
					const sizeY = asset.imageHeight / uv.height * 100;
					const posX = asset.imageWidth === uv.width ? 0 : uv.x / (asset.imageWidth - uv.width) * 100;
					const posY = asset.imageHeight === uv.height ? 0 : uv.y / (asset.imageHeight - uv.height) * 100;
					sprite.style.backgroundSize = `${sizeX}% ${sizeY}%`;
					sprite.style.backgroundPosition = `${posX}% ${posY}%`;
				} else if (uv.cols > 1 || uv.rows > 1) {
					sprite.style.backgroundSize = `${uv.cols * 100}% ${uv.rows * 100}%`;
					sprite.style.backgroundPosition = `${uv.cols > 1 ? uv.col * 100 / (uv.cols - 1) : 0}% ${uv.rows > 1 ? uv.row * 100 / (uv.rows - 1) : 0}%`;
			} else {
				sprite.style.backgroundSize = 'contain';
				sprite.style.backgroundPosition = 'center';
			}
			token.appendChild(sprite);
			return token;
		}
		const emoji = document.createElement('span');
		emoji.className = 'mh-emoji';
		emoji.textContent = asset?.emoji || '⭐';
		token.appendChild(emoji);
		return token;
	}

	function applyJellyStyle(token, asset) {
		const jelly = asset?.jelly || JELLY_COLORS[0];
		token.style.setProperty('--jelly-from', jelly.from);
		token.style.setProperty('--jelly-to', jelly.to);
		token.style.setProperty('--jelly-shine', jelly.shine);
	}

	function selectCell(row, col) {
		if (state.locked || state.finished) return;
		const current = { row, col };
		if (!state.selected) {
			state.selected = current;
			renderBoard();
			return;
		}
		if (sameCell(state.selected, current)) {
			state.selected = null;
			renderBoard();
			return;
		}
		if (!isAdjacent(state.selected, current)) {
			state.selected = current;
			renderBoard();
			return;
		}
		swapAndResolve(state.selected, current);
	}

	async function swapAndResolve(first, second, options = {}) {
		state.locked = true;
		await animateSwapCells(first, second, { ...options, holdFinal: true });
		swap(first, second);
		state.selected = null;

		let matches = findMatches();
		if (!matches.length) {
			swap(first, second);
			await animateSwapBackFromHeld(first, second);
			renderBoard(new Set([key(first.row, first.col), key(second.row, second.col)]));
			showInvalidSwap([first, second]);
			state.locked = false;
			setTip('这一步没有连成 3 个，换个方向试试。');
			return;
		}

		renderBoard(new Set([key(first.row, first.col), key(second.row, second.col)]));
		await delay(160);

		state.moves--;
		state.combo = 0;
		updateStats();
		await resolveMatches(matches);
		state.locked = false;
		renderBoard();
		checkFinish();
	}

	async function resolveMatches(matches) {
		while (matches.length) {
			state.combo++;
			const cells = uniqueCells(matches.flat());
			markMatching(cells);
			createParticles(cells);
			const gained = cells.length * 10 + Math.max(0, state.combo - 1) * 20;
			state.score += gained;
			updateStats();
			showScoreFloat(gained, cells);
			if (state.combo > 1) showComboBanner(state.combo);
			pulseBoard();
			await delay(260);
			clearCells(cells);
			const changed = collapseBoard();
			renderBoard(changed);
			await delay(170);
			matches = findMatches();
		}
		setTip(state.combo > 1 ? `漂亮，触发 ${state.combo} 连锁！` : '继续寻找下一组宠物。');
	}

	function findMatches() {
		const matches = [];
		for (let row = 0; row < BOARD_SIZE; row++) {
			let runStart = 0;
			for (let col = 1; col <= BOARD_SIZE; col++) {
				if (col < BOARD_SIZE && state.board[row][col] === state.board[row][runStart]) continue;
				if (col - runStart >= 3) matches.push(range(runStart, col).map((c) => ({ row, col: c })));
				runStart = col;
			}
		}
		for (let col = 0; col < BOARD_SIZE; col++) {
			let runStart = 0;
			for (let row = 1; row <= BOARD_SIZE; row++) {
				if (row < BOARD_SIZE && state.board[row][col] === state.board[runStart][col]) continue;
				if (row - runStart >= 3) matches.push(range(runStart, row).map((r) => ({ row: r, col })));
				runStart = row;
			}
		}
		return matches;
	}

	function markMatching(cells) {
		cells.forEach(({ row, col }) => {
			const cell = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
			cell?.classList.add('matching');
		});
	}

	function createParticles(cells) {
		const colors = ['#f97316', '#facc15', '#22c55e', '#38bdf8', '#ec4899', '#a855f7'];
		cells.forEach(({ row, col }) => {
			const rect = cellRect(row, col);
			if (!rect) return;
			const x = rect.left + rect.width / 2;
			const y = rect.top + rect.height / 2;
			for (let i = 0; i < 7; i++) {
				const particle = document.createElement('span');
				const angle = (Math.PI * 2 * i / 7) + Math.random() * 0.55;
				const power = 24 + Math.random() * 26;
				particle.className = 'mh-particle';
				particle.style.left = `${x}px`;
				particle.style.top = `${y}px`;
				particle.style.setProperty('--dx', `${Math.cos(angle) * power}px`);
				particle.style.setProperty('--dy', `${Math.sin(angle) * power}px`);
				particle.style.setProperty('--mh-particle-color', colors[(row + col + i) % colors.length]);
				document.body.appendChild(particle);
				setTimeout(() => particle.remove(), 650);
			}
		});
	}

	function showScoreFloat(points, cells) {
		const center = cellsCenter(cells);
		if (!center) return;
		const float = document.createElement('div');
		float.className = 'mh-score-float';
		float.textContent = `+${points}`;
		float.style.left = `${center.x}px`;
		float.style.top = `${center.y}px`;
		document.body.appendChild(float);
		setTimeout(() => float.remove(), 980);
	}

	function showComboBanner(combo) {
		const banner = document.createElement('div');
		banner.className = 'mh-combo-banner';
		banner.textContent = typeof combo === 'number' ? `${combo} 连锁!` : combo;
		document.body.appendChild(banner);
		setTimeout(() => banner.remove(), 980);
	}

	function pulseBoard() {
		const wrap = document.querySelector('.mh-board-wrap');
		if (!wrap) return;
		wrap.classList.remove('combo');
		void wrap.offsetWidth;
		wrap.classList.add('combo');
		setTimeout(() => wrap.classList.remove('combo'), 520);
	}

	function showInvalidSwap(cells) {
		cells.forEach(({ row, col }) => {
			const cell = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
			if (!cell) return;
			cell.classList.remove('invalid');
			void cell.offsetWidth;
			cell.classList.add('invalid');
			setTimeout(() => cell.classList.remove('invalid'), 300);
		});
	}

	function cellRect(row, col) {
		return document.querySelector(`[data-row="${row}"][data-col="${col}"]`)?.getBoundingClientRect() || null;
	}

	function cellsCenter(cells) {
		let totalX = 0;
		let totalY = 0;
		let count = 0;
		cells.forEach(({ row, col }) => {
			const rect = cellRect(row, col);
			if (!rect) return;
			totalX += rect.left + rect.width / 2;
			totalY += rect.top + rect.height / 2;
			count++;
		});
		return count ? { x: totalX / count, y: totalY / count } : null;
	}

	function clearCells(cells) {
		cells.forEach(({ row, col }) => {
			state.board[row][col] = null;
		});
	}

	function collapseBoard() {
		const changed = new Set();
		for (let col = 0; col < BOARD_SIZE; col++) {
			const values = [];
			for (let row = BOARD_SIZE - 1; row >= 0; row--) {
				if (state.board[row][col] !== null) values.push(state.board[row][col]);
			}
			while (values.length < BOARD_SIZE) values.push(randomType());
			for (let row = BOARD_SIZE - 1, index = 0; row >= 0; row--, index++) {
				if (state.board[row][col] !== values[index]) changed.add(key(row, col));
				state.board[row][col] = values[index];
			}
		}
		return changed;
	}

	function checkFinish() {
		if (state.score >= TARGET_SCORE) {
			finish(true, '目标达成！');
			return;
		}
		if (state.moves <= 0) finish(false, '步数用完啦');
	}

	function finish(won, text) {
		if (state.finished) return;
		state.finished = true;
		state.locked = true;
		renderBoard();
		const earnedPoints = won ? Math.max(60, Math.round(state.score / 10)) : Math.max(20, Math.round(state.score / 18));
		if (won) launchConfetti();
		showComboBanner(won ? '完成!' : '再试一次');
		showToast(`${text}<br>心情 +${earnedPoints}`);
		post('gameFinished', {
			earnedPoints,
			score: state.score,
			movesLeft: state.moves,
			won,
			finishedAt: Date.now(),
		});
	}

	function launchConfetti() {
		const colors = ['#f97316', '#facc15', '#22c55e', '#38bdf8', '#ec4899', '#a855f7'];
		for (let i = 0; i < 42; i++) {
			const piece = document.createElement('span');
			piece.className = 'mh-confetti';
			piece.style.left = `${Math.random() * 100}vw`;
			piece.style.setProperty('--dx', `${(Math.random() - 0.5) * 150}px`);
			piece.style.setProperty('--mh-confetti-color', colors[i % colors.length]);
			piece.style.setProperty('--mh-confetti-duration', `${1.25 + Math.random() * 0.85}s`);
			document.body.appendChild(piece);
			setTimeout(() => piece.remove(), 2300);
		}
	}

	function swap(a, b) {
		const temp = state.board[a.row][a.col];
		state.board[a.row][a.col] = state.board[b.row][b.col];
		state.board[b.row][b.col] = temp;
	}

	function updateStats() {
		byId('mhMoves').textContent = String(state.moves);
		byId('mhScore').textContent = String(state.score);
	}

	function setTip(text) {
		byId('mhTip').textContent = text;
	}

	function showToast(html) {
		const toast = document.createElement('div');
		toast.className = 'mh-toast';
		toast.innerHTML = html;
		document.body.appendChild(toast);
		setTimeout(() => toast.remove(), 1350);
	}

	function showHowTo() {
		byId('mhHowTo').hidden = false;
	}

	function post(type, data = {}, extra = {}) {
		try {
			window.parent.postMessage({ type, data, ...extra }, '*');
		} catch (_) {}
	}

	function byId(id) {
		return document.getElementById(id);
	}

	function randomType() {
		return Math.floor(Math.random() * TYPE_COUNT);
	}

	function isInsideBoard(row, col) {
		return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
	}

	function getCellSize() {
		const cell = document.querySelector('.mh-cell');
		return cell ? Math.min(cell.offsetWidth, cell.offsetHeight) : 44;
	}

	function getCellStep() {
		const first = document.querySelector('[data-row="0"][data-col="0"]');
		const next = document.querySelector('[data-row="0"][data-col="1"]') || document.querySelector('[data-row="1"][data-col="0"]');
		if (!first || !next) return getCellSize();
		const a = first.getBoundingClientRect();
		const b = next.getBoundingClientRect();
		return Math.max(Math.abs(b.left - a.left), Math.abs(b.top - a.top), getCellSize());
	}

	function clamp(value, min, max) {
		return Math.max(min, Math.min(max, value));
	}

	function key(row, col) {
		return `${row}:${col}`;
	}

	function range(start, end) {
		return Array.from({ length: end - start }, (_, index) => start + index);
	}

	function uniqueCells(cells) {
		const seen = new Set();
		return cells.filter((cell) => {
			const cellKey = key(cell.row, cell.col);
			if (seen.has(cellKey)) return false;
			seen.add(cellKey);
			return true;
		});
	}

	function sameCell(a, b) {
		return a.row === b.row && a.col === b.col;
	}

	function sameOptionalCell(a, b) {
		if (!a && !b) return true;
		if (!a || !b) return false;
		return sameCell(a, b);
	}

	function isAdjacent(a, b) {
		return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
	}

	function delay(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	function cleanupObjectUrls() {
		state.objectUrls.forEach((url) => URL.revokeObjectURL(url));
		state.objectUrls = [];
	}

	boot();
})();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const BOARD_SIZE = 24;
const MAX_CHAT_MESSAGES = 100;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  transports: ['websocket'],
  pingInterval: 25000,
  pingTimeout: 20000
});

app.use((req, res, next) => {
  if (
    req.path.endsWith('.js') ||
    req.path.endsWith('.css') ||
    req.path.endsWith('.html')
  ) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = new Map();

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function createSnapshotFromValues(values = {}) {
  return {
    turn: values.turn ?? 'red',
    winner: values.winner ?? null,
    pegs: deepCopy(values.pegs ?? []),
    links: deepCopy(values.links ?? []),
    moveCount: values.moveCount ?? 0,
    canSwap: values.canSwap ?? false,
    lastMove: values.lastMove ? { ...values.lastMove } : null,
  };
}

function createEmptySnapshot() {
  return createSnapshotFromValues();
}

function createRoom(roomId) {
  const baseSnapshot = createEmptySnapshot();

  return {
    roomId,
    boardSize: BOARD_SIZE,
    players: {},
    sockets: {},
    spectators: [],
    turn: baseSnapshot.turn,
    winner: baseSnapshot.winner,
    pegs: baseSnapshot.pegs,
    links: baseSnapshot.links,
    moveCount: baseSnapshot.moveCount,
    canSwap: baseSnapshot.canSwap,
    started: false,
    history: [],
    timeline: [createSnapshotFromValues(baseSnapshot)],
    reviewMode: false,
    reviewIndex: 0,
    reviewGhostPegs: [],
    reviewGhostLinks: [],
    lastMove: baseSnapshot.lastMove,
    pendingUndoBy: null,
    pendingRestartBy: null,
    chatMessages: [],
  };
}

function cloneState(room) {
  return createSnapshotFromValues({
    turn: room.turn,
    winner: room.winner,
    pegs: room.pegs,
    links: room.links,
    moveCount: room.moveCount,
    canSwap: room.canSwap,
    lastMove: room.lastMove,
  });
}

function restoreSnapshot(room, snapshot) {
  room.turn = snapshot.turn;
  room.winner = snapshot.winner;
  room.pegs = deepCopy(snapshot.pegs);
  room.links = deepCopy(snapshot.links);
  room.moveCount = snapshot.moveCount;
  room.canSwap = snapshot.canSwap;
  room.lastMove = snapshot.lastMove ? { ...snapshot.lastMove } : null;
}

function clearPendingRequests(room) {
  room.pendingUndoBy = null;
  room.pendingRestartBy = null;
}

function resetReview(room) {
  room.reviewMode = false;
  room.reviewIndex = Math.max(0, room.timeline.length - 1);
  room.reviewGhostPegs = [];
  room.reviewGhostLinks = [];
}

function pushTimeline(room) {
  room.timeline.push(cloneState(room));
  room.reviewIndex = room.timeline.length - 1;
  room.reviewGhostPegs = [];
  room.reviewGhostLinks = [];
}

function getReviewSnapshot(room) {
  const index = Math.max(0, Math.min(room.reviewIndex, room.timeline.length - 1));
  return room.timeline[index] || room.timeline[0] || createEmptySnapshot();
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, createRoom(roomId));
  return rooms.get(roomId);
}

function isCorner(x, y) {
  return (
    (x === 0 && y === 0) ||
    (x === 0 && y === BOARD_SIZE - 1) ||
    (x === BOARD_SIZE - 1 && y === 0) ||
    (x === BOARD_SIZE - 1 && y === BOARD_SIZE - 1)
  );
}

function isInOpponentBorder(color, x, y) {
  if (color === 'red') {
    return x === 0 || x === BOARD_SIZE - 1;
  }
  return y === 0 || y === BOARD_SIZE - 1;
}

function pegAt(roomOrSnapshot, x, y) {
  return (roomOrSnapshot.pegs || []).find((p) => p.x === x && p.y === y) || null;
}

function knightMove(a, b) {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return (dx === 1 && dy === 2) || (dx === 2 && dy === 1);
}

function orient(ax, ay, bx, by, cx, cy) {
  const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (v === 0) return 0;
  return v > 0 ? 1 : -1;
}

function segmentsIntersectStrict(a, b, c, d) {
  const o1 = orient(a.x, a.y, b.x, b.y, c.x, c.y);
  const o2 = orient(a.x, a.y, b.x, b.y, d.x, d.y);
  const o3 = orient(c.x, c.y, d.x, d.y, a.x, a.y);
  const o4 = orient(c.x, c.y, d.x, d.y, b.x, b.y);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
}

function sameEndpoint(l1, l2) {
  const pts1 = [`${l1.a.x},${l1.a.y}`, `${l1.b.x},${l1.b.y}`];
  const pts2 = [`${l2.a.x},${l2.a.y}`, `${l2.b.x},${l2.b.y}`];
  return pts1.some((p) => pts2.includes(p));
}

function linkWouldCrossAgainst(existingLinks, candidate) {
  return existingLinks.some((link) => {
    if (link.color === candidate.color) return false;
    if (sameEndpoint(link, candidate)) return false;
    return segmentsIntersectStrict(candidate.a, candidate.b, link.a, link.b);
  });
}

function linkExistsInSet(existingLinks, a, b, color) {
  return existingLinks.some((link) => {
    if (link.color !== color) return false;
    const s1 = `${link.a.x},${link.a.y}`;
    const s2 = `${link.b.x},${link.b.y}`;
    const t1 = `${a.x},${a.y}`;
    const t2 = `${b.x},${b.y}`;
    return (s1 === t1 && s2 === t2) || (s1 === t2 && s2 === t1);
  });
}

function autoAddLinks(room, newPeg) {
  const sameColorPegs = room.pegs.filter(
    (p) => p.color === newPeg.color && !(p.x === newPeg.x && p.y === newPeg.y)
  );

  for (const peg of sameColorPegs) {
    if (!knightMove(newPeg, peg)) continue;

    const candidate = {
      a: { x: newPeg.x, y: newPeg.y },
      b: { x: peg.x, y: peg.y },
      color: newPeg.color,
    };

    if (linkExistsInSet(room.links, candidate.a, candidate.b, newPeg.color)) continue;
    if (linkWouldCrossAgainst(room.links, candidate)) continue;

    room.links.push(candidate);
  }
}

function buildAdjacency(room, color) {
  const adj = new Map();

  for (const peg of room.pegs.filter((p) => p.color === color)) {
    adj.set(`${peg.x},${peg.y}`, []);
  }

  for (const link of room.links.filter((l) => l.color === color)) {
    const a = `${link.a.x},${link.a.y}`;
    const b = `${link.b.x},${link.b.y}`;
    if (adj.has(a) && adj.has(b)) {
      adj.get(a).push(b);
      adj.get(b).push(a);
    }
  }

  return adj;
}

function hasWinningPath(room, color) {
  const adj = buildAdjacency(room, color);
  const queue = [];
  const seen = new Set();

  for (const peg of room.pegs.filter((p) => p.color === color)) {
    if ((color === 'red' && peg.y === 0) || (color === 'blue' && peg.x === 0)) {
      const key = `${peg.x},${peg.y}`;
      queue.push(key);
      seen.add(key);
    }
  }

  while (queue.length) {
    const key = queue.shift();
    const [x, y] = key.split(',').map(Number);

    if ((color === 'red' && y === BOARD_SIZE - 1) || (color === 'blue' && x === BOARD_SIZE - 1)) {
      return true;
    }

    for (const nxt of adj.get(key) || []) {
      if (!seen.has(nxt)) {
        seen.add(nxt);
        queue.push(nxt);
      }
    }
  }

  return false;
}

function getNextReviewColor(room) {
  if (room.reviewGhostPegs.length > 0) {
    const lastGhost = room.reviewGhostPegs[room.reviewGhostPegs.length - 1];
    return lastGhost.color === 'red' ? 'blue' : 'red';
  }
  const snapshot = getReviewSnapshot(room);
  if (snapshot.turn) return snapshot.turn;
  if (snapshot.lastMove?.color) return snapshot.lastMove.color === 'red' ? 'blue' : 'red';
  return 'red';
}

function buildCombinedReviewState(room) {
  const snapshot = getReviewSnapshot(room);
  return {
    pegs: [...deepCopy(snapshot.pegs), ...deepCopy(room.reviewGhostPegs)],
    links: [...deepCopy(snapshot.links), ...deepCopy(room.reviewGhostLinks)],
  };
}

function autoAddReviewGhostLinks(room, newPeg) {
  const combined = buildCombinedReviewState(room);

  const sameColorPegs = combined.pegs.filter(
    (p) => p.color === newPeg.color && !(p.x === newPeg.x && p.y === newPeg.y)
  );

  for (const peg of sameColorPegs) {
    if (!knightMove(newPeg, peg)) continue;

    const candidate = {
      a: { x: newPeg.x, y: newPeg.y },
      b: { x: peg.x, y: peg.y },
      color: newPeg.color,
    };

    if (linkExistsInSet(combined.links, candidate.a, candidate.b, newPeg.color)) continue;
    if (linkWouldCrossAgainst(combined.links, candidate)) continue;

    room.reviewGhostLinks.push({
      ...candidate,
      ghost: true,
    });

    combined.links.push(candidate);
  }
}

function assignColor(room, socket, requestedName) {
  const name = requestedName?.trim() || 'Player';
  const taken = new Set(Object.keys(room.players));

  if (!taken.has('red')) {
    room.players.red = { name, socketId: socket.id };
    room.sockets[socket.id] = 'red';
    room.started = !!room.players.blue;
    return 'red';
  }

  if (!taken.has('blue')) {
    room.players.blue = { name, socketId: socket.id };
    room.sockets[socket.id] = 'blue';
    room.started = true;
    return 'blue';
  }

  room.spectators.push({ name, socketId: socket.id });
  room.sockets[socket.id] = 'spectator';
  return 'spectator';
}

function cleanupEmptyRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const hasPlayers = Object.keys(room.players).length > 0;
  const hasSpectators = room.spectators.length > 0;

  if (!hasPlayers && !hasSpectators) rooms.delete(roomId);
}

function removeSocketFromRooms(socketId) {
  for (const [roomId, room] of rooms.entries()) {
    const role = room.sockets[socketId];
    if (!role) continue;

    delete room.sockets[socketId];

    if (role === 'red' || role === 'blue') {
      delete room.players[role];
      room.started = !!(room.players.red && room.players.blue);
      clearPendingRequests(room);
    } else {
      room.spectators = room.spectators.filter((s) => s.socketId !== socketId);
    }

    io.to(roomId).emit('state', roomStateForClient(room));
    cleanupEmptyRoom(roomId);
  }
}

function roomStateForClient(room) {
  const reviewSnapshot = room.reviewMode ? getReviewSnapshot(room) : null;

  return {
    roomId: room.roomId,
    boardSize: room.boardSize,
    players: room.players,
    turn: room.turn,
    winner: room.winner,
    pegs: room.pegs,
    links: room.links,
    moveCount: room.moveCount,
    canSwap: room.canSwap,
    started: room.started,
    lastMove: room.lastMove,
    pendingUndoBy: room.pendingUndoBy,
    pendingRestartBy: room.pendingRestartBy,
    canUndo: room.history.length > 0,
    chatMessages: room.chatMessages,
    reviewMode: room.reviewMode,
    reviewIndex: room.reviewIndex,
    reviewTotal: Math.max(0, room.timeline.length - 1),
    reviewSnapshot,
    reviewGhostPegs: room.reviewGhostPegs,
    reviewGhostLinks: room.reviewGhostLinks,
    reviewNextColor: room.reviewMode ? getNextReviewColor(room) : null,
  };
}

function emitState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit('state', roomStateForClient(room));
}

function getDisplayName(room, socketId) {
  if (room.players.red?.socketId === socketId) return room.players.red.name;
  if (room.players.blue?.socketId === socketId) return room.players.blue.name;
  const spectator = room.spectators.find((s) => s.socketId === socketId);
  return spectator?.name || '관전자';
}

io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId, name }) => {
    roomId = (roomId || 'default').trim().slice(0, 24) || 'default';

    removeSocketFromRooms(socket.id);

    const room = getRoom(roomId);
    socket.join(roomId);

    const role = assignColor(room, socket, name);

    socket.emit('joined', {
      role,
      color: role === 'spectator' ? null : role,
      state: roomStateForClient(room),
    });

    emitState(roomId);
  });

  socket.on('place-peg', ({ roomId, x, y }) => {
    const room = rooms.get(roomId);
    if (!room || room.winner || room.reviewMode) return;

    const color = room.sockets[socket.id];
    if (!color || color === 'spectator') return;
    if (!room.players.red || !room.players.blue) return;
    if (room.turn !== color) return;
    if (!Number.isInteger(x) || !Number.isInteger(y)) return;
    if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return;
    if (isCorner(x, y)) return;
    if (pegAt(room, x, y)) return;
    if (isInOpponentBorder(color, x, y)) return;

    room.history.push(cloneState(room));
    clearPendingRequests(room);
    resetReview(room);

    const peg = { x, y, color };
    room.pegs.push(peg);
    autoAddLinks(room, peg);
    room.moveCount += 1;
    room.canSwap = room.moveCount === 1;
    room.lastMove = { x, y, color };

    if (hasWinningPath(room, color)) {
      room.winner = color;
    } else {
      room.turn = color === 'red' ? 'blue' : 'red';
    }

    pushTimeline(room);
    emitState(roomId);
  });

  socket.on('swap-sides', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.winner || room.reviewMode || !room.canSwap || room.moveCount !== 1) return;

    const role = room.sockets[socket.id];
    if (role !== 'blue') return;

    room.history.push(cloneState(room));
    clearPendingRequests(room);
    resetReview(room);

    room.pegs = room.pegs.map((p) => ({
      ...p,
      color: p.color === 'red' ? 'blue' : 'red',
    }));

    room.links = room.links.map((l) => ({
      ...l,
      color: l.color === 'red' ? 'blue' : 'red',
    }));

    if (room.lastMove) {
      room.lastMove = {
        ...room.lastMove,
        color: room.lastMove.color === 'red' ? 'blue' : 'red',
      };
    }

    room.turn = 'red';
    room.canSwap = false;

    pushTimeline(room);
    emitState(roomId);
  });

  socket.on('surrender-game', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.winner || room.reviewMode) return;

    const role = room.sockets[socket.id];
    if (role !== 'red' && role !== 'blue') return;
    if (!room.players.red || !room.players.blue) return;

    room.history.push(cloneState(room));
    clearPendingRequests(room);
    resetReview(room);

    room.winner = role === 'red' ? 'blue' : 'red';
    pushTimeline(room);
    emitState(roomId);
  });

  socket.on('request-undo', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.reviewMode) return;

    const role = room.sockets[socket.id];
    if (role !== 'red' && role !== 'blue') return;
    if (!room.players.red || !room.players.blue) return;
    if (room.history.length === 0) return;

    if (!room.pendingUndoBy) {
      room.pendingUndoBy = role;
      room.pendingRestartBy = null;
      emitState(roomId);
      return;
    }

    if (room.pendingUndoBy === role) return;

    const snapshot = room.history.pop();
    restoreSnapshot(room, snapshot);
    clearPendingRequests(room);
    resetReview(room);

    if (room.timeline.length > 1) {
      room.timeline.pop();
    } else {
      room.timeline = [cloneState(room)];
    }

    emitState(roomId);
  });

  socket.on('request-restart', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const role = room.sockets[socket.id];
    if (role !== 'red' && role !== 'blue') return;
    if (!room.players.red || !room.players.blue) return;

    if (!room.pendingRestartBy) {
      room.pendingRestartBy = role;
      room.pendingUndoBy = null;
      emitState(roomId);
      return;
    }

    if (room.pendingRestartBy === role) return;

    const oldPlayers = room.players;
    const oldSockets = room.sockets;
    const oldSpectators = room.spectators;
    const oldChatMessages = room.chatMessages;

    rooms.set(roomId, {
      ...createRoom(roomId),
      players: oldPlayers,
      sockets: oldSockets,
      spectators: oldSpectators,
      started: !!(oldPlayers.red && oldPlayers.blue),
      chatMessages: oldChatMessages,
    });

    emitState(roomId);
  });

  socket.on('start-review', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || !room.winner) return;

    room.reviewMode = true;
    room.reviewIndex = room.timeline.length - 1;
    room.reviewGhostPegs = [];
    room.reviewGhostLinks = [];
    emitState(roomId);
  });

  socket.on('stop-review', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    resetReview(room);
    emitState(roomId);
  });

  socket.on('step-review', ({ roomId, delta }) => {
    const room = rooms.get(roomId);
    if (!room || !room.reviewMode) return;
    if (delta !== -1 && delta !== 1) return;

    room.reviewIndex = Math.max(0, Math.min(room.timeline.length - 1, room.reviewIndex + delta));
    room.reviewGhostPegs = [];
    room.reviewGhostLinks = [];
    emitState(roomId);
  });

  socket.on('reset-review-ghost', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || !room.reviewMode) return;

    room.reviewGhostPegs = [];
    room.reviewGhostLinks = [];
    emitState(roomId);
  });

  socket.on('pop-review-ghost', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || !room.reviewMode) return;
    if (!room.reviewGhostPegs || room.reviewGhostPegs.length === 0) return;

    const removedPeg = room.reviewGhostPegs.pop();

    room.reviewGhostLinks = (room.reviewGhostLinks || []).filter((link) => {
      const touchesRemovedPeg =
        (link.a.x === removedPeg.x && link.a.y === removedPeg.y) ||
        (link.b.x === removedPeg.x && link.b.y === removedPeg.y);

      return !touchesRemovedPeg;
    });

    emitState(roomId);
  });

  socket.on('place-review-ghost', ({ roomId, x, y }) => {
    const room = rooms.get(roomId);
    if (!room || !room.reviewMode) return;
    if (!Number.isInteger(x) || !Number.isInteger(y)) return;
    if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return;
    if (isCorner(x, y)) return;

    const snapshot = getReviewSnapshot(room);
    const combined = buildCombinedReviewState(room);
    const ghostColor = getNextReviewColor(room);

    if (pegAt(combined, x, y)) return;
    if (isInOpponentBorder(ghostColor, x, y)) return;

    const newGhost = { x, y, color: ghostColor, ghost: true };
    room.reviewGhostPegs.push(newGhost);
    autoAddReviewGhostLinks(room, newGhost);

    if (snapshot.turn) {
      // 표시용 next color만 바뀌면 되므로 별도 snapshot 수정은 하지 않음
    }

    emitState(roomId);
  });

  socket.on('send-chat', ({ roomId, text }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const clean = String(text || '').trim().slice(0, 300);
    if (!clean) return;

    const message = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: getDisplayName(room, socket.id),
      role: room.sockets[socket.id] || 'spectator',
      text: clean,
      time: Date.now(),
    };

    room.chatMessages.push(message);
    if (room.chatMessages.length > MAX_CHAT_MESSAGES) {
      room.chatMessages.shift();
    }

    emitState(roomId);
  });

  socket.on('disconnect', () => {
    removeSocketFromRooms(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Twixt server listening on http://localhost:${PORT}`);
});
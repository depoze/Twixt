const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { applyPieRule } = require('../public/pie-rule');

function opening(x, y) {
  return {
    pegs: [{ x, y, color: 'red' }],
    links: [],
    lastMove: { x, y, color: 'red' },
    moveCount: 1,
    turn: 'blue',
    canSwap: true,
  };
}

test('pie rule transposes an off-diagonal opening and its last-move marker', () => {
  const position = opening(4, 9);
  applyPieRule(position);
  assert.deepEqual(position.pegs, [{ x: 9, y: 4, color: 'blue' }]);
  assert.deepEqual(position.lastMove, position.pegs[0]);
  assert.equal(position.turn, 'red');
  assert.equal(position.canSwap, false);
  assert.equal(position.moveCount, 1);
});

test('every legal red opening becomes a legal blue position, including goal edges', () => {
  for (let x = 1; x < 23; x += 1) {
    for (let y = 0; y < 24; y += 1) {
      const position = opening(x, y);
      applyPieRule(position);
      assert.equal(position.pegs[0].x, y);
      assert.equal(position.pegs[0].y, x);
      assert.equal(position.pegs[0].color, 'blue');
      assert.ok(position.pegs[0].y > 0 && position.pegs[0].y < 23);
    }
  }
});

test('link endpoints transpose without mutating objects retained by history', () => {
  const position = opening(4, 9);
  position.links = [{ a: { x: 4, y: 9 }, b: { x: 5, y: 11 }, color: 'red' }];
  const originalPeg = position.pegs[0];
  const originalLink = position.links[0];
  const originalLastMove = position.lastMove;
  applyPieRule(position);
  assert.deepEqual(position.links, [{ a: { x: 9, y: 4 }, b: { x: 11, y: 5 }, color: 'blue' }]);
  assert.deepEqual(originalPeg, { x: 4, y: 9, color: 'red' });
  assert.deepEqual(originalLink, { a: { x: 4, y: 9 }, b: { x: 5, y: 11 }, color: 'red' });
  assert.deepEqual(originalLastMove, originalPeg);
});

// Run the real socket handlers with an in-memory transport and controlled clock.
function serverHarness() {
  let connection;
  let now = 1000;
  const clearedTimers = new Set();
  const io = { on: (event, handler) => { connection = handler; }, to: () => ({ emit() {} }) };
  const express = () => ({ use() {}, get() {} });
  express.static = () => () => {};
  class ClockDate extends Date {
    static now() { return now; }
  }
  const context = vm.createContext({
    require: (name) => {
      if (name === 'express') return express;
      if (name === 'http') return { createServer: () => ({ listen() {} }) };
      if (name === 'socket.io') return { Server: class { constructor() { return io; } } };
      if (name === 'path') return path;
      if (name === './public/pie-rule') return { applyPieRule };
      throw new Error(`Unexpected import: ${name}`);
    },
    __dirname: path.resolve(__dirname, '..'),
    process: { env: {} },
    console,
    Date: ClockDate,
    setTimeout: (callback, delay) => ({ callback, delay }),
    clearTimeout: (timer) => clearedTimers.add(timer),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8') +
    '\nglobalThis.game = { createRoom, rooms };', context);
  const room = context.game.createRoom('test-room');
  context.game.rooms.set(room.roomId, room);
  const handlers = {};
  for (const color of ['red', 'blue', 'spectator']) {
    handlers[color] = {};
    connection({ id: color, on: (event, handler) => { handlers[color][event] = handler; } });
    room.sockets[color] = color;
    if (color !== 'spectator') room.players[color] = { name: color, socketId: color };
  }
  return {
    room,
    clearedTimers,
    advance: () => { now += 1000; },
    act: (color, event, args = {}) => handlers[color][event]({ roomId: room.roomId, ...args }),
  };
}

test('online pie rule preserves player roles, timer, undo and review snapshots', () => {
  const game = serverHarness();
  game.act('red', 'set-turn-timer', { minutes: 0, seconds: 10 });
  assert.equal(game.room.turnDeadline, null);
  game.act('red', 'place-peg', { x: 7, y: 0 });
  const firstTimer = game.room.turnTimer;
  assert.equal(game.room.turnDeadline, 11000);
  game.advance();
  game.act('blue', 'swap-sides');
  assert.equal(JSON.stringify(game.room.pegs), JSON.stringify([{ x: 0, y: 7, color: 'blue' }]));
  assert.equal(game.room.turn, 'red');
  assert.equal(game.room.players.red.socketId, 'red');
  assert.equal(game.room.players.blue.socketId, 'blue');
  assert.equal(game.room.turnDeadline, 12000);
  assert.ok(game.clearedTimers.has(firstTimer));
  assert.equal(game.room.timeline[1].pegs[0].x, 7);
  assert.equal(game.room.timeline[2].pegs[0].x, 0);
  assert.equal(game.room.timeline[2].lastMove.y, 7);

  game.advance();
  game.act('red', 'request-undo');
  game.act('blue', 'request-undo');
  assert.equal(JSON.stringify(game.room.pegs), JSON.stringify([{ x: 7, y: 0, color: 'red' }]));
  assert.equal(game.room.lastMove.x, 7);
  assert.equal(game.room.turn, 'blue');
  assert.equal(game.room.canSwap, true);
  assert.equal(game.room.turnDeadline, 13000);
  assert.equal(game.room.timeline.length, 2);

  game.act('blue', 'swap-sides');
  game.act('red', 'surrender-game');
  assert.equal(game.room.turnDeadline, null);
  game.act('red', 'start-review');
  game.act('red', 'step-review', { delta: -1 });
  assert.equal(game.room.timeline[game.room.reviewIndex].pegs[0].x, 0);
  game.act('red', 'step-review', { delta: -1 });
  assert.equal(game.room.timeline[game.room.reviewIndex].pegs[0].x, 7);
});

test('pie rule is allowed only for blue after the first move and only once', () => {
  const game = serverHarness();
  game.act('blue', 'swap-sides');
  assert.equal(game.room.moveCount, 0);
  game.act('red', 'place-peg', { x: 4, y: 9 });
  game.act('red', 'swap-sides');
  game.act('spectator', 'swap-sides');
  assert.equal(game.room.pegs[0].x, 4);
  game.act('blue', 'swap-sides');
  game.act('blue', 'swap-sides');
  assert.equal(game.room.pegs[0].x, 9);
  game.act('red', 'place-peg', { x: 4, y: 10 });
  game.act('blue', 'swap-sides');
  assert.equal(game.room.moveCount, 2);
  assert.equal(game.room.pegs[0].x, 9);
});

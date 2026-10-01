function applyPieRule(position) {
  const transpose = (point) => ({ ...point, x: point.y, y: point.x });
  const oppositeColor = (color) => color === 'red' ? 'blue' : 'red';

  // Player colors and goal edges stay fixed, so the opening is reflected too.
  position.pegs = position.pegs.map((peg) => ({
    ...transpose(peg),
    color: oppositeColor(peg.color),
  }));
  position.links = position.links.map((link) => ({
    ...link,
    a: transpose(link.a),
    b: transpose(link.b),
    color: oppositeColor(link.color),
  }));
  if (position.lastMove) {
    position.lastMove = {
      ...transpose(position.lastMove),
      color: oppositeColor(position.lastMove.color),
    };
  }
  position.turn = 'red';
  position.canSwap = false;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { applyPieRule };
}

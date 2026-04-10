const socket = io({
  transports: ['websocket'],
  reconnection: true,
  reconnectionAttempts: 10,
  timeout: 20000,
});

const BOARD_SIZE = 24;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');
const joinBtn = document.getElementById('joinBtn');
const myRoleEl = document.getElementById('myRole');
const turnTextEl = document.getElementById('turnText');
const statusTextEl = document.getElementById('statusText');
const redPlayerEl = document.getElementById('redPlayer');
const bluePlayerEl = document.getElementById('bluePlayer');
const swapBtn = document.getElementById('swapBtn');
const restartBtn = document.getElementById('restartBtn');

let localModeBtn = document.getElementById('localModeBtn');
if (!localModeBtn) {
  localModeBtn = document.createElement('button');
  localModeBtn.id = 'localModeBtn';
  localModeBtn.textContent = '로컬 모드';
  joinBtn.insertAdjacentElement('afterend', localModeBtn);
  localModeBtn.style.display = 'block';
  localModeBtn.style.marginTop = '8px';
}

let surrenderBtn = document.getElementById('surrenderBtn');
if (!surrenderBtn) {
  surrenderBtn = document.createElement('button');
  surrenderBtn.id = 'surrenderBtn';
  surrenderBtn.textContent = '항복';
  restartBtn.insertAdjacentElement('beforebegin', surrenderBtn);
}

let undoBtn = document.getElementById('undoBtn');
if (!undoBtn) {
  undoBtn = document.createElement('button');
  undoBtn.id = 'undoBtn';
  undoBtn.textContent = '무르기 요청';
  surrenderBtn.insertAdjacentElement('beforebegin', undoBtn);
}

let turnBadgeEl = document.getElementById('turnBadge');
if (!turnBadgeEl) {
  turnBadgeEl = document.createElement('div');
  turnBadgeEl.id = 'turnBadge';
  turnBadgeEl.style.margin = '8px 0';
  turnBadgeEl.style.fontSize = '18px';
  turnBadgeEl.style.lineHeight = '1.35';
  statusTextEl.insertAdjacentElement('beforebegin', turnBadgeEl);
}

let requestInfoEl = document.getElementById('requestInfo');
if (!requestInfoEl) {
  requestInfoEl = document.createElement('div');
  requestInfoEl.id = 'requestInfo';
  requestInfoEl.style.marginTop = '8px';
  requestInfoEl.style.fontSize = '14px';
  requestInfoEl.style.fontWeight = '600';
  statusTextEl.insertAdjacentElement('afterend', requestInfoEl);
}

const COLORS = {
  red: '#d94343',
  redActive: '#ff4a4a',
  redFillSoft: 'rgba(255, 120, 120, 0.22)',
  redFillActive: 'rgba(255, 95, 95, 0.5)',

  blue: '#2f74dd',
  blueActive: '#4d96ff',
  blueFillSoft: 'rgba(120, 180, 255, 0.22)',
  blueFillActive: 'rgba(95, 165, 255, 0.5)',

  redGhost: 'rgba(217, 67, 67, 0.42)',
  blueGhost: 'rgba(47, 116, 221, 0.42)',
  redGhostStroke: 'rgba(217, 67, 67, 0.55)',
  blueGhostStroke: 'rgba(47, 116, 221, 0.55)',

  board: '#f7f1df',
  hole: '#7b6846',
  text: '#1f2430',
  latest: '#ffd84d',
};

let roomId = '';
let myRole = 'none';
let state = null;
let hasJoined = false;
let currentMode = 'none'; // none | online | local
let pendingSurrenderConfirm = false;

let leftColumn = null;
let centerColumn = null;
let chatColumn = null;
let rootLayout = null;
let boardContainerEl = null;
let sidebarAnchorEl = null;

let chatWrapEl = null;
let chatMessagesEl = null;
let chatInputEl = null;
let chatSendBtn = null;

let reviewPanelEl = null;
let reviewBtn = null;
let reviewPrevBtn = null;
let reviewNextBtn = null;
let reviewResetGhostBtn = null;
let reviewIndexEl = null;

let helpButtonEl = null;
let helpPopupEl = null;

let localHistory = [];
let localTimeline = [];

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function createSnapshotFromState(source) {
  return {
    turn: source.turn ?? 'red',
    winner: source.winner ?? null,
    pegs: deepCopy(source.pegs ?? []),
    links: deepCopy(source.links ?? []),
    moveCount: source.moveCount ?? 0,
    canSwap: source.canSwap ?? false,
    lastMove: source.lastMove ? { ...source.lastMove } : null,
  };
}

function createInitialState() {
  return {
    roomId: 'local',
    boardSize: BOARD_SIZE,
    players: {
      red: { name: 'RED', socketId: null },
      blue: { name: 'BLUE', socketId: null },
    },
    turn: 'red',
    winner: null,
    pegs: [],
    links: [],
    moveCount: 0,
    canSwap: false,
    started: true,
    lastMove: null,
    pendingUndoBy: null,
    pendingRestartBy: null,
    canUndo: false,
    chatMessages: [],
    reviewMode: false,
    reviewIndex: 0,
    reviewTotal: 0,
    reviewSnapshot: null,
    reviewGhostPegs: [],
    reviewGhostLinks: [],
    reviewNextColor: 'red',
  };
}

function ensureBaseButtonStyle(btn) {
  btn.style.height = '44px';
  btn.style.minHeight = '44px';
  btn.style.padding = '0 12px';
  btn.style.borderRadius = '12px';
  btn.style.fontSize = '15px';
  btn.style.fontWeight = '700';
  btn.style.cursor = 'pointer';
  btn.style.boxSizing = 'border-box';
}

function ensureLayout() {
  if (rootLayout) return;

  boardContainerEl = canvas.parentElement;
  if (!boardContainerEl) return;

  const pageRoot = boardContainerEl.parentElement || document.body;
  const originalChildren = Array.from(pageRoot.children);

  rootLayout = document.createElement('div');
  rootLayout.id = 'twixtMainLayout';
  rootLayout.style.display = 'grid';
  rootLayout.style.width = '100%';
  rootLayout.style.maxWidth = '1920px';
  rootLayout.style.margin = '0 auto';
  rootLayout.style.padding = '14px 16px';
  rootLayout.style.boxSizing = 'border-box';
  rootLayout.style.alignItems = 'start';
  rootLayout.style.columnGap = '18px';
  rootLayout.style.rowGap = '14px';

  leftColumn = document.createElement('div');
  leftColumn.id = 'leftColumn';
  leftColumn.style.display = 'flex';
  leftColumn.style.flexDirection = 'column';
  leftColumn.style.gap = '14px';
  leftColumn.style.minWidth = '280px';
  leftColumn.style.width = '100%';
  leftColumn.style.position = 'relative';

  sidebarAnchorEl = document.createElement('div');
  sidebarAnchorEl.id = 'sidebarAnchor';
  sidebarAnchorEl.style.position = 'absolute';
  sidebarAnchorEl.style.left = '0';
  sidebarAnchorEl.style.top = '0';
  sidebarAnchorEl.style.width = '0';
  sidebarAnchorEl.style.height = '0';
  leftColumn.appendChild(sidebarAnchorEl);

  chatColumn = document.createElement('div');
  chatColumn.id = 'chatColumn';
  chatColumn.style.display = 'flex';
  chatColumn.style.flexDirection = 'column';
  chatColumn.style.gap = '14px';
  chatColumn.style.minWidth = '300px';
  chatColumn.style.width = '100%';

  centerColumn = document.createElement('div');
  centerColumn.id = 'centerColumn';
  centerColumn.style.display = 'flex';
  centerColumn.style.justifyContent = 'center';
  centerColumn.style.alignItems = 'flex-start';
  centerColumn.style.minWidth = '0';
  centerColumn.style.width = '100%';
  centerColumn.style.position = 'relative';

  boardContainerEl.style.width = '100%';
  boardContainerEl.style.aspectRatio = '1 / 1';
  boardContainerEl.style.margin = '0 auto';
  boardContainerEl.style.boxSizing = 'border-box';
  boardContainerEl.style.display = 'block';
  boardContainerEl.style.position = 'relative';
  boardContainerEl.style.overflow = 'visible';
  boardContainerEl.style.maxWidth = '1080px';
  boardContainerEl.style.height = 'min(86vh, 1080px)';
  boardContainerEl.style.minHeight = '560px';
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.margin = '0 auto';

  for (const child of originalChildren) {
    if (child === boardContainerEl) continue;
    leftColumn.appendChild(child);
  }

  const pageTitle = leftColumn.querySelector('h1');
  if (pageTitle) {
    pageTitle.textContent = 'Twixt';
    pageTitle.style.textAlign = 'center';
    pageTitle.style.margin = '-6px 0 4px 0';
    pageTitle.style.fontSize = '56px';
    pageTitle.style.lineHeight = '1.02';
  }

  centerColumn.appendChild(boardContainerEl);

  rootLayout.appendChild(leftColumn);
  rootLayout.appendChild(chatColumn);
  rootLayout.appendChild(centerColumn);

  pageRoot.appendChild(rootLayout);

  applyResponsiveLayout();
  window.addEventListener('resize', applyResponsiveLayout);
}

function applyResponsiveLayout() {
  if (!rootLayout || !boardContainerEl) return;

  const width = window.innerWidth;
  const height = window.innerHeight;

  const pageTitle = leftColumn?.querySelector('h1');
  if (pageTitle) {
    if (width >= 1700) {
      pageTitle.style.fontSize = '56px';
      pageTitle.style.margin = '-6px 0 4px 0';
    } else if (width >= 1320) {
      pageTitle.style.fontSize = '48px';
      pageTitle.style.margin = '-4px 0 4px 0';
    } else if (width >= 1120) {
      pageTitle.style.fontSize = '42px';
      pageTitle.style.margin = '-2px 0 4px 0';
    } else {
      pageTitle.style.fontSize = '34px';
      pageTitle.style.margin = '0 0 4px 0';
    }
  }

  if (width >= 1700) {
    rootLayout.style.gridTemplateColumns = '320px 340px minmax(860px, 1fr)';
    rootLayout.style.columnGap = '20px';

    leftColumn.style.minWidth = '320px';
    chatColumn.style.minWidth = '340px';

    boardContainerEl.style.width = '100%';
    boardContainerEl.style.maxWidth = '1120px';
    boardContainerEl.style.height = 'auto';
    boardContainerEl.style.aspectRatio = '1 / 1';
    boardContainerEl.style.minHeight = '0';
  } else if (width >= 1500) {
    rootLayout.style.gridTemplateColumns = '300px 320px minmax(760px, 1fr)';
    rootLayout.style.columnGap = '18px';

    leftColumn.style.minWidth = '300px';
    chatColumn.style.minWidth = '320px';

    boardContainerEl.style.width = '100%';
    boardContainerEl.style.maxWidth = '1000px';
    boardContainerEl.style.height = 'auto';
    boardContainerEl.style.aspectRatio = '1 / 1';
    boardContainerEl.style.minHeight = '0';
  } else if (width >= 1320) {
    rootLayout.style.gridTemplateColumns = '280px 290px minmax(640px, 1fr)';
    rootLayout.style.columnGap = '16px';

    leftColumn.style.minWidth = '280px';
    chatColumn.style.minWidth = '290px';

    boardContainerEl.style.width = '100%';
    boardContainerEl.style.maxWidth = '880px';
    boardContainerEl.style.height = 'auto';
    boardContainerEl.style.aspectRatio = '1 / 1';
    boardContainerEl.style.minHeight = '0';
  } else if (width >= 1120) {
    rootLayout.style.gridTemplateColumns = '260px 270px minmax(520px, 1fr)';
    rootLayout.style.columnGap = '14px';

    leftColumn.style.minWidth = '260px';
    chatColumn.style.minWidth = '270px';

    boardContainerEl.style.width = '100%';
    boardContainerEl.style.maxWidth = '740px';
    boardContainerEl.style.height = 'auto';
    boardContainerEl.style.aspectRatio = '1 / 1';
    boardContainerEl.style.minHeight = '0';
  } else {
    rootLayout.style.gridTemplateColumns = '1fr';
    rootLayout.style.columnGap = '0';
    rootLayout.style.rowGap = '12px';

    leftColumn.style.minWidth = '0';
    chatColumn.style.minWidth = '0';

    leftColumn.style.order = '1';
    chatColumn.style.order = '2';
    centerColumn.style.order = '4';

    boardContainerEl.style.width = 'min(98vw, 82vh, 860px)';
    boardContainerEl.style.maxWidth = 'min(98vw, 82vh, 860px)';
    boardContainerEl.style.height = 'min(98vw, 82vh, 860px)';
    boardContainerEl.style.minHeight = '320px';
    boardContainerEl.style.margin = '0 auto';

    centerColumn.style.justifyContent = 'center';
    centerColumn.style.alignItems = 'flex-start';

    if (reviewPanelEl) {
      if (reviewPanelEl.parentElement !== rootLayout) {
        rootLayout.insertBefore(reviewPanelEl, centerColumn);
      }

      reviewPanelEl.style.order = '3';
      reviewPanelEl.style.position = 'relative';
      reviewPanelEl.style.right = 'auto';
      reviewPanelEl.style.top = 'auto';
      reviewPanelEl.style.left = 'auto';
      reviewPanelEl.style.width = 'min(92vw, 760px)';
      reviewPanelEl.style.margin = '0 auto';
      reviewPanelEl.style.display = 'grid';
      reviewPanelEl.style.gridTemplateColumns = '90px minmax(120px, 1fr) 150px 72px';
      reviewPanelEl.style.alignItems = 'center';
      reviewPanelEl.style.gap = '8px';
      reviewPanelEl.style.padding = '10px 12px';
      reviewPanelEl.style.boxSizing = 'border-box';
    }

    const reviewArrowWrap = document.getElementById('reviewArrowWrap');
    if (reviewArrowWrap) {
    reviewArrowWrap.style.display = 'grid';
    reviewArrowWrap.style.gridTemplateColumns = '1fr 1fr';
    reviewArrowWrap.style.gap = '8px';
    }

    const reviewTitleBlock = document.getElementById('reviewTitleBlock');
    if (reviewTitleBlock) {
      reviewTitleBlock.style.display = 'flex';
      reviewTitleBlock.style.flexDirection = 'column';
      reviewTitleBlock.style.alignItems = 'flex-start';
      reviewTitleBlock.style.justifyContent = 'center';
      reviewTitleBlock.style.height = '100%';
    }

    const reviewTitleText = document.getElementById('reviewTitleText');
    if (reviewTitleText) {
      reviewTitleText.style.fontSize = '16px';
      reviewTitleText.style.margin = '0';
      reviewTitleText.style.lineHeight = '1.1';
    }

    if (reviewIndexEl) {
      reviewIndexEl.style.textAlign = 'left';
      reviewIndexEl.style.fontSize = '14px';
      reviewIndexEl.style.marginTop = '6px';
      reviewIndexEl.style.alignSelf = 'start';
    }

    if (reviewBtn) reviewBtn.style.height = '44px';
    if (reviewPrevBtn) {
      reviewPrevBtn.style.height = '44px';
      reviewPrevBtn.style.width = '100%';
    }
    if (reviewNextBtn) {
      reviewNextBtn.style.height = '44px';
      reviewNextBtn.style.width = '100%';
    }
    if (reviewResetGhostBtn) reviewResetGhostBtn.style.height = '44px';

    if (chatWrapEl) {
      chatWrapEl.style.height = '380px';
      chatWrapEl.style.minHeight = '300px';
      chatWrapEl.style.maxHeight = '380px';
    }

    positionHelpUI();
    resizeCanvas();
    return;
  }

  leftColumn.style.order = '1';
  chatColumn.style.order = '2';
  centerColumn.style.order = '3';

  if (reviewPanelEl) {
    if (reviewPanelEl.parentElement !== boardContainerEl) {
      boardContainerEl.appendChild(reviewPanelEl);
    }

    reviewPanelEl.style.order = '';
    reviewPanelEl.style.position = 'absolute';
    reviewPanelEl.style.right = '-240px';
    reviewPanelEl.style.top = '14px';
    reviewPanelEl.style.left = 'auto';
    reviewPanelEl.style.width = '180px';
    reviewPanelEl.style.margin = '0';
    reviewPanelEl.style.display = 'flex';
    reviewPanelEl.style.flexDirection = 'column';
    reviewPanelEl.style.gridTemplateColumns = 'none';
    reviewPanelEl.style.alignItems = 'stretch';
    reviewPanelEl.style.gap = '10px';
    reviewPanelEl.style.padding = '14px';
    reviewPanelEl.style.boxSizing = 'border-box';
  }

  const reviewTitleBlock = document.getElementById('reviewTitleBlock');
  if (reviewTitleBlock) {
    reviewTitleBlock.style.display = 'flex';
    reviewTitleBlock.style.flexDirection = 'column';
    reviewTitleBlock.style.alignItems = 'flex-start';
  }

  const reviewTitleText = document.getElementById('reviewTitleText');
  if (reviewTitleText) {
    reviewTitleText.style.fontSize = '18px';
  }

  if (reviewIndexEl) {
    reviewIndexEl.style.textAlign = 'left';
    reviewIndexEl.style.fontSize = '13px';
    reviewIndexEl.style.marginTop = '6px';
  }

  const reviewArrowWrap = document.getElementById('reviewArrowWrap');
  if (reviewArrowWrap) {
    reviewArrowWrap.style.display = 'flex';
    reviewArrowWrap.style.gap = '8px';
  }

  if (chatWrapEl) {
    chatWrapEl.style.height = `min(calc(100vh - 28px), ${Math.max(560, height - 32)}px)`;
    chatWrapEl.style.minHeight = '520px';
    chatWrapEl.style.maxHeight = '980px';
  }

  positionHelpUI();
  resizeCanvas();
}

function ensureChatUI() {
  if (chatWrapEl) return;

  ensureLayout();

  chatWrapEl = document.createElement('div');
  chatWrapEl.id = 'chatWrap';
  chatWrapEl.style.width = '100%';
  chatWrapEl.style.background = 'rgba(20, 25, 45, 0.85)';
  chatWrapEl.style.border = '1px solid rgba(255,255,255,0.08)';
  chatWrapEl.style.borderRadius = '18px';
  chatWrapEl.style.padding = '14px';
  chatWrapEl.style.boxSizing = 'border-box';
  chatWrapEl.style.boxShadow = '0 8px 30px rgba(0,0,0,0.18)';
  chatWrapEl.style.display = 'flex';
  chatWrapEl.style.flexDirection = 'column';
  chatWrapEl.style.height = 'calc(100vh - 28px)';
  chatWrapEl.style.minHeight = '520px';

  chatWrapEl.innerHTML = `
    <div style="font-weight:700; margin-bottom:10px; color:#ffffff; font-size:22px;">실시간 채팅</div>

    <div
      id="chatMessages"
      style="
        flex:1 1 auto;
        overflow-y:auto;
        border:1px solid rgba(255,255,255,0.10);
        border-radius:16px;
        background:#ffffff;
        padding:8px 10px;
        box-sizing:border-box;
        min-height:0;
      "
    ></div>

    <div
      style="
        display:flex;
        align-items:center;
        gap:8px;
        margin-top:10px;
        width:100%;
        flex:0 0 auto;
      "
    >
      <input
        id="chatInput"
        type="text"
        maxlength="300"
        placeholder="메시지 입력"
        style="
          flex:1 1 auto;
          width:100%;
          min-width:0;
          height:44px;
          padding:0 14px;
          border:1px solid rgba(255,255,255,0.14);
          border-radius:14px;
          background:#ffffff;
          color:#111111;
          font-size:14px;
          outline:none;
          box-sizing:border-box;
        "
      />
      <button
        id="chatSendBtn"
        style="
          width:44px;
          min-width:44px;
          height:44px;
          border:none;
          border-radius:14px;
          background:#cfd6ea;
          color:#1f2430;
          font-size:18px;
          font-weight:700;
          cursor:pointer;
          flex:0 0 auto;
        "
        title="전송"
      >↑</button>
    </div>
  `;

  chatColumn.appendChild(chatWrapEl);

  chatMessagesEl = document.getElementById('chatMessages');
  chatInputEl = document.getElementById('chatInput');
  chatSendBtn = document.getElementById('chatSendBtn');

  chatInputEl.disabled = true;
  chatSendBtn.disabled = true;

  chatSendBtn.addEventListener('click', sendChat);
  chatInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });
}

function positionHelpUI() {
  if (!helpButtonEl || !helpPopupEl || !sidebarAnchorEl) return;

  const mobile = window.innerWidth < 1120;

  if (mobile) {
    helpButtonEl.style.left = '8px';
    helpButtonEl.style.top = '8px';

    helpPopupEl.style.left = '8px';
    helpPopupEl.style.top = '50px';
    helpPopupEl.style.width = 'min(420px, calc(100vw - 32px))';
    return;
  }

  helpButtonEl.style.left = '-6px';
  helpButtonEl.style.top = '-6px';

  helpPopupEl.style.left = '38px';
  helpPopupEl.style.top = '-2px';
  helpPopupEl.style.width = '380px';
}

function ensureHelpUI() {
  if (helpButtonEl) return;

  if (!sidebarAnchorEl) ensureLayout();
  if (!sidebarAnchorEl) return;

  helpButtonEl = document.createElement('button');
  helpButtonEl.id = 'helpButton';
  helpButtonEl.textContent = '?';
  helpButtonEl.style.position = 'absolute';
  helpButtonEl.style.width = '34px';
  helpButtonEl.style.height = '34px';
  helpButtonEl.style.borderRadius = '50%';
  helpButtonEl.style.border = '1px solid rgba(0,0,0,0.12)';
  helpButtonEl.style.background = 'rgba(255,255,255,0.94)';
  helpButtonEl.style.fontWeight = '800';
  helpButtonEl.style.fontSize = '20px';
  helpButtonEl.style.cursor = 'pointer';
  helpButtonEl.style.zIndex = '20';
  helpButtonEl.style.boxShadow = '0 4px 14px rgba(0,0,0,0.16)';
  helpButtonEl.style.display = 'flex';
  helpButtonEl.style.alignItems = 'center';
  helpButtonEl.style.justifyContent = 'center';
  helpButtonEl.style.lineHeight = '1';
  helpButtonEl.style.padding = '0';

  helpPopupEl = document.createElement('div');
  helpPopupEl.id = 'helpPopup';
  helpPopupEl.style.position = 'absolute';
  helpPopupEl.style.padding = '14px 16px';
  helpPopupEl.style.borderRadius = '14px';
  helpPopupEl.style.background = 'rgba(20,25,45,0.96)';
  helpPopupEl.style.color = '#fff';
  helpPopupEl.style.fontSize = '14px';
  helpPopupEl.style.lineHeight = '1.55';
  helpPopupEl.style.boxSizing = 'border-box';
  helpPopupEl.style.boxShadow = '0 8px 24px rgba(0,0,0,0.24)';
  helpPopupEl.style.zIndex = '20';
  helpPopupEl.style.display = 'none';
  helpPopupEl.innerHTML = `
    <div style="font-weight:800; margin-bottom:8px; font-size:15px;">Twixt 규칙</div>
    <div>
      1. 빨강은 위↔아래, 파랑은 왼쪽↔오른쪽을 잇는 것이 목표입니다.<br>
      2. 말은 자기 목표 방향의 반대쪽 테두리와 모서리에 둘 수 없습니다.<br>
      3. 같은 색 말이 체스 나이트 이동 거리면 자동으로 연결됩니다.<br>
      4. 서로 다른 색 링크는 교차할 수 없습니다.<br>
      5. 첫 수 직후 파랑은 스왑할 수 있습니다.
    </div>
  `;

  sidebarAnchorEl.appendChild(helpButtonEl);
  sidebarAnchorEl.appendChild(helpPopupEl);

  helpButtonEl.addEventListener('click', (e) => {
    e.stopPropagation();
    helpPopupEl.style.display = helpPopupEl.style.display === 'none' ? 'block' : 'none';
  });

  document.addEventListener('click', (e) => {
    if (!helpPopupEl || !helpButtonEl) return;
    if (helpPopupEl.style.display === 'none') return;
    if (helpPopupEl.contains(e.target) || helpButtonEl.contains(e.target)) return;
    helpPopupEl.style.display = 'none';
  });

  positionHelpUI();
}

function ensureReviewUI() {
  if (reviewPanelEl) return;
  if (!boardContainerEl) ensureLayout();
  if (!boardContainerEl) return;

  reviewPanelEl = document.createElement('div');
  reviewPanelEl.id = 'reviewPanel';
  reviewPanelEl.style.position = 'absolute';
  reviewPanelEl.style.right = '-240px';
  reviewPanelEl.style.top = '14px';
  reviewPanelEl.style.width = '180px';
  reviewPanelEl.style.background = 'rgba(20,25,45,0.92)';
  reviewPanelEl.style.border = '1px solid rgba(255,255,255,0.10)';
  reviewPanelEl.style.borderRadius = '16px';
  reviewPanelEl.style.padding = '14px';
  reviewPanelEl.style.boxSizing = 'border-box';
  reviewPanelEl.style.boxShadow = '0 8px 24px rgba(0,0,0,0.18)';
  reviewPanelEl.style.zIndex = '5';
  reviewPanelEl.style.display = 'flex';
  reviewPanelEl.style.flexDirection = 'column';
  reviewPanelEl.style.gap = '10px';

  reviewPanelEl.innerHTML = `
  <div id="reviewTitleBlock" style="display:flex; flex-direction:column; align-items:flex-start; justify-content:center;">
    <div id="reviewTitleText" style="color:#ffffff; font-size:18px; font-weight:800; line-height:1.1;">복기</div>
    <div id="reviewIndexEl" style="color:#d7def0; font-size:13px; text-align:left; margin-top:6px;">0 / 0</div>
  </div>
  <button id="reviewBtn">복기하기</button>
  <div id="reviewArrowWrap" style="display:flex; gap:8px;">
    <button id="reviewPrevBtn" style="flex:1;">←</button>
    <button id="reviewNextBtn" style="flex:1;">→</button>
  </div>
  <button id="reviewResetGhostBtn">초기화</button>
`;

  boardContainerEl.appendChild(reviewPanelEl);

  reviewBtn = document.getElementById('reviewBtn');
  reviewPrevBtn = document.getElementById('reviewPrevBtn');
  reviewNextBtn = document.getElementById('reviewNextBtn');
  reviewResetGhostBtn = document.getElementById('reviewResetGhostBtn');
  reviewIndexEl = document.getElementById('reviewIndexEl');

  for (const btn of [reviewBtn, reviewPrevBtn, reviewNextBtn, reviewResetGhostBtn]) {
    btn.style.height = '46px';
    btn.style.border = 'none';
    btn.style.borderRadius = '12px';
    btn.style.fontSize = '15px';
    btn.style.fontWeight = '700';
    btn.style.cursor = 'pointer';
    btn.style.background = '#d9e1f2';
    btn.style.color = '#1f2430';
    btn.style.boxSizing = 'border-box';
    btn.style.width = '100%';
  }

  reviewBtn.addEventListener('click', toggleReviewMode);
  reviewPrevBtn.addEventListener('click', () => stepReview(-1));
  reviewNextBtn.addEventListener('click', () => stepReview(1));
  reviewResetGhostBtn.addEventListener('click', resetReviewGhost);

  applyResponsiveLayout();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}
window.addEventListener('resize', resizeCanvas);

function getBoardMetrics() {
  const size = state?.boardSize || BOARD_SIZE;
  const w = canvas.getBoundingClientRect().width;
  const h = canvas.getBoundingClientRect().height;
  const pad = Math.max(18, Math.min(36, Math.floor(Math.min(w, h) * 0.04)));
  const cell = (Math.min(w, h) - pad * 2) / (size - 1);
  return { size, w, h, pad, cell };
}

function pegToPixel(x, y) {
  const { pad, cell } = getBoardMetrics();
  return { px: pad + x * cell, py: pad + y * cell };
}

function isCorner(x, y, size = BOARD_SIZE) {
  return (
    (x === 0 && y === 0) ||
    (x === 0 && y === size - 1) ||
    (x === size - 1 && y === 0) ||
    (x === size - 1 && y === size - 1)
  );
}

function isInOpponentBorder(color, x, y) {
  if (color === 'red') {
    return x === 0 || x === BOARD_SIZE - 1;
  }
  return y === 0 || y === BOARD_SIZE - 1;
}

function pegAt(roomOrSnapshot, x, y) {
  return (roomOrSnapshot?.pegs || []).find((p) => p.x === x && p.y === y) || null;
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

function autoAddLinksToState(targetState, newPeg) {
  const sameColorPegs = targetState.pegs.filter(
    (p) => p.color === newPeg.color && !(p.x === newPeg.x && p.y === newPeg.y)
  );

  for (const peg of sameColorPegs) {
    if (!knightMove(newPeg, peg)) continue;

    const candidate = {
      a: { x: newPeg.x, y: newPeg.y },
      b: { x: peg.x, y: peg.y },
      color: newPeg.color,
    };

    if (linkExistsInSet(targetState.links, candidate.a, candidate.b, newPeg.color)) continue;
    if (linkWouldCrossAgainst(targetState.links, candidate)) continue;

    targetState.links.push(candidate);
  }
}

function buildAdjacency(snapshot, color) {
  const adj = new Map();

  for (const peg of snapshot.pegs.filter((p) => p.color === color)) {
    adj.set(`${peg.x},${peg.y}`, []);
  }

  for (const link of snapshot.links.filter((l) => l.color === color)) {
    const a = `${link.a.x},${link.a.y}`;
    const b = `${link.b.x},${link.b.y}`;
    if (adj.has(a) && adj.has(b)) {
      adj.get(a).push(b);
      adj.get(b).push(a);
    }
  }

  return adj;
}

function hasWinningPath(snapshot, color) {
  const adj = buildAdjacency(snapshot, color);
  const queue = [];
  const seen = new Set();

  for (const peg of snapshot.pegs.filter((p) => p.color === color)) {
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

function buildDisplaySnapshot() {
  if (!state) return null;

  if (!state.reviewMode || !state.reviewSnapshot) {
    return {
      pegs: state.pegs || [],
      links: state.links || [],
      turn: state.turn,
      winner: state.winner,
      lastMove: state.lastMove,
    };
  }

  return {
    pegs: [...deepCopy(state.reviewSnapshot.pegs || []), ...deepCopy(state.reviewGhostPegs || [])],
    links: [...deepCopy(state.reviewSnapshot.links || []), ...deepCopy(state.reviewGhostLinks || [])],
    turn: state.reviewSnapshot.turn,
    winner: state.reviewSnapshot.winner,
    lastMove: state.reviewSnapshot.lastMove,
  };
}

function getCurrentReviewNextColor() {
  if (!state?.reviewMode) return null;
  if (state.reviewGhostPegs?.length > 0) {
    const lastGhost = state.reviewGhostPegs[state.reviewGhostPegs.length - 1];
    return lastGhost.color === 'red' ? 'blue' : 'red';
  }
  return state.reviewNextColor || state.reviewSnapshot?.turn || 'red';
}

function drawBoardFrame() {
  const snapshot = buildDisplaySnapshot();
  const { w, h, pad, cell, size } = getBoardMetrics();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = COLORS.board;
  ctx.fillRect(0, 0, w, h);

  const edge = pad + cell * 0.5;

  const activeTurn = state?.reviewMode ? getCurrentReviewNextColor() : snapshot?.turn;
  const redFill = activeTurn === 'red' ? COLORS.redFillActive : COLORS.redFillSoft;
  const blueFill = activeTurn === 'blue' ? COLORS.blueFillActive : COLORS.blueFillSoft;

  ctx.fillStyle = redFill;
  ctx.fillRect(0, 0, w, edge);
  ctx.fillRect(0, h - edge, w, edge);

  ctx.fillStyle = blueFill;
  ctx.fillRect(0, 0, edge, h);
  ctx.fillRect(w - edge, 0, edge, h);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isCorner(x, y, size)) continue;
      const { px, py } = pegToPixel(x, y);
      ctx.beginPath();
      ctx.arc(px, py, Math.max(2.5, Math.min(3.6, cell * 0.09)), 0, Math.PI * 2);
      ctx.fillStyle = COLORS.hole;
      ctx.fill();
    }
  }
}

function drawLinks() {
  const snapshot = buildDisplaySnapshot();
  if (!snapshot) return;

  const baseLinks = state?.reviewMode
    ? (state.reviewSnapshot?.links || [])
    : (snapshot.links || []);

  const ghostLinks = state?.reviewMode ? (state.reviewGhostLinks || []) : [];

  for (const link of baseLinks) {
    const a = pegToPixel(link.a.x, link.a.y);
    const b = pegToPixel(link.b.x, link.b.y);

    ctx.beginPath();
    ctx.moveTo(a.px, a.py);
    ctx.lineTo(b.px, b.py);
    ctx.strokeStyle = link.color === 'red' ? COLORS.red : COLORS.blue;
    ctx.lineWidth = Math.max(4, Math.min(8, getBoardMetrics().cell * 0.22));
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  for (const link of ghostLinks) {
    const a = pegToPixel(link.a.x, link.a.y);
    const b = pegToPixel(link.b.x, link.b.y);

    ctx.beginPath();
    ctx.moveTo(a.px, a.py);
    ctx.lineTo(b.px, b.py);
    ctx.strokeStyle = link.color === 'red' ? COLORS.redGhostStroke : COLORS.blueGhostStroke;
    ctx.lineWidth = Math.max(4, Math.min(8, getBoardMetrics().cell * 0.22));
    ctx.lineCap = 'round';
    ctx.setLineDash([7, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawPegs() {
  const snapshot = buildDisplaySnapshot();
  if (!snapshot) return;

  const basePegs = state?.reviewMode
    ? (state.reviewSnapshot?.pegs || [])
    : (snapshot.pegs || []);

  const ghostPegs = state?.reviewMode ? (state.reviewGhostPegs || []) : [];

  const r = Math.max(6, Math.min(10, getBoardMetrics().cell * 0.28));

  for (const peg of basePegs) {
    const { px, py } = pegToPixel(peg.x, peg.y);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = peg.color === 'red' ? COLORS.red : COLORS.blue;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  for (const peg of ghostPegs) {
    const { px, py } = pegToPixel(peg.x, peg.y);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = peg.color === 'red' ? COLORS.redGhost : COLORS.blueGhost;
    ctx.fill();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawLatestMoveMarker() {
  const snapshot = buildDisplaySnapshot();
  if (!snapshot?.lastMove) return;
  const { px, py } = pegToPixel(snapshot.lastMove.x, snapshot.lastMove.y);

  ctx.beginPath();
  ctx.arc(px, py, Math.max(3, Math.min(4.5, getBoardMetrics().cell * 0.12)), 0, Math.PI * 2);
  ctx.fillStyle = COLORS.latest;
  ctx.fill();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawStatusText() {
  const snapshot = buildDisplaySnapshot();
  const { w } = getBoardMetrics();

  ctx.fillStyle = COLORS.text;
  ctx.font = `bold ${Math.max(14, Math.min(18, getBoardMetrics().cell * 0.52))}px Arial`;
  ctx.fillText('Twixt', 14, 26);

  if (state?.reviewMode) {
    ctx.fillStyle = COLORS.text;
    ctx.fillText('복기 중', w - 78, 26);
    return;
  }

  if (snapshot?.winner) {
    ctx.fillStyle = snapshot.winner === 'red' ? COLORS.redActive : COLORS.blueActive;
    ctx.fillText(`${snapshot.winner.toUpperCase()} 승리`, w - 110, 26);
  }
}

function draw() {
  drawBoardFrame();
  drawLinks();
  drawPegs();
  drawLatestMoveMarker();
  drawStatusText();
}

function nearestCell(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const { size, pad, cell } = getBoardMetrics();

  const gx = Math.round((x - pad) / cell);
  const gy = Math.round((y - pad) / cell);

  if (gx < 0 || gy < 0 || gx >= size || gy >= size) return null;
  return { x: gx, y: gy };
}

function resetPendingSurrenderConfirm() {
  pendingSurrenderConfirm = false;
}

function renderAll() {
  updatePanel();
  draw();
  renderChat();
}

function isOnlineMode() {
  return currentMode === 'online';
}

function isLocalMode() {
  return currentMode === 'local';
}

function refreshLocalDerivedState() {
  if (!state) return;
  state.canUndo = localHistory.length > 0;
  state.reviewTotal = Math.max(0, localTimeline.length - 1);

  if (state.reviewMode) {
    state.reviewIndex = Math.max(0, Math.min(state.reviewIndex, localTimeline.length - 1));
    state.reviewSnapshot = deepCopy(localTimeline[state.reviewIndex]);
  } else {
    state.reviewIndex = Math.max(0, localTimeline.length - 1);
    state.reviewSnapshot = null;
  }
}

function clearLocalPendingRequests() {
  state.pendingUndoBy = null;
  state.pendingRestartBy = null;
}

function pushLocalTimeline() {
  localTimeline.push(createSnapshotFromState(state));
  state.reviewIndex = localTimeline.length - 1;
  state.reviewGhostPegs = [];
  state.reviewGhostLinks = [];
  state.reviewNextColor = state.turn || 'red';
  refreshLocalDerivedState();
}

function beginLocalMode() {
  currentMode = 'local';
  roomId = 'local';
  hasJoined = true;
  myRole = 'local';
  state = createInitialState();
  localHistory = [];
  localTimeline = [createSnapshotFromState(state)];
  refreshLocalDerivedState();

  joinBtn.disabled = true;
  roomInput.disabled = true;
  nameInput.disabled = true;
  localModeBtn.disabled = true;

  if (chatInputEl && chatSendBtn) {
    chatInputEl.disabled = true;
    chatSendBtn.disabled = true;
  }

  resetPendingSurrenderConfirm();
  myRoleEl.textContent = 'LOCAL';
  renderAll();
  resizeCanvas();
}

function localPlacePeg(x, y) {
  if (!state || state.winner || state.reviewMode) return;
  const color = state.turn;

  if (!Number.isInteger(x) || !Number.isInteger(y)) return;
  if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return;
  if (isCorner(x, y)) return;
  if (pegAt(state, x, y)) return;
  if (isInOpponentBorder(color, x, y)) return;

  localHistory.push(createSnapshotFromState(state));
  clearLocalPendingRequests();
  state.reviewMode = false;
  state.reviewSnapshot = null;
  state.reviewGhostPegs = [];
  state.reviewGhostLinks = [];

  const peg = { x, y, color };
  state.pegs.push(peg);
  autoAddLinksToState(state, peg);
  state.moveCount += 1;
  state.canSwap = state.moveCount === 1;
  state.lastMove = { x, y, color };

  if (hasWinningPath(state, color)) {
    state.winner = color;
  } else {
    state.turn = color === 'red' ? 'blue' : 'red';
  }

  pushLocalTimeline();
  renderAll();
}

function localSwapSides() {
  if (!state || state.winner || state.reviewMode || !state.canSwap || state.moveCount !== 1) return;

  localHistory.push(createSnapshotFromState(state));
  clearLocalPendingRequests();

  state.pegs = state.pegs.map((p) => ({
    ...p,
    color: p.color === 'red' ? 'blue' : 'red',
  }));

  state.links = state.links.map((l) => ({
    ...l,
    color: l.color === 'red' ? 'blue' : 'red',
  }));

  if (state.lastMove) {
    state.lastMove = {
      ...state.lastMove,
      color: state.lastMove.color === 'red' ? 'blue' : 'red',
    };
  }

  state.turn = 'red';
  state.canSwap = false;

  pushLocalTimeline();
  renderAll();
}

function localUndo() {
  if (!state || state.reviewMode || localHistory.length === 0) return;

  const snapshot = localHistory.pop();
  const restored = createSnapshotFromState(snapshot);

  state.turn = restored.turn;
  state.winner = restored.winner;
  state.pegs = restored.pegs;
  state.links = restored.links;
  state.moveCount = restored.moveCount;
  state.canSwap = restored.canSwap;
  state.lastMove = restored.lastMove;
  state.reviewMode = false;
  state.reviewSnapshot = null;
  state.reviewGhostPegs = [];
  state.reviewGhostLinks = [];
  state.reviewNextColor = state.turn || 'red';
  clearLocalPendingRequests();

  if (localTimeline.length > 1) {
    localTimeline.pop();
  } else {
    localTimeline = [createSnapshotFromState(state)];
  }

  refreshLocalDerivedState();
  renderAll();
}

function localRestart() {
  state = createInitialState();
  localHistory = [];
  localTimeline = [createSnapshotFromState(state)];
  myRole = 'local';
  resetPendingSurrenderConfirm();
  refreshLocalDerivedState();
  renderAll();
}

function localSurrender() {
  if (!state || state.winner || state.reviewMode) return;

  localHistory.push(createSnapshotFromState(state));
  clearLocalPendingRequests();
  state.winner = state.turn === 'red' ? 'blue' : 'red';

  pushLocalTimeline();
  resetPendingSurrenderConfirm();
  renderAll();
}

function localStartReview() {
  if (!state?.winner) return;
  state.reviewMode = true;
  state.reviewIndex = localTimeline.length - 1;
  state.reviewGhostPegs = [];
  state.reviewGhostLinks = [];
  state.reviewNextColor = state.reviewSnapshot?.turn || state.turn || 'red';
  refreshLocalDerivedState();
  renderAll();
}

function localStopReview() {
  if (!state) return;
  state.reviewMode = false;
  state.reviewGhostPegs = [];
  state.reviewGhostLinks = [];
  state.reviewSnapshot = null;
  state.reviewIndex = localTimeline.length - 1;
  state.reviewNextColor = state.turn || 'red';
  refreshLocalDerivedState();
  renderAll();
}

function localStepReview(delta) {
  if (!state?.reviewMode) return;
  state.reviewIndex = Math.max(0, Math.min(localTimeline.length - 1, state.reviewIndex + delta));
  state.reviewGhostPegs = [];
  state.reviewGhostLinks = [];
  refreshLocalDerivedState();
  state.reviewNextColor = state.reviewSnapshot?.turn || 'red';
  renderAll();
}

function autoAddLocalReviewGhostLinks(newPeg) {
  const combinedLinks = [...deepCopy(state.reviewSnapshot.links || []), ...deepCopy(state.reviewGhostLinks || [])];
  const combinedPegs = [...deepCopy(state.reviewSnapshot.pegs || []), ...deepCopy(state.reviewGhostPegs || [])];

  const sameColorPegs = combinedPegs.filter(
    (p) => p.color === newPeg.color && !(p.x === newPeg.x && p.y === newPeg.y)
  );

  for (const peg of sameColorPegs) {
    if (!knightMove(newPeg, peg)) continue;

    const candidate = {
      a: { x: newPeg.x, y: newPeg.y },
      b: { x: peg.x, y: peg.y },
      color: newPeg.color,
      ghost: true,
    };

    if (linkExistsInSet(combinedLinks, candidate.a, candidate.b, newPeg.color)) continue;
    if (linkWouldCrossAgainst(combinedLinks, candidate)) continue;

    state.reviewGhostLinks.push(candidate);
    combinedLinks.push(candidate);
  }
}

function localResetReviewGhost() {
  if (!state?.reviewMode) return;
  state.reviewGhostPegs = [];
  state.reviewGhostLinks = [];
  state.reviewNextColor = state.reviewSnapshot?.turn || 'red';
  renderAll();
}

function localPlaceReviewGhost(x, y) {
  if (!state?.reviewMode) return;
  const snapshot = state.reviewSnapshot;
  if (!snapshot) return;

  const combinedPegs = [...deepCopy(snapshot.pegs || []), ...deepCopy(state.reviewGhostPegs || [])];
  if (!Number.isInteger(x) || !Number.isInteger(y)) return;
  if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return;
  if (isCorner(x, y)) return;
  if (pegAt({ pegs: combinedPegs }, x, y)) return;

  const ghostColor = getCurrentReviewNextColor() || snapshot.turn || 'red';
  if (isInOpponentBorder(ghostColor, x, y)) return;

  const newGhost = { x, y, color: ghostColor, ghost: true };
  state.reviewGhostPegs.push(newGhost);
  autoAddLocalReviewGhostLinks(newGhost);
  state.reviewNextColor = ghostColor === 'red' ? 'blue' : 'red';

  renderAll();
}

canvas.addEventListener('click', (e) => {
  if (!state) return;

  const cell = nearestCell(e.clientX, e.clientY);
  if (!cell) return;

  if (state.reviewMode) {
    if (isOnlineMode()) {
      socket.emit('place-review-ghost', { roomId, x: cell.x, y: cell.y });
    } else if (isLocalMode()) {
      localPlaceReviewGhost(cell.x, cell.y);
    }
    return;
  }

  if (isLocalMode()) {
    localPlacePeg(cell.x, cell.y);
    return;
  }

  if (!roomId) return;
  if (myRole === 'spectator' || myRole === 'none') return;
  if (!state.players.red || !state.players.blue) return;
  if (state.winner) return;
  if (state.turn !== myRole) return;

  socket.emit('place-peg', { roomId, x: cell.x, y: cell.y });
});

joinBtn.addEventListener('click', () => {
  if (hasJoined) return;
  currentMode = 'online';
  roomId = roomInput.value.trim() || 'room1';
  socket.emit('join-room', { roomId, name: nameInput.value.trim() || 'Player' });
});

localModeBtn.addEventListener('click', () => {
  if (hasJoined) return;
  beginLocalMode();
});

swapBtn.addEventListener('click', () => {
  if (isLocalMode()) {
    localSwapSides();
    return;
  }
  if (!roomId) return;
  socket.emit('swap-sides', { roomId });
});

undoBtn.addEventListener('click', () => {
  resetPendingSurrenderConfirm();

  if (isLocalMode()) {
    localUndo();
    return;
  }
  if (!roomId) return;
  socket.emit('request-undo', { roomId });
});

restartBtn.addEventListener('click', () => {
  resetPendingSurrenderConfirm();

  if (isLocalMode()) {
    localRestart();
    return;
  }
  if (!roomId) return;
  socket.emit('request-restart', { roomId });
});

surrenderBtn.addEventListener('click', () => {
  if (!state) return;
  if (state.winner || state.reviewMode) return;

  if (!pendingSurrenderConfirm) {
    pendingSurrenderConfirm = true;
    updatePanel();
    return;
  }

  pendingSurrenderConfirm = false;

  if (isLocalMode()) {
    localSurrender();
    return;
  }

  if (!roomId) return;
  socket.emit('surrender-game', { roomId });
});

function toggleReviewMode() {
  if (!state?.winner) return;
  resetPendingSurrenderConfirm();

  if (isLocalMode()) {
    if (state.reviewMode) {
      localStopReview();
    } else {
      localStartReview();
    }
    return;
  }

  if (!roomId) return;

  if (state.reviewMode) {
    socket.emit('stop-review', { roomId });
  } else {
    socket.emit('start-review', { roomId });
  }
}

function stepReview(delta) {
  resetPendingSurrenderConfirm();
  if (!state?.reviewMode) return;

  if (isLocalMode()) {
    localStepReview(delta);
    return;
  }

  if (!roomId) return;
  socket.emit('step-review', { roomId, delta });
}

function resetReviewGhost() {
  if (!state?.reviewMode) return;

  if (isLocalMode()) {
    localResetReviewGhost();
    return;
  }

  if (!roomId) return;
  socket.emit('reset-review-ghost', { roomId });
}

function sendChat() {
  if (!roomId || !chatInputEl || !isOnlineMode()) return;
  const text = chatInputEl.value.trim();
  if (!text) return;
  socket.emit('send-chat', { roomId, text });
  chatInputEl.value = '';
}

socket.on('joined', ({ role, state: roomState }) => {
  currentMode = 'online';
  myRole = role;
  state = roomState;
  hasJoined = true;
  resetPendingSurrenderConfirm();

  joinBtn.disabled = true;
  roomInput.disabled = true;
  nameInput.disabled = true;
  localModeBtn.disabled = true;

  if (chatInputEl && chatSendBtn) {
    chatInputEl.disabled = false;
    chatSendBtn.disabled = false;
  }

  myRoleEl.textContent = role === 'spectator' ? '관전자' : role.toUpperCase();

  renderAll();
  resizeCanvas();
});

socket.on('state', (roomState) => {
  if (!isOnlineMode()) return;

  state = roomState;

  if (state.players.red?.socketId === socket.id) {
    myRole = 'red';
  } else if (state.players.blue?.socketId === socket.id) {
    myRole = 'blue';
  } else if (hasJoined) {
    myRole = 'spectator';
  }

  if (pendingSurrenderConfirm && (state.winner || state.reviewMode)) {
    pendingSurrenderConfirm = false;
  }

  myRoleEl.textContent = myRole === 'spectator' ? '관전자' : myRole.toUpperCase();

  renderAll();
});

function getTurnLabel() {
  if (state?.reviewMode) {
    const nextColor = getCurrentReviewNextColor();
    return nextColor === 'red' ? '빨강 반투명 말 차례' : '파랑 반투명 말 차례';
  }

  if (!state?.turn) return '-';
  return state.turn === 'red' ? '빨강 플레이어 차례' : '파랑 플레이어 차례';
}

function getRequesterName(role) {
  if (role === 'red') return state?.players?.red?.name || '빨강 플레이어';
  if (role === 'blue') return state?.players?.blue?.name || '파랑 플레이어';
  return '';
}

function renderChat() {
  if (!chatMessagesEl) return;

  const messages = state?.chatMessages || [];
  chatMessagesEl.innerHTML = messages
    .map((msg) => {
      const color =
        msg.role === 'red'
          ? COLORS.red
          : msg.role === 'blue'
          ? COLORS.blue
          : '#666';

      const timeText = new Date(msg.time).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });

      return `
        <div style="margin-bottom:1px; padding:2px 0 3px 0; border-bottom:1px solid #f2f2f2; line-height:1.08;">
          <div style="font-size:11px; color:${color}; font-weight:700; margin-bottom:1px;">
            ${escapeHtml(msg.name)} · ${timeText}
          </div>
          <div style="margin-top:0; white-space:pre-wrap; word-break:break-word; color:#111111; font-size:12px;">
            ${escapeHtml(msg.text)}
          </div>
        </div>
      `;
    })
    .join('');

  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function updateReviewPanel() {
  if (!reviewBtn || !reviewPrevBtn || !reviewNextBtn || !reviewResetGhostBtn || !reviewIndexEl) return;

  const canReview = !!state?.winner;
  const reviewMode = !!state?.reviewMode;
  const index = state?.reviewIndex ?? 0;
  const total = state?.reviewTotal ?? 0;

  reviewBtn.disabled = !canReview;
  reviewBtn.textContent = reviewMode ? '복기 종료' : '복기하기';

  reviewPrevBtn.disabled = !reviewMode || index <= 0;
  reviewNextBtn.disabled = !reviewMode || index >= total;
  reviewResetGhostBtn.disabled = !reviewMode;

  reviewIndexEl.textContent = `${index} / ${total}`;
  reviewPanelEl.style.opacity = canReview ? '1' : '0.72';
}

function updateSurrenderButton(canPlayNow) {
  if (!surrenderBtn) return;

  surrenderBtn.disabled = !canPlayNow;

  if (pendingSurrenderConfirm && canPlayNow) {
    surrenderBtn.textContent = '정말 항복하시겠습니까?';
  } else {
    pendingSurrenderConfirm = false;
    surrenderBtn.textContent = '항복';
  }
}

function updatePanel() {
  if (!state) return;

  const turnLabel = getTurnLabel();
  const activeColor = state.reviewMode ? getCurrentReviewNextColor() : state.turn;
  const turnColor =
    activeColor === 'red'
      ? COLORS.redActive
      : activeColor === 'blue'
      ? COLORS.blueActive
      : '#ffffff';

  redPlayerEl.textContent = isLocalMode() ? 'RED' : state.players.red?.name || '대기 중';
  bluePlayerEl.textContent = isLocalMode() ? 'BLUE' : state.players.blue?.name || '대기 중';

  turnTextEl.textContent = state.reviewMode
    ? (getCurrentReviewNextColor() || '-').toUpperCase()
    : (state.turn ? state.turn.toUpperCase() : '-');

  turnBadgeEl.innerHTML = `
    <span style="color:#ffffff; font-weight:800;">현재 턴:</span>
    <span style="color:${turnColor}; font-weight:400;"> ${turnLabel}</span>
  `;

  if ([joinBtn, localModeBtn, swapBtn, undoBtn, surrenderBtn, restartBtn].every(Boolean)) {
    for (const btn of [joinBtn, localModeBtn, swapBtn, undoBtn, surrenderBtn, restartBtn]) {
      ensureBaseButtonStyle(btn);
    }
  }

  const canLocalAct = isLocalMode() && !state.winner && !state.reviewMode;
  const canRequestSharedAction =
    isOnlineMode()
      ? !!state.players.red && !!state.players.blue && myRole !== 'spectator' && myRole !== 'none' && !state.reviewMode
      : canLocalAct;

  if (isLocalMode()) {
    swapBtn.disabled = !(state.canSwap && state.moveCount === 1);
    undoBtn.disabled = !state.canUndo || state.reviewMode;
    restartBtn.disabled = false;
    updateSurrenderButton(canLocalAct);
  } else {
    swapBtn.disabled = !(state.canSwap && myRole === 'blue' && state.moveCount === 1 && !state.reviewMode);
    undoBtn.disabled = !canRequestSharedAction || !state.canUndo;
    restartBtn.disabled = !canRequestSharedAction;
    const canPlayNow =
      !!state.players.red &&
      !!state.players.blue &&
      myRole !== 'spectator' &&
      myRole !== 'none' &&
      !state.winner &&
      !state.reviewMode;
    updateSurrenderButton(canPlayNow);
  }

  if (isLocalMode()) {
    undoBtn.textContent = '무르기';
    restartBtn.textContent = '다시 시작';
    requestInfoEl.textContent = '';
  } else {
    if (state.pendingUndoBy) {
      const requester = getRequesterName(state.pendingUndoBy);
      if (state.pendingUndoBy === myRole) {
        undoBtn.textContent = '무르기 요청 보냄';
        requestInfoEl.textContent = `${requester} 님이 무르기를 요청했습니다. 상대 동의 대기 중`;
      } else {
        undoBtn.textContent = '무르기 요청 수락';
        requestInfoEl.textContent = `${requester} 님이 무르기를 요청했습니다. 버튼을 누르면 수락합니다`;
      }
    } else {
      undoBtn.textContent = '무르기 요청';
    }

    if (state.pendingRestartBy) {
      const requester = getRequesterName(state.pendingRestartBy);
      if (state.pendingRestartBy === myRole) {
        restartBtn.textContent = '다시 시작 요청 보냄';
        requestInfoEl.textContent = `${requester} 님이 다시 시작을 요청했습니다. 상대 동의 대기 중`;
      } else {
        restartBtn.textContent = '다시 시작 요청 수락';
        requestInfoEl.textContent = `${requester} 님이 다시 시작을 요청했습니다. 버튼을 누르면 수락합니다`;
      }
    } else {
      restartBtn.textContent = '다시 시작';
      if (!state.pendingUndoBy) requestInfoEl.textContent = '';
    }
  }

  if (state.reviewMode) {
    statusTextEl.textContent = '복기 모드';
    statusTextEl.style.fontWeight = '400';
    statusTextEl.style.color = '';
  } else if (state.winner) {
    statusTextEl.textContent = `${state.winner.toUpperCase()} 승리`;
    statusTextEl.style.fontWeight = '800';
    statusTextEl.style.color = state.winner === 'red' ? COLORS.redActive : COLORS.blueActive;
  } else if (isLocalMode()){
    statusTextEl.style.fontWeight = '400';
    statusTextEl.style.color = '';
  } else if (isLocalMode()) {
    statusTextEl.textContent = state.turn === 'red' ? '빨강 차례' : '파랑 차례';
  } else if (!state.players.red || !state.players.blue) {
    statusTextEl.textContent = '상대 플레이어를 기다리는 중';
  } else if (myRole === 'spectator') {
    statusTextEl.textContent = '관전 중';
  } else if (state.turn === myRole) {
    statusTextEl.textContent = '당신의 차례';
  } else {
    statusTextEl.textContent = '상대 차례';
  }

  updateReviewPanel();
}

ensureLayout();
ensureChatUI();
ensureHelpUI();
ensureReviewUI();
resizeCanvas();
renderChat();
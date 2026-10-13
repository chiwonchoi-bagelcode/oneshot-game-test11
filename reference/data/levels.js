/* 레벨 정의 — 식별자(id)가 키. 순서는 progression.js 가 소유한다.
   맵 문자: . 빈칸  # 벽  x 말라 있어야 하는 칸  r/y/b 잠든 씨앗
            R Y B O P G 목표색(그 칸이 최종적으로 그 색이어야 한다)
   팔레트: "R" 무한 번짐, "R2" 2칸만 번짐.  authoring.solution 은 검증용 저작 해법(t=틱). */
window.LEVELS = {
  'first-drop': {
    id: 'first-drop', title: '첫 방울',
    tutorial: '빈 칸을 눌러 잉크를 떨어뜨리세요. 잉크는 사방으로 번집니다. 표시된 칸을 그 색으로 물들이면 됩니다.',
    palette: ['R'],
    map: ['.....', '.....', '..R..', '.....', '.....'],
    authoring: { solution: [{ x: 0, y: 0, t: 0 }], intent: { difficulty: 'tutorial', introduces: ['drop', 'target'] } }
  },
  'two-sides': {
    id: 'two-sides', title: '양쪽',
    tutorial: '잉크가 두 개입니다. 아래 팔레트 순서대로 떨어집니다. 다른 색이 만나는 칸은 섞여서 굳고, 더는 번지지 않습니다.',
    palette: ['R', 'B'],
    map: ['.......', '.......', '.R...B.', '.......', '.......'],
    authoring: { solution: [{ x: 0, y: 2, t: 0 }, { x: 6, y: 2, t: 0 }], intent: { difficulty: 'tutorial', introduces: ['two-inks', 'boundary'] } }
  },
  'meet-green': {
    id: 'meet-green', title: '초록이 되는 곳',
    tutorial: '노랑과 파랑이 만나면 초록. 빨강+노랑=주황, 빨강+파랑=보라. 섞인 색은 두 잉크가 같은 순간에 닿은 칸에 생깁니다.',
    palette: ['Y', 'B'],
    map: ['.......', '...G...', '.Y.G.B.', '...G...', '.......'],
    authoring: { solution: [{ x: 0, y: 2, t: 0 }, { x: 6, y: 2, t: 0 }], intent: { difficulty: 'tutorial', introduces: ['mix'] } }
  },
  'walls-u': {
    id: 'walls-u', title: '벽 사이로',
    tutorial: '벽은 잉크를 막습니다. 잉크는 벽을 돌아서 번지므로 만나는 지점이 달라집니다.',
    palette: ['R', 'Y'],
    map: [
      '.......',
      '.#####.',
      '.#.O.#.',
      '.#R#Y#.',
      '.#.#.#.',
      '.#.#.#.',
      '...#...'
    ],
    authoring: { solution: [{ x: 1, y: 6, t: 0 }, { x: 5, y: 6, t: 0 }], intent: { difficulty: 'easy', introduces: ['walls'] } }
  },
  'short-ink': {
    id: 'short-ink', title: '짧은 잉크',
    tutorial: '팔레트의 숫자는 번지는 칸 수입니다. R2는 두 칸만 번지고 멈춥니다. 점선 칸(x)은 끝까지 말라 있어야 합니다.',
    palette: ['R2'],
    map: ['.......', '..xRx..', '.......', '.R...R.', '.......', '..xRx..', '.......'],
    authoring: { solution: [{ x: 3, y: 3, t: 0 }], intent: { difficulty: 'easy', introduces: ['range', 'dry'] } }
  },
  'wait-drop': {
    id: 'wait-drop', title: '기다렸다가',
    tutorial: '서두를 필요 없습니다. 잉크가 번지는 동안 기다렸다가 다음 방울을 떨어뜨리면 만나는 지점이 옮겨집니다. 아래 통로는 빨강이어야 합니다.',
    palette: ['R', 'B'],
    map: ['#########', '#RRRPBBB#', '####R####', '####R####', '#########'], tickMs: 700,
    authoring: { solution: [{ x: 3, y: 1, t: 0 }, { x: 5, y: 1, t: 1 }], intent: { difficulty: 'easy', introduces: ['timing'] } }
  },
  'sleeping-seed': {
    id: 'sleeping-seed', title: '잠든 씨앗',
    tutorial: '작은 점은 잠든 잉크입니다. 번져 온 잉크가 닿으면 깨어나 그 자리에서 자기 색으로 번지기 시작합니다.',
    palette: ['Y'],
    map: ['.......', '.......', 'YY.b..B', '.......', '.......'],
    authoring: { solution: [{ x: 0, y: 2, t: 0 }], intent: { difficulty: 'easy', introduces: ['seed'] } }
  },
  'three-inks': {
    id: 'three-inks', title: '세 갈래',
    tutorial: '세 잉크가 한 칸에 동시에 닿으면 검게 흐려집니다. 각 쌍이 만나는 자리를 따로 잡으세요.',
    palette: ['R', 'Y', 'B'],
    map: ['.......', '...O...', '.......', '.......', '.P...G.', '.......', '.......'],
    authoring: { solution: [{ x: 1, y: 1, t: 0 }, { x: 5, y: 1, t: 0 }, { x: 3, y: 5, t: 0 }], intent: { difficulty: 'normal', introduces: ['three-way'] } }
  },
  'dry-garden': {
    id: 'dry-garden', title: '마른 화단',
    tutorial: '',
    palette: ['Y2', 'B2'],
    map: ['x.......x', '..Y...B..', '.Y..G..B.', '..Y...B..', 'x...x...x'],
    authoring: { solution: [{ x: 3, y: 2, t: 0 }, { x: 5, y: 2, t: 0 }], intent: { difficulty: 'normal', introduces: [] } }
  },
  'seed-timing': {
    id: 'seed-timing', title: '깨우는 순서',
    tutorial: '',
    palette: ['R', 'Y2'],
    map: ['..O..G.', '....G..', '.PbG...', '.......', '....b..', '.......', '.......'], tickMs: 700,
    authoring: { solution: [{ x: 0, y: 0, t: 0 }, { x: 3, y: 0, t: 2 }], intent: { difficulty: 'hard', introduces: ['two-seeds'] } }
  },
  'corridor-lock': {
    id: 'corridor-lock', title: '잠긴 복도',
    tutorial: '',
    palette: ['R4', 'B4'],
    map: ['#########', '#...#B..#', '#.#.#.#.#', '#.#P..#.#', '#.#####.#', '#R..x...#', '#########'],
    authoring: { solution: [{ x: 1, y: 1, t: 0 }, { x: 5, y: 1, t: 0 }], intent: { difficulty: 'hard', introduces: [] } }
  },
  'finale': {
    id: 'finale', title: '밀물',
    tutorial: '',
    palette: ['R', 'Y3', 'B'],
    map: ['..O...G..', '.....Y...', '....G....', 'R...b...B', '.........', '...P.....', '.........'],
    authoring: { solution: [{ x: 0, y: 6, t: 0 }, { x: 4, y: 1, t: 0 }, { x: 8, y: 6, t: 0 }], intent: { difficulty: 'hard', introduces: [] } }
  }
};

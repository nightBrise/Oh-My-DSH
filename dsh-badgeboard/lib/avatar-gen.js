/**
 * 随机线稿漫画头像生成器
 * 
 * 纯 JS（ES2017+），无第三方依赖。
 * 所有图形在 24×24 viewBox 内，脸部居中（圆心约 (12,12)），
 * stroke 线宽 1.75，stroke-linecap round，fill none，单色。
 * 颜色由调用方通过 CSS stroke 控制，代码中不写颜色。
 * 
 * 导出：module.exports（嵌入动态插件时去掉 module.exports 行即可）
 */

'use strict';

// ──────────────────────────────────────────────
// FNV-1a 32 位哈希
// ──────────────────────────────────────────────

/**
 * FNV-1a 32 位哈希函数，返回无符号 32 位整数（确定性）。
 * @param {string} str - 输入字符串
 * @returns {number} 无符号 32 位整数
 */
function fnv1a(str) {
  var hash = 0x811c9dc5; // FNV offset basis
  for (var i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0; // FNV prime，>>> 0 保持无符号
  }
  return hash >>> 0;
}

// ──────────────────────────────────────────────
// 要素池（SVG path d 字符串数组）
// viewBox 24×24，脸中心约 (12,13)
// ──────────────────────────────────────────────

/** 脸型 4 种 */
var FACE_POOL = [
  // 0: 圆脸 — 完整圆形路径
  ['M19.5,13 A7.5,7.5 0 1,1 4.5,13 A7.5,7.5 0 1,1 19.5,13'],
  // 1: 方脸 — 圆角矩形，4.5,5.5 到 19.5,20.5 rx=3
  [
    'M7.5,5.5 Q4.5,5.5 4.5,8.5',
    'L4.5,17.5 Q4.5,20.5 7.5,20.5',
    'L16.5,20.5 Q19.5,20.5 19.5,17.5',
    'L19.5,8.5 Q19.5,5.5 16.5,5.5 Z'
  ],
  // 2: 鹅蛋脸 — 椭圆 cx12 cy13 rx6.5 ry8
  ['M18.5,13 A6.5,8 0 1,1 5.5,13 A6.5,8 0 1,1 18.5,13'],
  // 3: 长圆脸 — 椭圆 cx12 cy13.5 rx5.5 ry8.5
  ['M17.5,13.5 A5.5,8.5 0 1,1 6.5,13.5 A5.5,8.5 0 1,1 17.5,13.5']
];

/** 发型 8 种（覆盖头顶的弧线/发丝组合） */
var HAIR_POOL = [
  // 0: 短发齐耳 — 两条短弧贴两颊
  ['M5,10 Q4,8 6,6', 'M19,10 Q20,8 18,6'],
  // 1: 自然卷 — 头顶三个小弧
  ['M8,5 Q9,3 10,5', 'M11,4 Q12,2 13,4', 'M14,5 Q15,3 16,5'],
  // 2: 中分刘海 — 中线两侧两弧
  ['M12,5 Q9,3 6,5', 'M12,5 Q15,3 18,5'],
  // 3: 丸子头 — 头顶小圆 + 弧
  ['M12,2.5 a2.5,2.5 0 1,1 0,0.01', 'M7,6 Q12,3 17,6'],
  // 4: 双马尾 — 两侧各一束弧 + 小圆
  [
    'M5,9 Q3,12 4,15', 'M19,9 Q21,12 20,15',
    'M3.5,14.5 a1.2,1.2 0 1,1 0,0.01', 'M20.5,14.5 a1.2,1.2 0 1,1 0,0.01'
  ],
  // 5: 寸头 — 贴头皮的细密短弧
  [
    'M7,6.5 Q8,5.5 9,6.5', 'M10,5.5 Q11,4.5 12,5.5',
    'M13,5.5 Q14,4.5 15,5.5', 'M16,6.5 Q17,5.5 17.5,6.5'
  ],
  // 6: 波浪长发 — 两侧大波浪弧垂到下颌
  [
    'M5,7 Q4,10 5,13 Q6,16 5,19',
    'M19,7 Q20,10 19,13 Q18,16 19,19',
    'M6,5 Q9,3 12,4 Q15,3 18,5'
  ],
  // 7: 光头 — 无路径
  []
];

/** 眼睛 4 种（左右对称，y≈12，间距约 5-6px） */
var EYES_POOL = [
  // 0: 圆点眼 — 两个 r1.2 圆
  ['M9.4,12 a1.2,1.2 0 1,1 0,0.01', 'M14.6,12 a1.2,1.2 0 1,1 0,0.01'],
  // 1: 线眼 — 两条 2px 横线
  ['M8,12 L10,12', 'M14,12 L16,12'],
  // 2: 弯月笑眼 — 两条下弯弧
  ['M8.5,12 Q9.5,14 10.5,12', 'M13.5,12 Q14.5,14 15.5,12'],
  // 3: 垂眼 — 两条上弯弧
  ['M8.5,13 Q9.5,11 10.5,13', 'M13.5,13 Q14.5,11 15.5,13']
];

/** 眉毛 4 种（左右对称，y≈9） */
var BROWS_POOL = [
  // 0: 平眉 — 两条 3px 横线 y≈9
  ['M8.5,9 L11.5,9', 'M12.5,9 L15.5,9'],
  // 1: 挑眉 — 外高内低
  ['M8,8 L11,9.5', 'M16,8 L13,9.5'],
  // 2: 八字眉 — 内高外低
  ['M8.5,9.5 L11.5,8', 'M12.5,8 L15.5,9.5'],
  // 3: 无眉 — 空数组
  []
];

/** 嘴 4 种（居中 y≈16-17） */
var MOUTH_POOL = [
  // 0: 微笑 — 弧线
  ['M9.5,16 Q12,18 14.5,16'],
  // 1: 抿嘴 — 横线
  ['M10,16.5 L14,16.5'],
  // 2: 张嘴笑 — 小椭圆
  ['M12,16 a2,1.2 0 1,1 0,0.01'],
  // 3: 平线 — 横线
  ['M10,17 L14,17']
];

/** 附加特征 7 种 */
var ACCESSORY_POOL = [
  // 0: 无
  [],
  // 1: 圆框眼镜 — 两个圆 r2.6 y≈12 + 连接横线
  [
    'M7,12 a2.6,2.6 0 1,1 0,0.01',
    'M14.4,12 a2.6,2.6 0 1,1 0,0.01',
    'M9.6,12 L14.4,12'
  ],
  // 2: 单片眼镜 — 右眼单圆 r2.6 + 斜链线
  [
    'M14.4,12 a2.6,2.6 0 1,1 0,0.01',
    'M17,9.5 L14.4,12'
  ],
  // 3: 头戴耳机 — 头顶弧 + 两侧圆垫
  [
    'M5.5,10 Q5.5,4 12,3 Q18.5,4 18.5,10',
    'M4,10 a1.5,2 0 1,1 0,0.01',
    'M20,10 a1.5,2 0 1,1 0,0.01'
  ],
  // 4: 发簪 — 斜线穿过发髻位置
  ['M10,3 L14,5'],
  // 5: 雀斑 — 两颊各 2 个小点（极小圆）
  [
    'M8.5,13.5 a0.35,0.35 0 1,1 0,0.01',
    'M9,14.5 a0.35,0.35 0 1,1 0,0.01',
    'M15.5,13.5 a0.35,0.35 0 1,1 0,0.01',
    'M15,14.5 a0.35,0.35 0 1,1 0,0.01'
  ],
  // 6: 胡茬 — 下巴 3 条短斜线
  ['M10.5,19 L11,18', 'M12,19.5 L12,18.5', 'M13.5,19 L13,18']
];

/** 各池大小，用于 pickAvatar 取模 */
var POOL_SIZES = [
  FACE_POOL.length,      // 4
  HAIR_POOL.length,      // 8
  EYES_POOL.length,      // 4
  BROWS_POOL.length,     // 4
  MOUTH_POOL.length,     // 4
  ACCESSORY_POOL.length  // 7
];

// ──────────────────────────────────────────────
// pickAvatar — 通过哈希为每个要素选择索引
// ──────────────────────────────────────────────

/**
 * 根据 seed 字符串确定性地选择头像要素索引。
 * @param {string} seed - 种子字符串（如 'sa-a1f3'）
 * @returns {{ face: number, hair: number, eyes: number, brows: number, mouth: number, accessory: number }}
 */
function pickAvatar(seed) {
  var hash = fnv1a(seed);
  return {
    face:      hash        % POOL_SIZES[0],
    hair:      (hash >>> 3) % POOL_SIZES[1],
    eyes:      (hash >>> 7) % POOL_SIZES[2],
    brows:     (hash >>> 11) % POOL_SIZES[3],
    mouth:     (hash >>> 13) % POOL_SIZES[4],
    accessory: (hash >>> 17) % POOL_SIZES[5]
  };
}

// ──────────────────────────────────────────────
// avatarPaths — 根据 seed 和 density 返回 path 数组
// ──────────────────────────────────────────────

/**
 * 根据种子和密度返回 SVG path 描述数组。
 * @param {string} seed - 种子字符串
 * @param {'full'|'simple'|'symbol'} density - 密度级别
 * @returns {Array<{d: string}>} path 描述数组，供 React.createElement('path', {d}) 渲染
 */
function avatarPaths(seed, density) {
  var sel = pickAvatar(seed);
  var paths = [];

  // 共用辅助：将 d 字符串数组推入结果
  function pushPaths(arr) {
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].length > 0) {
        paths.push({ d: arr[i] });
      }
    }
  }

  if (density === 'symbol') {
    // symbol: 只画附加特征符号；无特征时只画脸型轮廓
    if (ACCESSORY_POOL[sel.accessory].length > 0) {
      pushPaths(ACCESSORY_POOL[sel.accessory]);
    } else {
      pushPaths(FACE_POOL[sel.face]);
    }
    return paths;
  }

  // full / simple 共有：脸型 + 发型 + 眼睛 + 嘴 + 附加特征
  pushPaths(FACE_POOL[sel.face]);
  pushPaths(HAIR_POOL[sel.hair]);
  pushPaths(EYES_POOL[sel.eyes]);

  if (density === 'full') {
    // full 额外加眉毛
    pushPaths(BROWS_POOL[sel.brows]);
  }
  // simple 不画眉毛（省略）

  pushPaths(MOUTH_POOL[sel.mouth]);
  pushPaths(ACCESSORY_POOL[sel.accessory]);

  return paths;
}

// ──────────────────────────────────────────────
// 导出（嵌入动态插件代码时去掉 module.exports 行即可）
// ──────────────────────────────────────────────
module.exports = {
  fnv1a: fnv1a,
  pickAvatar: pickAvatar,
  avatarPaths: avatarPaths
};

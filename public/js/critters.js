// Personajes dibujados con formas simples. Todo vectorial, cero descargas.

export const KINDS = ['ajolote', 'gato', 'conejo', 'oso', 'rana'];
export const KIND_NAMES = { ajolote: 'Ajolote', gato: 'Gato', conejo: 'Conejo', oso: 'Osito', rana: 'Rana' };
export const COLORS = ['#F2A3B6', '#EDB447', '#6FB3A3', '#E8704F', '#A99BD6', '#8FBDE3'];
export const COLOR_NAMES = ['rosa', 'mostaza', 'menta', 'tomate', 'lavanda', 'cielo'];

const INK = '#22283F';
const CHEEK = '#E8607A';
const CREAM = '#FFF7EA';

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(f).map(v => v.toString(16).padStart(2, '0')).join('');
}

const S = `stroke="${INK}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"`;

function face(eyes = [[38, 60], [62, 60]], mouth = 'M45 69 q2.5 3.2 5 0 q2.5 3.2 5 0') {
  return `
  <g class="cr-cheeks" fill="${CHEEK}" opacity=".55">
    <ellipse cx="${eyes[0][0] - 8}" cy="${eyes[0][1] + 9}" rx="6" ry="3.6"/>
    <ellipse cx="${eyes[1][0] + 8}" cy="${eyes[1][1] + 9}" rx="6" ry="3.6"/>
  </g>
  <g class="cr-eyes" fill="${INK}">
    <ellipse cx="${eyes[0][0]}" cy="${eyes[0][1]}" rx="3.6" ry="4.6"/>
    <ellipse cx="${eyes[1][0]}" cy="${eyes[1][1]}" rx="3.6" ry="4.6"/>
    <circle cx="${eyes[0][0] + 1.2}" cy="${eyes[0][1] - 1.6}" r="1.2" fill="${CREAM}"/>
    <circle cx="${eyes[1][0] + 1.2}" cy="${eyes[1][1] - 1.6}" r="1.2" fill="${CREAM}"/>
  </g>
  <path class="cr-mouth" d="${mouth}" fill="none" ${S} stroke-width="2.6"/>`;
}

const parts = {
  ajolote(c) {
    const d = shade(c, 0.78);
    const gill = (x1, y1, cx, cy, x2, y2) =>
      `<path d="M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}" stroke="${INK}" stroke-width="13" fill="none" stroke-linecap="round"/>
       <path d="M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}" stroke="${d}" stroke-width="7" fill="none" stroke-linecap="round"/>`;
    return `
    <g class="cr-ears">
      ${gill(27, 47, 22, 36, 17, 29)}${gill(22, 53, 13, 46, 6, 42)}${gill(20, 60, 10, 58, 3, 56)}
      ${gill(73, 47, 78, 36, 83, 29)}${gill(78, 53, 87, 46, 94, 42)}${gill(80, 60, 90, 58, 97, 56)}
    </g>
    <ellipse cx="50" cy="62" rx="33" ry="26" fill="${c}" ${S}/>
    <path d="M30 50 q20 -8 40 0" fill="none" stroke="${CREAM}" stroke-width="3" stroke-linecap="round" opacity=".55"/>
    ${face([[38, 62], [62, 62]], 'M42 71 q8 6 16 0')}`;
  },
  gato(c) {
    const d = shade(c, 0.82);
    return `
    <g class="cr-ears">
      <path d="M22 50 L26 16 L48 34 Z" fill="${c}" ${S}/>
      <path d="M78 50 L74 16 L52 34 Z" fill="${c}" ${S}/>
      <path d="M28 40 L30 25 L40 33 Z" fill="${CHEEK}" opacity=".5"/>
      <path d="M72 40 L70 25 L60 33 Z" fill="${CHEEK}" opacity=".5"/>
    </g>
    <ellipse cx="50" cy="60" rx="33" ry="28" fill="${c}" ${S}/>
    <path d="M44 36 l2 8 M50 34 v9 M56 36 l-2 8" stroke="${d}" stroke-width="3" stroke-linecap="round"/>
    <path d="M14 62 l12 1 M15 70 l11 -2 M86 62 l-12 1 M85 70 l-11 -2" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
    <path d="M47.5 64.5 h5 l-2.5 3 z" fill="${INK}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>
    ${face([[38, 58], [62, 58]], 'M44.5 70 q2.75 3 5.5 0 q2.75 3 5.5 0')}`;
  },
  conejo(c) {
    return `
    <g class="cr-ears">
      <ellipse cx="37" cy="24" rx="9" ry="22" transform="rotate(-12 37 24)" fill="${c}" ${S}/>
      <ellipse cx="63" cy="24" rx="9" ry="22" transform="rotate(12 63 24)" fill="${c}" ${S}/>
      <ellipse cx="37" cy="25" rx="4" ry="14" transform="rotate(-12 37 25)" fill="${CHEEK}" opacity=".45"/>
      <ellipse cx="63" cy="25" rx="4" ry="14" transform="rotate(12 63 25)" fill="${CHEEK}" opacity=".45"/>
    </g>
    <ellipse cx="50" cy="63" rx="31" ry="27" fill="${c}" ${S}/>
    <ellipse cx="50" cy="67" rx="3" ry="2.2" fill="${INK}"/>
    <path d="M46 74 h8 M50 69 v5" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>
    <rect x="47" y="74" width="6" height="5" rx="1.5" fill="${CREAM}" stroke="${INK}" stroke-width="2"/>
    ${face([[39, 60], [61, 60]], 'M50 74 v0')}`;
  },
  oso(c) {
    return `
    <g class="cr-ears">
      <circle cx="24" cy="36" r="12" fill="${c}" ${S}/>
      <circle cx="76" cy="36" r="12" fill="${c}" ${S}/>
      <circle cx="24" cy="36" r="5.5" fill="${CHEEK}" opacity=".45"/>
      <circle cx="76" cy="36" r="5.5" fill="${CHEEK}" opacity=".45"/>
    </g>
    <circle cx="50" cy="61" r="31" fill="${c}" ${S}/>
    <ellipse cx="50" cy="71" rx="13" ry="10" fill="${CREAM}" ${S} stroke-width="2.6"/>
    <ellipse cx="50" cy="67" rx="4.2" ry="3" fill="${INK}"/>
    ${face([[37, 56], [63, 56]], 'M46 74 q4 3.5 8 0')}`;
  },
  rana(c) {
    return `
    <g class="cr-ears">
      <circle cx="31" cy="38" r="14" fill="${c}" ${S}/>
      <circle cx="69" cy="38" r="14" fill="${c}" ${S}/>
      <circle cx="31" cy="38" r="8.5" fill="${CREAM}" stroke="${INK}" stroke-width="2.4"/>
      <circle cx="69" cy="38" r="8.5" fill="${CREAM}" stroke="${INK}" stroke-width="2.4"/>
    </g>
    <ellipse cx="50" cy="64" rx="36" ry="25" fill="${c}" ${S}/>
    <circle cx="44" cy="58" r="1.5" fill="${INK}"/><circle cx="56" cy="58" r="1.5" fill="${INK}"/>
    ${face([[31, 38], [69, 38]], 'M30 68 Q50 82 70 68')}`;
  },
};

/** SVG del personaje. `cls` permite añadir estados (feliz, triste...). */
export function critter(kind = 'ajolote', colorIdx = 0, cls = '') {
  const c = COLORS[colorIdx] ?? COLORS[0];
  const body = (parts[kind] ?? parts.ajolote)(c);
  // delay aleatorio para que los parpadeos no estén sincronizados
  const delay = (Math.random() * 4).toFixed(2);
  return `<svg class="critter ${cls}" viewBox="-2 6 104 90" style="--blink-delay:-${delay}s" aria-hidden="true">${body}</svg>`;
}

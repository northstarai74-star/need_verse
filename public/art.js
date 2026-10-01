/* Product illustrations as an SVG sprite. A photo (images/<id>.jpg or img:"..." in catalog.js) still covers these.
   Products without a drawing here fall back to their emoji icon. */
const ART_SPRITE = (() => {
  const R = 'stroke="#fff" stroke-opacity=".16" stroke-width="1.5"';
  const lg = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}</linearGradient>`;
  const acc = (id, l, m, d) => lg(id, [[0, l], [0.55, m], [1, d]]);
  const rg = (id, cx, cy, r, stops) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}</radialGradient>`;
  const star = (x, y, r, fill) => `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="${fill}"/>`;
  const drop = (x, y, s) => `<path d="M${x} ${y - s * 1.5}C${x + s} ${y - s * 0.2} ${x + s} ${y + s} ${x} ${y + s}C${x - s} ${y + s} ${x - s} ${y - s * 0.2} ${x} ${y - s * 1.5}Z" fill="#3d8bff"/><circle cx="${x - s * 0.35}" cy="${y + s * 0.1}" r="${s * 0.28}" fill="#fff" opacity=".7"/>`;
  const txt = (x, y, size, fill, s, family = "Inter,Arial,sans-serif") => `<text x="${x}" y="${y}" text-anchor="middle" font-family="${family}" font-weight="800" font-size="${size}" fill="${fill}">${s}</text>`;
  const each = (arr, f) => arr.map(f).join("");

  const defs = [
    lg("gDk", [[0, "#4b5262"], [1, "#1c2028"]]),
    lg("gDk2", [[0, "#30363f"], [1, "#121418"]]),
    lg("gMt", [[0, "#f6f8fb"], [0.5, "#c4cbd6"], [1, "#7b8494"]]),
    lg("gMtD", [[0, "#c9d0da"], [1, "#5f6878"]]),
    lg("gMtH", [[0, "#7b8494"], [0.45, "#f6f8fb"], [1, "#6a7383"]], 1, 0),
    lg("gGl", [[0, "#24324a"], [1, "#07090d"]], 1, 1),
    lg("gSh", [[0, "#fff", 0.55], [1, "#fff", 0]]),
    lg("gBeam", [[0, "#fff", 0.85], [1, "#fff", 0]], 1, 0),
    acc("gO", "#ff9a6e", "#ff4d1a", "#c9360c"),
    acc("gB", "#8dbcff", "#3d8bff", "#2559b8"),
    acc("gY", "#ffe39a", "#ffc53d", "#d99a0b"),
    acc("gP", "#dcb3ff", "#b25cff", "#7f38c9"),
    acc("gT", "#8ef3ea", "#2ed3c6", "#179389"),
    acc("gG", "#9cf2c2", "#3ddc84", "#1f9e5a"),
    lg("gScr", [[0, "#6aa8ff"], [0.5, "#2457c0"], [1, "#0c1a40"]], 1, 1),
    lg("gTb", [[0, "#8ef3ea", 0.95], [1, "#13857c", 0.95]], 1, 1),
    rg("gLens", 0.38, 0.36, 0.72, [[0, "#7fb2ff"], [0.32, "#1d3f78"], [1, "#04060a"]]),
    rg("gChr", 0.36, 0.32, 0.75, [[0, "#fff"], [0.45, "#c4cbd6"], [1, "#4f5766"]]),
    rg("gLed", 0.5, 0.5, 0.5, [[0, "#fff"], [0.5, "#fff6cf"], [1, "#fff6cf", 0]]),
    `<pattern id="pMesh" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#323844"/><rect x="1" y="1" width="4" height="4" rx="1" fill="#14171c"/></pattern>`,
    `<pattern id="pDot" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r=".9" fill="#fff" fill-opacity=".14"/></pattern>`,
    `<clipPath id="cSun"><path d="M38 72Q100 38 162 72L168 150Q100 162 32 150Z"/></clipPath>`
  ].join("");

  const mat = "M58 40H142Q152 40 152 50V148Q152 162 138 164L66 168Q50 169 50 154V52Q50 40 58 40Z";
  const wiper = "M24 146Q100 114 172 56L186 72Q112 134 34 166Z";
  const towel = (x, y, fill) => `<rect x="${x}" y="${y}" width="128" height="34" rx="13" fill="${fill}" ${R}/><rect x="${x}" y="${y}" width="128" height="34" rx="13" fill="url(#pDot)"/><rect x="${x + 6}" y="${y + 4}" width="116" height="8" rx="4" fill="#fff" opacity=".2"/><path d="M${x + 112} ${y + 5}Q${x + 121} ${y + 17} ${x + 112} ${y + 29}" stroke="#000" stroke-opacity=".3" stroke-width="2.5" fill="none"/>`;

  const art = {
    1: `<g transform="rotate(-9 100 104) translate(-16 -8)" opacity=".85"><path d="${mat}" fill="url(#gDk2)"/></g>
      <path d="${mat}" fill="url(#gDk)" ${R}/>
      <path d="M64 52H136Q140 52 140 56V144Q140 152 132 153L70 156Q62 156 62 148V56Q62 52 64 52Z" fill="#161a20" stroke="url(#gO)" stroke-width="4"/>
      ${each([70, 82, 94, 106, 118], (y) => `<path d="M74 ${y}H126" stroke="#0a0c0f" stroke-width="6" stroke-linecap="round"/><path d="M74 ${y + 3}H126" stroke="#fff" stroke-opacity=".12" stroke-width="1.5" stroke-linecap="round"/>`)}
      <rect x="74" y="128" width="52" height="18" rx="4" fill="url(#pDot)" stroke="#fff" stroke-opacity=".12"/>
      <rect x="88" y="44" width="24" height="5" rx="2.5" fill="url(#gO)"/>`,
    2: `<rect x="80" y="30" width="40" height="10" rx="5" fill="url(#gDk2)" ${R}/>
      <rect x="94" y="38" width="12" height="22" rx="3" fill="url(#gDk)"/>
      <circle cx="100" cy="62" r="9" fill="url(#gChr)"/>
      <rect x="36" y="66" width="128" height="84" rx="24" fill="url(#gDk)" ${R}/>
      <rect x="44" y="70" width="112" height="22" rx="11" fill="url(#gSh)" opacity=".3"/>
      <circle cx="82" cy="108" r="31" fill="url(#gMt)"/><circle cx="82" cy="108" r="26" fill="#07090d"/>
      <circle cx="82" cy="108" r="22" fill="url(#gLens)"/><circle cx="82" cy="108" r="22" fill="none" stroke="url(#gB)" stroke-width="2.5"/>
      <circle cx="82" cy="108" r="8" fill="#030406"/><circle cx="73" cy="99" r="5" fill="#fff" opacity=".85"/><circle cx="91" cy="117" r="2.2" fill="#fff" opacity=".5"/>
      <rect x="122" y="86" width="28" height="20" rx="5" fill="url(#gGl)" ${R}/><rect x="126" y="90" width="20" height="3" rx="1.5" fill="#3d8bff" opacity=".8"/>
      <rect x="122" y="114" width="28" height="14" rx="7" fill="url(#gB)"/>${txt(136, 124.5, 10, "#fff", "2K")}
      <circle cx="148" cy="77" r="3.5" fill="#ff4d1a"/>`,
    3: `<rect x="92" y="150" width="16" height="26" rx="5" fill="url(#gDk2)"/>
      <circle cx="100" cy="150" r="10" fill="url(#gChr)"/>
      <rect x="54" y="56" width="92" height="96" rx="18" fill="url(#gDk)" ${R}/>
      <rect x="66" y="26" width="68" height="132" rx="13" fill="#0d1015" stroke="url(#gMt)" stroke-width="3"/>
      <rect x="71" y="32" width="58" height="120" rx="9" fill="url(#gScr)"/>
      <rect x="91" y="36" width="18" height="5" rx="2.5" fill="#0d1015"/>
      <circle cx="100" cy="96" r="22" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2"/>
      <circle cx="100" cy="96" r="32" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="2"/>
      <path d="M103 80L90 99H99L96 113L110 93H101Z" fill="#fff"/>
      <rect x="71" y="32" width="58" height="50" rx="9" fill="url(#gSh)" opacity=".25"/>
      <rect x="46" y="82" width="24" height="34" rx="7" fill="url(#gDk)" ${R}/><rect x="46" y="86" width="5" height="26" rx="2.5" fill="url(#gB)"/>
      <rect x="130" y="82" width="24" height="34" rx="7" fill="url(#gDk)" ${R}/><rect x="149" y="86" width="5" height="26" rx="2.5" fill="url(#gB)"/>`,
    4: `<rect x="90" y="52" width="5" height="12" fill="url(#gMt)"/><rect x="105" y="52" width="5" height="12" fill="url(#gMt)"/>
      <rect x="72" y="22" width="56" height="34" rx="14" fill="url(#gDk)" ${R}/><rect x="82" y="28" width="36" height="22" rx="9" fill="url(#pMesh)"/>
      <path d="M66 60H134Q142 60 143 68L148 128Q149 138 139 138H61Q51 138 52 128L57 68Q58 60 66 60Z" fill="url(#gDk)" ${R}/>
      <path d="M80 68H120L124 130H76Z" fill="url(#pMesh)"/>
      <path d="M80 68L76 130M120 68L124 130" stroke="url(#gO)" stroke-width="3" stroke-dasharray="5 4" stroke-linecap="round"/>
      <path d="M54 140Q54 134 62 134H138Q146 134 147 140L154 162Q156 174 144 174H56Q44 174 46 162Z" fill="url(#gDk)" ${R}/>
      <path d="M74 140H126L131 168H69Z" fill="url(#pMesh)"/>
      <path d="M74 140L69 168M126 140L131 168" stroke="url(#gO)" stroke-width="3" stroke-dasharray="5 4" stroke-linecap="round"/>
      <path d="M68 64H132" stroke="#fff" stroke-opacity=".25" stroke-width="2" stroke-linecap="round"/>`,
    5: `<g clip-path="url(#cSun)">${each([0, 1, 2, 3, 4, 5, 6, 7], (i) => `<rect x="${32 + i * 17}" y="30" width="17" height="140" fill="url(#${i % 2 ? "gMtD" : "gMt"})"/>`)}
        <path d="M50 160L98 40H114L66 160Z" fill="#fff" opacity=".2"/></g>
      <path d="M88 53Q100 49 112 53V66Q100 70 88 66Z" fill="#15181d"/>
      <path d="M38 72Q100 38 162 72L168 150Q100 162 32 150Z" fill="none" stroke="url(#gO)" stroke-width="5" stroke-linejoin="round"/>
      ${each([0, 45, 90, 135, 180, 225, 270, 315], (a) => `<path d="M162 19V13" transform="rotate(${a} 162 38)" stroke="#ff4d1a" stroke-width="3.5" stroke-linecap="round"/>`)}
      <circle cx="162" cy="38" r="12" fill="url(#gO)"/>`,
    6: `<path d="M36 90L60 66H174L150 90Z" fill="#0f1216"/>
      <path d="M80 90L104 66V54L80 78Z" fill="url(#gDk)" ${R}/><path d="M116 90L140 66V54L116 78Z" fill="url(#gDk)" ${R}/>
      <path d="M150 90L174 66V136L150 160Z" fill="#1a1e25"/>
      <rect x="36" y="90" width="114" height="70" rx="5" fill="url(#gDk)" ${R}/>
      <path d="M36 90H150L174 66" stroke="#ff4d1a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <path d="M60 66H174" stroke="#ff4d1a" stroke-opacity=".5" stroke-width="3"/>
      <rect x="70" y="100" width="44" height="10" rx="5" fill="#07090c"/>
      <rect x="104" y="118" width="36" height="34" rx="5" fill="url(#pMesh)" stroke="#ff4d1a" stroke-width="2"/>
      <rect x="48" y="126" width="22" height="16" rx="3" fill="url(#gO)"/>`,
    7: `<path d="M126 92C150 84 168 84 176 98" stroke="#1a1d23" stroke-width="7" fill="none" stroke-linecap="round"/>
      <path d="M126 118C140 116 154 114 162 126" stroke="#1a1d23" stroke-width="7" fill="none" stroke-linecap="round"/>
      <rect x="34" y="38" width="92" height="122" rx="20" fill="url(#gDk)" ${R}/>
      <path d="M34 60Q34 38 56 38H104Q126 38 126 60Z" fill="url(#gY)"/><path d="M34 138H126Q126 160 104 160H56Q34 160 34 138Z" fill="url(#gY)"/>
      <rect x="46" y="70" width="68" height="36" rx="6" fill="url(#gGl)" ${R}/>${txt(80, 92, 15, "#ffc53d", "2000A")}
      ${each([50, 62, 74, 86], (x, i) => `<rect x="${x}" y="97" width="9" height="3.5" rx="1.5" fill="#ffc53d" opacity="${i === 3 ? 0.35 : 1}"/>`)}
      <circle cx="80" cy="123" r="10" fill="url(#gDk2)" stroke="url(#gY)" stroke-width="2.5"/>
      <path d="M76 119.5A6 6 0 1 0 84 119.5M80 116.5V123" stroke="#ffc53d" stroke-width="2" fill="none" stroke-linecap="round"/>
      <g transform="rotate(-14 176 116)"><rect x="166" y="98" width="20" height="30" rx="6" fill="url(#gDk)" ${R}/><path d="M168 128H184L180 144H172Z" fill="url(#gMt)"/></g>
      <g transform="rotate(18 162 142)"><rect x="152" y="124" width="20" height="30" rx="6" fill="url(#gO)"/><path d="M154 154H170L166 170H158Z" fill="url(#gMt)"/></g>`,
    8: `<path d="M164 79C186 82 188 106 172 120C160 132 172 148 182 150" stroke="#1a1d23" stroke-width="7" fill="none" stroke-linecap="round"/>
      <rect x="176" y="143" width="14" height="14" rx="3" fill="url(#gY)"/>
      <path d="M100 98H136L146 158H108Z" fill="url(#gDk)" ${R}/><path d="M110 108H130L137 150H116Z" fill="url(#gY)"/>
      <rect x="98" y="152" width="58" height="22" rx="7" fill="url(#gDk2)" ${R}/><rect x="104" y="158" width="46" height="4" rx="2" fill="#ffc53d"/>
      <rect x="34" y="52" width="122" height="54" rx="24" fill="url(#gDk)" ${R}/>
      <rect x="46" y="55" width="96" height="12" rx="6" fill="url(#gSh)" opacity=".3"/>
      <rect x="150" y="70" width="14" height="18" rx="4" fill="url(#gMt)"/>
      <rect x="50" y="62" width="54" height="34" rx="6" fill="url(#gGl)" ${R}/>${txt(77, 83, 15, "#ffc53d", "35")}${txt(77, 92, 6.5, "#ffc53d", "PSI")}
      <circle cx="118" cy="71" r="5" fill="url(#gY)"/><circle cx="118" cy="87" r="5" fill="url(#gY)"/>
      <circle cx="137" cy="79" r="6.5" fill="url(#gDk2)" stroke="#ffc53d" stroke-width="2"/>`,
    9: `<path d="M48 154L38 172M152 154L162 172" stroke="#3a414e" stroke-width="6" stroke-linecap="round"/>
      <path d="M100 32L168 150H32Z" fill="url(#gO)" stroke="url(#gO)" stroke-width="10" stroke-linejoin="round"/>
      <path d="M100 32L112 53L66 150H46Z" fill="#fff" opacity=".18"/>
      <path d="M100 68L139 136H61Z" fill="#15181d" stroke="#ffc53d" stroke-width="3" stroke-linejoin="round"/>
      <rect x="112" y="122" width="72" height="54" rx="12" fill="url(#gDk)" ${R}/>
      <path d="M120 133H176" stroke="#ffc53d" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 5"/>
      <circle cx="148" cy="155" r="13" fill="url(#gO)"/><path d="M148 148V162M141 155H155" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/>`,
    10: `<path d="M146 80L194 50V150L146 120Z" fill="url(#gBeam)"/>
      <ellipse cx="146" cy="100" rx="12" ry="26" fill="url(#gLed)"/>
      <rect x="22" y="70" width="46" height="60" rx="8" fill="url(#gDk)" ${R}/>
      ${each([30, 38, 46, 54, 62], (x) => `<path d="M${x} 78V122" stroke="#0b0d11" stroke-width="3" stroke-linecap="round"/>`)}
      <rect x="66" y="62" width="14" height="76" rx="4" fill="url(#gMt)"/>
      <rect x="80" y="70" width="9" height="60" rx="3" fill="url(#gP)"/>
      <rect x="88" y="84" width="60" height="32" rx="7" fill="url(#gMt)"/>
      <rect x="94" y="86" width="52" height="28" rx="6" fill="url(#gLed)" opacity=".5"/>
      ${each([98, 114, 130], (x) => `<rect x="${x}" y="90" width="11" height="20" rx="2.5" fill="#fff7d1"/><rect x="${x + 2}" y="92" width="7" height="16" rx="1.5" fill="#ffe27a"/>`)}`,
    11: `<g transform="translate(14 22)" opacity=".7"><path d="${wiper}" fill="url(#gDk2)"/></g>
      <path d="${wiper}" fill="url(#gDk)" ${R}/>
      <path d="M34 166Q112 134 186 72" stroke="#08090c" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path d="M28 150Q102 119 174 61" stroke="#fff" stroke-opacity=".3" stroke-width="2" fill="none" stroke-linecap="round"/>
      <rect x="84" y="100" width="40" height="20" rx="6" fill="url(#gP)" transform="rotate(-31 104 110)"/>
      <rect x="92" y="106" width="24" height="4" rx="2" fill="#fff" opacity=".35" transform="rotate(-31 104 110)"/>
      <circle cx="29" cy="157" r="6" fill="url(#gP)"/><circle cx="180" cy="64" r="6" fill="url(#gP)"/>
      ${drop(54, 74, 7)}${drop(80, 52, 5)}${drop(152, 142, 8)}${drop(174, 118, 5)}`,
    12: `<path d="M56 38H144Q150 38 150 44V148Q150 172 126 172H74Q50 172 50 148V44Q50 38 56 38Z" fill="url(#gDk)" ${R}/>
      <rect x="44" y="30" width="112" height="16" rx="5" fill="url(#gMt)"/>
      ${each([62, 100, 138], (x) => `<circle cx="${x}" cy="38" r="4" fill="#4f5766"/><circle cx="${x}" cy="38" r="1.6" fill="#22262e"/>`)}
      <rect x="72" y="62" width="56" height="36" rx="9" fill="url(#gP)"/>${txt(100, 88, 22, "#fff", "N", "Archivo,'Arial Black',sans-serif")}
      ${each([114, 124, 134, 144, 154], (y) => `<path d="M62 ${y}H138" stroke="#0b0d11" stroke-width="4" stroke-linecap="round"/><path d="M62 ${y + 2.5}H138" stroke="#fff" stroke-opacity=".1" stroke-width="1.2" stroke-linecap="round"/>`)}
      <path d="M57 52V144" stroke="#fff" stroke-opacity=".18" stroke-width="2" stroke-linecap="round"/>`,
    13: `<g fill="#8ef3ea" opacity=".8"><circle cx="40" cy="44" r="3"/><circle cx="30" cy="38" r="2"/><circle cx="32" cy="52" r="2.4"/><circle cx="22" cy="46" r="1.6"/><circle cx="44" cy="56" r="1.6"/></g>
      <rect x="50" y="40" width="22" height="13" rx="3" fill="url(#gDk2)"/>
      <path d="M70 34H120Q130 34 130 44V60Q130 66 124 66H70Z" fill="url(#gDk)" ${R}/>
      <path d="M80 64Q74 88 88 98L95 93Q86 82 90 64Z" fill="url(#gDk2)"/>
      <rect x="98" y="64" width="22" height="14" fill="url(#gDk2)"/><rect x="92" y="74" width="34" height="9" rx="3" fill="url(#gMt)"/>
      <path d="M92 82H126Q146 92 146 114V162Q146 174 134 174H84Q72 174 72 162V114Q72 92 92 82Z" fill="url(#gTb)" ${R}/>
      <path d="M74 122H144V162Q144 172 134 172H84Q74 172 74 162Z" fill="#2ed3c6" opacity=".35"/>
      <rect x="76" y="106" width="5" height="56" rx="2.5" fill="#fff" opacity=".4"/>
      <rect x="84" y="118" width="54" height="40" rx="6" fill="#f4f1ec"/><rect x="84" y="130" width="54" height="9" fill="#15181d"/><rect x="90" y="146" width="28" height="4" rx="2" fill="#2ed3c6"/>
      <path d="M82 102Q82 93 92 89" stroke="#fff" stroke-opacity=".6" stroke-width="4" stroke-linecap="round" fill="none"/>
      ${star(160, 56, 13, "#fff")}${star(172, 90, 6, "#8ef3ea")}${star(52, 112, 8, "#8ef3ea")}`,
    14: `${towel(32, 134, "url(#gT)")}${towel(40, 101, "url(#gDk)")}${towel(34, 68, "url(#gT)")}
      <rect x="106" y="62" width="22" height="110" rx="3" fill="#f4f1ec"/><rect x="106" y="104" width="22" height="18" fill="#15181d"/><rect x="111" y="109" width="12" height="8" rx="2" fill="#2ed3c6"/>`,
    15: `<path d="M50 78Q50 40 90 40H104Q122 40 122 62" stroke="#343a46" stroke-width="15" fill="none" stroke-linecap="round"/>
      <path d="M52 66Q56 46 88 44" stroke="#fff" stroke-opacity=".2" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <rect x="78" y="34" width="16" height="10" rx="5" fill="url(#gT)"/>
      <rect x="34" y="70" width="80" height="62" rx="24" fill="url(#gDk)" ${R}/>
      ${each([52, 60, 68], (x) => `<path d="M${x} 86V112" stroke="#0b0d11" stroke-width="3" stroke-linecap="round"/>`)}
      <rect x="42" y="120" width="62" height="6" rx="3" fill="url(#gT)"/>
      <path d="M152 86L186 98Q190 100 190 104V110Q190 114 186 114L152 120Z" fill="url(#gDk2)" ${R}/><rect x="183" y="98" width="5" height="16" rx="2" fill="url(#gT)"/>
      <rect x="106" y="66" width="48" height="70" rx="12" fill="url(#gTb)" ${R}/>
      <path d="M114 84Q130 78 146 84M114 98Q130 92 146 98" stroke="#fff" stroke-opacity=".45" stroke-width="2" fill="none"/>
      <g fill="#15181d" opacity=".7"><circle cx="120" cy="125" r="2.4"/><circle cx="130" cy="128" r="1.8"/><circle cx="140" cy="123" r="2.2"/><circle cx="126" cy="119" r="1.4"/></g>
      <rect x="112" y="72" width="5" height="56" rx="2.5" fill="#fff" opacity=".4"/>`,
    16: `<rect x="20" y="104" width="96" height="28" rx="3" fill="url(#gMt)"/><rect x="20" y="104" width="96" height="6" fill="#fff" opacity=".35"/>
      <rect x="42.5" y="96" width="7" height="44" rx="3.5" fill="url(#gMtH)"/>
      <path d="M46 140Q46 154 34 154Q22 154 22 142" stroke="url(#gG)" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path d="M108 80H146Q152 80 152 86V150Q152 156 146 156H108Q102 156 102 150V86Q102 80 108 80Z" fill="url(#gDk)" ${R}/>
      <circle cx="127" cy="98" r="3" fill="#0b0d11"/><rect x="110" y="122" width="34" height="12" rx="3" fill="url(#gG)"/>
      <rect x="116" y="60" width="22" height="20" rx="2" fill="url(#gMtH)"/><rect x="110" y="74" width="34" height="8" rx="3" fill="url(#gMt)"/>
      <circle cx="127" cy="44" r="22" fill="url(#gChr)"/><ellipse cx="119" cy="36" rx="7" ry="5" fill="#fff" opacity=".8"/>
      <rect x="114" y="156" width="26" height="12" rx="2" fill="url(#gMt)"/>`,
    17: `<path d="M14 168Q100 148 186 168" stroke="#3a414e" stroke-width="7" fill="none" stroke-linecap="round"/>
      <rect x="54" y="124" width="14" height="36" rx="3" fill="url(#gDk2)"/><rect x="134" y="124" width="14" height="36" rx="3" fill="url(#gDk2)"/>
      <rect x="44" y="120" width="34" height="8" rx="3" fill="url(#gMt)"/><rect x="124" y="120" width="34" height="8" rx="3" fill="url(#gMt)"/>
      <path d="M24 114Q30 72 96 66H142Q182 68 182 100Q182 122 160 124H40Q24 124 24 114Z" fill="url(#gDk)" ${R}/>
      <path d="M30 104Q40 80 96 76H140Q172 78 176 100" stroke="#0b0d11" stroke-width="2.5" fill="none"/>
      <path d="M36 113Q44 92 98 88H138Q164 90 168 106" stroke="url(#gG)" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M56 80Q80 70 100 70H140Q160 72 170 84" stroke="#fff" stroke-opacity=".35" stroke-width="3" fill="none" stroke-linecap="round"/>
      <circle cx="150" cy="112" r="5" fill="url(#gChr)"/>`,
    18: `<path d="M150 52A22 22 0 0 1 170 72" stroke="#3d8bff" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path d="M152 38A36 36 0 0 1 184 72" stroke="#3d8bff" stroke-opacity=".5" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path d="M58 48H142L136 72H64Z" fill="url(#gMt)"/>
      ${each([0, 1, 2, 3, 4, 5, 6, 7], (i) => `<rect x="${70 + i * 8}" y="53" width="4" height="5" rx="1" fill="#2a2f39"/>`)}
      ${each([0, 1, 2, 3, 4, 5, 6], (i) => `<rect x="${74 + i * 8}" y="62" width="4" height="5" rx="1" fill="#2a2f39"/>`)}
      <path d="M48 70H152Q160 70 158 78L148 152Q147 162 137 162H63Q53 162 52 152L42 78Q40 70 48 70Z" fill="url(#gDk)" ${R}/>
      <path d="M50 74H150L148 90H52Z" fill="url(#gSh)" opacity=".25"/>
      <circle cx="100" cy="116" r="27" fill="none" stroke="#3d8bff" stroke-opacity=".35" stroke-width="4"/>
      <circle cx="100" cy="116" r="22" fill="url(#gB)"/>
      <path d="M93 109L107 123L100 130V102L107 109L93 123" stroke="#fff" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="70" cy="146" r="3" fill="#3ddc84"/><circle cx="80" cy="146" r="3" fill="#3d8bff"/>`
  };

  const symbols = Object.entries(art).map(([id, body]) => `<symbol id="a${id}" viewBox="0 0 200 200">${body}</symbol>`).join("");
  document.body.insertAdjacentHTML("afterbegin", `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>${defs}</defs>${symbols}</svg>`);
  return new Set(Object.keys(art).map(Number));
})();

const CAT_ART = { Interior: 4, Electronics: 2, Emergency: 7, Exterior: 10, Cleaning: 13, Utility: 17 };
const art = (id, cls = "art") => `<svg class="${cls}" viewBox="0 0 200 200" aria-hidden="true"><use href="#a${id}"/></svg>`;
const hasArt = (id) => ART_SPRITE.has(id);

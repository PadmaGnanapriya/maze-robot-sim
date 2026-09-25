/** Minimal Arduino C++ syntax highlighter producing HTML spans. */
const KEYWORDS = new Set('if else for while do switch case default break continue return goto sizeof typedef struct enum class const static volatile inline extern true false nullptr new delete this public private template using namespace'.split(' '));
const TYPES = new Set('void int long short char float double bool boolean byte word String unsigned signed uint8_t int8_t uint16_t int16_t uint32_t int32_t uint64_t int64_t size_t auto State NewPing'.split(' '));
const BUILTINS = new Set('pinMode digitalWrite digitalRead analogWrite analogRead analogReference delay delayMicroseconds millis micros pulseIn pulseInLong constrain map min max abs sqrt sq pow sin cos tan atan atan2 random randomSeed tone noTone bitRead bitSet bitClear bitWrite lowByte highByte attachInterrupt detachInterrupt setup loop F round floor ceil fabs radians degrees'.split(' '));
const TOKENS = /(\/\*[\s\S]*?(?:\*\/|$))|(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"?)|('(?:[^'\\\n]|\\.)*'?)|(^[ \t]*#[^\n]*)|(\b(?:0[xX][0-9a-fA-F]+|0[bB][01]+|\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)[uUlLfF]*\b)|([A-Za-z_]\w*)/gm;

const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlight(src) {
  let out = '', last = 0, m;
  TOKENS.lastIndex = 0;
  while ((m = TOKENS.exec(src))) {
    if (m.index > last) out += escapeHtml(src.slice(last, m.index));
    const t = m[0];
    let cls = null;
    if (m[1] || m[2]) cls = 'com';
    else if (m[3] || m[4]) cls = 'str';
    else if (m[5]) cls = 'pp';
    else if (m[6]) cls = 'num';
    else if (KEYWORDS.has(t)) cls = 'kw';
    else if (TYPES.has(t)) cls = 'ty';
    else if (t === 'Serial') cls = 'ob';
    else if (BUILTINS.has(t)) cls = 'fn';
    else if (/^[A-Z][A-Z0-9_]+$/.test(t)) cls = 'cn';
    else if (src.charCodeAt(TOKENS.lastIndex) === 40) cls = 'fn';   // followed by "("
    out += cls ? `<span class="tk-${cls}">${escapeHtml(t)}</span>` : escapeHtml(t);
    last = TOKENS.lastIndex;
    if (t.length === 0) TOKENS.lastIndex++;
  }
  return out + escapeHtml(src.slice(last));
}

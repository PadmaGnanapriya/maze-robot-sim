/**
 * Small sketches covering language surface the default solver (used by bench.js) never
 * touches: structs, 2D arrays, enum class + switch, overload resolution + default args +
 * reference params + static locals, String methods, F() + bit ops + overflow/div-by-zero
 * warnings, array-bounds warnings, NewPing + delay() (the generator/timing machinery), and
 * analogWrite pin-range wrapping. Used by scripts/golden.js as a regression oracle - see
 * that file for why bench.js's default-solver run alone isn't enough coverage.
 */
export const GOLDEN_SKETCHES = [
  {
    name: 'structs-2d-arrays',
    run: true,
    src: `
struct Point { int x; int y; };
Point pts[3] = { {1,2}, {3,4}, {5,6} };
int grid[2][3] = { {1,2,3}, {4,5,6} };

void setup() {
  Serial.begin(115200);
  long sum = 0;
  for (int i = 0; i < 3; i++) sum += pts[i].x + pts[i].y;
  Serial.println(sum);
  int gsum = 0;
  for (int r = 0; r < 2; r++) for (int c = 0; c < 3; c++) gsum += grid[r][c];
  Serial.println(gsum);
}
void loop() {}
`,
  },
  {
    name: 'enum-class-switch',
    run: true,
    src: `
enum class State { Idle, Run, Stop };
State s = State::Run;

const char* nameOf(State st) {
  switch (st) {
    case State::Idle: return "idle";
    case State::Run: return "run";
    default: return "stop";
  }
}

void setup() {
  Serial.begin(115200);
  Serial.println(nameOf(s));
  s = State::Stop;
  Serial.println(nameOf(s));
}
void loop() {}
`,
  },
  {
    name: 'overloads-defaults-refs-static',
    run: true,
    src: `
int addOne(int x) { return x + 1; }
long addOne(long x, long y = 10) { return x + y; }

void increment(int &v) { v = v + 1; }

int counter() {
  static int n = 0;
  n++;
  return n;
}

void setup() {
  Serial.begin(115200);
  Serial.println(addOne(5));
  Serial.println(addOne(5L));
  Serial.println(addOne(5L, 2L));
  int v = 41;
  increment(v);
  Serial.println(v);
  Serial.println(counter());
  Serial.println(counter());
  Serial.println(counter());
}
void loop() {}
`,
  },
  {
    name: 'string-methods',
    run: true,
    src: `
void setup() {
  Serial.begin(115200);
  String s = "Hello, Arduino!";
  Serial.println(s.length());
  Serial.println(s.indexOf("Arduino"));
  Serial.println(s.substring(7, 15));
  String t = s;
  t.toUpperCase();
  Serial.println(t);
  t.replace("ARDUINO", "WORLD");
  Serial.println(t);
  String u = "  trim me  ";
  u.trim();
  Serial.println(u);
  Serial.println(s.startsWith("Hello") ? "yes" : "no");
}
void loop() {}
`,
  },
  {
    name: 'bitops-overflow-divzero-fmacro',
    run: true,
    src: `
void setup() {
  Serial.begin(115200);
  Serial.println(F("boot"));
  int x = 0;
  bitSet(x, 3);
  bitSet(x, 5);
  Serial.println(x);
  bitClear(x, 3);
  Serial.println(x);
  Serial.println(x, HEX);
  int big = 30000;
  int r = big + big;
  Serial.println(r);
  int z = 10;
  int q = z / 0;
  Serial.println(q);
}
void loop() {}
`,
  },
  {
    name: 'array-oob-warning',
    run: true,
    src: `
int arr[5];
void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 5; i++) arr[i] = i * i;
  int x = arr[10];
  Serial.println(x);
}
void loop() {}
`,
  },
  {
    name: 'analogwrite-pin-wrap',
    run: true,
    src: `
void setup() {
  Serial.begin(115200);
  pinMode(9, OUTPUT);
  analogWrite(9, 300);
  analogWrite(3, -5);
  digitalWrite(9, HIGH);
}
void loop() {}
`,
  },
  {
    name: 'newping-delay-loop',
    run: true,
    runUs: 2_000_000,
    src: `
#include <NewPing.h>
NewPing sonar(2, 3, 400);

void setup() {
  Serial.begin(115200);
}
void loop() {
  unsigned int cm = sonar.ping_cm();
  Serial.println(cm);
  delay(400);
}
`,
  },
];

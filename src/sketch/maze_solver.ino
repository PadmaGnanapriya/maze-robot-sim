// ===================================================================
//  Padma's Studio - 3-sonar wall-following maze solver
//  Arduino Uno + L298N + 2 TT gear motors + caster + 3x HC-SR04
//
//  Strategy: keep one hand on the wall (right-hand rule by default).
//  In a maze without loops this visits every corridor, so it always
//  reaches the white goal area, wherever it is.
//
//  FOLLOW   drive forward, a PD controller holds the wall at SIDE_TARGET
//  PRE_TURN the followed wall ended: roll on until the axle is level
//           with the corner
//  TURN     arc 90 degrees around the corner; if our side is still open
//           it was the end of a wall, so arc another 90 (a U-turn)
//  PIVOT    front blocked: spin away from the wall until the way is open
// ===================================================================
#include "config.h"

State state = FOLLOW;
unsigned long stateStart = 0;
float fDist = MAX_RANGE, lDist = MAX_RANGE, rDist = MAX_RANGE;
float lastErr = 0;
float dErrF = 0;                     // filtered derivative
unsigned long lastPid = 0;
bool pidReset = true;
int clearCount = 0;
int openCount = 0;
int arcs = 0;                        // 90 degree chunks done in this turn
bool frontCleared = false;
unsigned long clearedAt = 0;
float lastCm[3] = { MAX_RANGE, MAX_RANGE, MAX_RANGE };   // last good reading per sensor
int misses[3] = { 0, 0, 0 };

void setup() {
  pinMode(ENA, OUTPUT); pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT); pinMode(ENB, OUTPUT);
  pinMode(TRIG_F, OUTPUT); pinMode(ECHO_F, INPUT);
  pinMode(TRIG_L, OUTPUT); pinMode(ECHO_L, INPUT);
  pinMode(TRIG_R, OUTPUT); pinMode(ECHO_R, INPUT);

  Serial.begin(115200);
  Serial.println(F("Maze solver ready"));
  stopMotors();
  delay(800);                // time to put the robot down
  readSensors();
  setState(FOLLOW);
}

void loop() {
  readSensors();
  float wallD = FOLLOW_RIGHT ? rDist : lDist;   // the wall we keep our hand on
  float farD  = FOLLOW_RIGHT ? lDist : rDist;   // the other side
  unsigned long inState = millis() - stateStart;

  switch (state) {
    case FOLLOW:
      if (wallD > WALL_LOST) openCount++; else openCount = 0;
      if (openCount >= 2)          setState(PRE_TURN);   // our wall opened up: take it
      else if (fDist < FRONT_STOP) setState(PIVOT);      // blocked ahead: turn away
      else followWall(wallD, farD, fDist < FRONT_SLOW ? SLOW_PWM : BASE_PWM);
      break;

    case PRE_TURN:
      drive(ARC_PWM, ARC_PWM);
      if (inState >= PRE_TURN_MS || fDist < FRONT_STOP) setState(TURN);
      break;

    case TURN:
      if (fDist < FRONT_STOP) spinTowardWall();       // too tight for an arc: turn on the spot
      else                    arcTowardWall();
      if (inState >= ARC_90_MS) {
        if (wallD < WALL_NEAR || arcs >= 1) setState(FOLLOW);    // wall found again
        else { arcs++; stateStart = millis(); }                   // wall end: keep going round
      }
      break;

    case PIVOT:
      spinAwayFromWall();
      if (!frontCleared) {
        if (fDist > FRONT_CLEAR && wallD < WALL_LOST) clearCount++;
        else clearCount = 0;
        if (clearCount >= 2) { frontCleared = true; clearedAt = millis(); }
      } else if (millis() - clearedAt >= PIVOT_EXTRA_MS) {
        setState(FOLLOW);                              // square to the new corridor
      }
      if (inState > MAX_PIVOT_MS) setState(FOLLOW);
      break;
  }
}

// ---------------- behaviours ----------------
void followWall(float wallD, float farD, int base) {
  float err;                                         // > 0: too close to our wall
  if (wallD < WALL_NEAR && farD < WALL_NEAR) err = (farD - wallD) / 2.0;  // centre between both walls
  else if (wallD < WALL_NEAR)                err = SIDE_TARGET - wallD;
  else if (farD < WALL_NEAR)                 err = farD - SIDE_TARGET;
  else                                       err = 0;

  unsigned long now = millis();
  float dt = (now - lastPid) / 1000.0;
  if (pidReset || dt <= 0 || dt > 0.25) { lastErr = err; dErrF = 0; dt = 0.02; pidReset = false; }
  dErrF += D_FILTER * ((err - lastErr) / dt - dErrF);
  lastErr = err;
  lastPid = now;

  int steer = constrain((int)(KP * err + KD * dErrF), -MAX_STEER, MAX_STEER);
  if (FOLLOW_RIGHT) drive(base - steer, base + steer);   // steer > 0 turns left
  else              drive(base + steer, base - steer);
}

void arcTowardWall() {
  int inner = (int)(ARC_PWM * ARC_INNER);
  if (FOLLOW_RIGHT) drive(ARC_PWM, inner);
  else              drive(inner, ARC_PWM);
}

void spinTowardWall() {
  if (FOLLOW_RIGHT) drive(TURN_PWM, -TURN_PWM);
  else              drive(-TURN_PWM, TURN_PWM);
}

void spinAwayFromWall() {
  if (FOLLOW_RIGHT) drive(-TURN_PWM, TURN_PWM);
  else              drive(TURN_PWM, -TURN_PWM);
}

void setState(State s) {
  state = s;
  stateStart = millis();
  clearCount = 0;
  openCount = 0;
  frontCleared = false;
  if (s != TURN) arcs = 0;
  pidReset = true;
#if DEBUG_SERIAL
  Serial.print(millis());
  Serial.print(F(" ms  "));
  Serial.print(stateName(s));
  Serial.print(F("  F=")); Serial.print(fDist, 1);
  Serial.print(F(" L="));  Serial.print(lDist, 1);
  Serial.print(F(" R="));  Serial.println(rDist, 1);
#endif
}

const char* stateName(State s) {
  switch (s) {
    case FOLLOW:   return "FOLLOW";
    case PRE_TURN: return "PRE_TURN";
    case TURN:     return "TURN";
    case PIVOT:    return "PIVOT";
  }
  return "?";
}

// ---------------- sensors ----------------
// One ping. A missed echo keeps the HC-SR04's ECHO pin high for ~38 ms, which
// also spoils the next pings, so a few misses in a row are ignored.
float readCm(int idx, int trig, int echo) {
  digitalWrite(trig, LOW);
  delayMicroseconds(2);
  digitalWrite(trig, HIGH);
  delayMicroseconds(10);
  digitalWrite(trig, LOW);
  unsigned long us = pulseIn(echo, HIGH, 12000UL);   // 12 ms is about 2 m
  if (us == 0) {                                    // no echo
    if (++misses[idx] < MAX_MISSES) return lastCm[idx];
    return MAX_RANGE;                               // really nothing out there
  }
  misses[idx] = 0;
  float cm = us / 58.0;
  if (cm > MAX_RANGE) cm = MAX_RANGE;
  lastCm[idx] = cm;
  return cm;
}

void readSensors() {
  fDist = readCm(0, TRIG_F, ECHO_F);
  lDist = readCm(1, TRIG_L, ECHO_L);
  rDist = readCm(2, TRIG_R, ECHO_R);
}

// ---------------- motors (L298N) ----------------
void drive(int left, int right) {
  setMotor(ENA, IN1, IN2, left * LEFT_TRIM);
  setMotor(ENB, IN3, IN4, right * RIGHT_TRIM);
}

void setMotor(int en, int inA, int inB, float speed) {
  int pwm = constrain(abs((int)speed), 0, 255);
  if (pwm > 0 && pwm < MIN_PWM) pwm = MIN_PWM;       // too slow would just stall
  digitalWrite(inA, speed >= 0 ? HIGH : LOW);
  digitalWrite(inB, speed >= 0 ? LOW : HIGH);
  analogWrite(en, pwm);
}

void stopMotors() {                                  // active brake
  digitalWrite(IN1, LOW); digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW); digitalWrite(IN4, LOW);
  analogWrite(ENA, 255);  analogWrite(ENB, 255);
}

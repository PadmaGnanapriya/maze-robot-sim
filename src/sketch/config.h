// ===================================================================
//  config.h  -  pins and tuning values for the maze solver
//  Change a value, press "Upload & run" and watch what happens.
// ===================================================================
#pragma once

// ---------- L298N motor driver ----------
#define ENA 5        // left motor speed (PWM)
#define IN1 6        // left motor direction
#define IN2 7
#define IN3 8        // right motor direction
#define IN4 9
#define ENB 10       // right motor speed (PWM)

// ---------- HC-SR04 / HY-SRF05 sonars ----------
#define TRIG_F 2
#define ECHO_F 3
#define TRIG_L 4
#define ECHO_L 11
#define TRIG_R 12
#define ECHO_R 13

// ---------- Strategy ----------
#define FOLLOW_RIGHT 1    // 1 = right-hand rule, 0 = left-hand rule
#define DEBUG_SERIAL 1    // print every state change to the Serial monitor

enum State { FOLLOW, PRE_TURN, TURN, PIVOT };

// ---------- Your maze and robot: measure these ----------
#define CELL_CM      40.0   // wall gap: distance between wall centres
#define TRACK_CM     16.6   // distance between the two wheel centres
#define SENSOR_SPAN  15.0   // distance between the faces of the left and right sonars

// ---------- Distances in cm, as read by each sensor ----------
const float SIDE_TARGET = (CELL_CM - SENSOR_SPAN - 2.0) / 2;  // wanted gap to the followed wall
const float WALL_NEAR   = SIDE_TARGET + CELL_CM * 0.26;      // side below this: the wall is there
const float WALL_LOST   = SIDE_TARGET + CELL_CM * 0.46;      // side above this: an opening
const float FRONT_STOP  = max(4.0, CELL_CM / 2 - 12.0);      // front this close: turn
const float FRONT_SLOW  = CELL_CM * 0.75;                    // start slowing for a front wall
const float FRONT_CLEAR = CELL_CM * 0.60;                    // front this open: stop spinning
const float MAX_RANGE   = 150.0;  // no echo counts as this far
const int   MAX_MISSES  = 3;      // missed echoes in a row before we believe "open"

// ---------- Motors ----------
const int   BASE_PWM   = 130;     // cruising speed (0-255)
const int   SLOW_PWM   = 95;      // speed close to a front wall
const int   ARC_PWM    = 110;     // outer wheel speed while rounding a corner
const int   TURN_PWM   = 105;     // spin-in-place speed
const int   MIN_PWM    = 45;      // below this the TT motors stall
const int   DEAD_PWM   = 33;      // PWM at which the wheels just start to turn
const float CM_S_PER_PWM = 0.483; // calibrate: drive straight for 2 s at BASE_PWM,
                                  // cm travelled / 2 / (BASE_PWM - DEAD_PWM)
const float LEFT_TRIM  = 1.00;    // scale one motor down if the robot drifts
const float RIGHT_TRIM = 1.00;

// ---------- Wall-follow PD controller ----------
const float KP        = 4.0;      // PWM per cm of error
const float KD        = 1.6;      // PWM per cm/s of error change
const float D_FILTER  = 0.4;      // 0..1, lower = smoother derivative
const int   MAX_STEER = 60;

// ---------- Corners ----------
// Arc around the corner post with radius ARC_R. The inner wheel speed and the
// time for a quarter turn follow from the geometry and the motor calibration.
const float ARC_R     = CELL_CM / 2 - 1.0;
const float ARC_Q     = (ARC_R - TRACK_CM / 2) / (ARC_R + TRACK_CM / 2);  // inner/outer wheel speed
const float ARC_INNER = ARC_Q + (1.0 - ARC_Q) * DEAD_PWM / ARC_PWM;        // inner/outer PWM
const unsigned long ARC_90_MS = 1000.0 * HALF_PI * TRACK_CM
                              / (CM_S_PER_PWM * (ARC_PWM - DEAD_PWM) * (1.0 - ARC_Q)) + 30;
const unsigned long PRE_TURN_MS    = 90;   // keep going straight after an opening appears
const unsigned long PIVOT_EXTRA_MS = 60;   // keep spinning a little after the front clears
const unsigned long MAX_PIVOT_MS   = 2400;

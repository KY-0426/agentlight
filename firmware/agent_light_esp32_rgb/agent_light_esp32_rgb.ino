#include <Arduino.h>
#include <WiFi.h>

// Wiring: RGB LED signal pins on ESP32 GPIO 1/2/3, common GND on G.
// If your LED is common-anode, set RGB_COMMON_ANODE to true.
constexpr uint8_t RGB_RED_PIN = 1;
constexpr uint8_t RGB_GREEN_PIN = 2;
constexpr uint8_t RGB_BLUE_PIN = 3;
constexpr bool RGB_COMMON_ANODE = false;

constexpr uint32_t SERIAL_BAUD = 115200;
constexpr const char* FIRMWARE_VERSION = "0.3.0";
constexpr const char* PROTOCOL_VERSION = "agent-light-rgb-v1";
constexpr const char* HARDWARE_REVISION = "esp32-mini-rgb-dev";
constexpr uint32_t PWM_FREQ_HZ = 5000;
constexpr uint8_t PWM_BITS = 8;
constexpr uint16_t FRAME_MS = 20;
constexpr uint16_t BREATHE_PERIOD_MS = 3600;
constexpr uint16_t TEST_SOLID_HOLD_MS = 3000;

constexpr uint8_t RED_CHANNEL = 0;
constexpr uint8_t GREEN_CHANNEL = 1;
constexpr uint8_t BLUE_CHANNEL = 2;

enum LightMode {
  MODE_STEADY,
  MODE_BREATHE,
  MODE_PULSE,
  MODE_REPEAT_PULSE,
};

struct RgbFrame {
  uint8_t red;
  uint8_t green;
  uint8_t blue;
  LightMode mode;
  String state;
};

RgbFrame currentFrame = {0, 0, 255, MODE_BREATHE, "standby"};
String serialLine;
String hardwareDeviceId;
uint32_t lastFrameAtMs = 0;
uint32_t testSolidUntilMs = 0;
RgbFrame testFrame = {0, 0, 0, MODE_STEADY, "test"};

void setupPwm();
void writeRgb(uint8_t red, uint8_t green, uint8_t blue);
void writePwm(uint8_t channel, uint8_t pin, uint8_t value);
void readSerialInput();
void handleCommand(String line);
void printHello(const char* prefix);
void applyFrame();
uint8_t animationLevel(LightMode mode, uint32_t nowMs);
uint8_t scaleColor(uint8_t value, uint8_t level);
uint8_t uint8ForKey(const String& line, const char* key, uint8_t fallback);
String stringForKey(const String& line, const char* key, const String& fallback);
LightMode parseMode(const String& value);
String computeHardwareDeviceId();
void triggerSolidTest(uint8_t red, uint8_t green, uint8_t blue, const char* label);

void setup() {
  Serial.begin(SERIAL_BAUD);
  serialLine.reserve(160);
  hardwareDeviceId = computeHardwareDeviceId();
  setupPwm();
  writeRgb(currentFrame.red, currentFrame.green, currentFrame.blue);
  printHello("READY");
}

String computeHardwareDeviceId() {
  uint64_t mac = ESP.getEfuseMac();
  char buffer[24];
  snprintf(buffer, sizeof(buffer), "AL-%02X%02X%02X%02X%02X%02X",
           (uint8_t)(mac >> 40),
           (uint8_t)(mac >> 32),
           (uint8_t)(mac >> 24),
           (uint8_t)(mac >> 16),
           (uint8_t)(mac >> 8),
           (uint8_t)(mac));
  return String(buffer);
}

void triggerSolidTest(uint8_t red, uint8_t green, uint8_t blue, const char* label) {
  testFrame.red = red;
  testFrame.green = green;
  testFrame.blue = blue;
  testFrame.mode = MODE_STEADY;
  testFrame.state = String(label);
  testSolidUntilMs = millis() + TEST_SOLID_HOLD_MS;
  Serial.print("OK test=");
  Serial.print(label);
  Serial.print(" hardware_device_id=");
  Serial.print(hardwareDeviceId);
  Serial.print(" r=");
  Serial.print(red);
  Serial.print(" g=");
  Serial.print(green);
  Serial.print(" b=");
  Serial.println(blue);
}

void loop() {
  readSerialInput();
  applyFrame();
}

void setupPwm() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(RGB_RED_PIN, PWM_FREQ_HZ, PWM_BITS);
  ledcAttach(RGB_GREEN_PIN, PWM_FREQ_HZ, PWM_BITS);
  ledcAttach(RGB_BLUE_PIN, PWM_FREQ_HZ, PWM_BITS);
#else
  ledcSetup(RED_CHANNEL, PWM_FREQ_HZ, PWM_BITS);
  ledcSetup(GREEN_CHANNEL, PWM_FREQ_HZ, PWM_BITS);
  ledcSetup(BLUE_CHANNEL, PWM_FREQ_HZ, PWM_BITS);
  ledcAttachPin(RGB_RED_PIN, RED_CHANNEL);
  ledcAttachPin(RGB_GREEN_PIN, GREEN_CHANNEL);
  ledcAttachPin(RGB_BLUE_PIN, BLUE_CHANNEL);
#endif
}

void readSerialInput() {
  while (Serial.available() > 0) {
    char next = static_cast<char>(Serial.read());
    if (next == '\r') {
      continue;
    }
    if (next == '\n') {
      handleCommand(serialLine);
      serialLine = "";
      continue;
    }
    if (serialLine.length() < 150) {
      serialLine += next;
    }
  }
}

void handleCommand(String line) {
  line.trim();
  if (line.length() == 0) {
    return;
  }
  if (line == "PING" || line == "HELLO" || line == "VERSION") {
    printHello(line == "PING" ? "PONG" : "HELLO");
    return;
  }
  if (line == "TEST RED") {
    triggerSolidTest(255, 0, 0, "red");
    return;
  }
  if (line == "TEST GREEN") {
    triggerSolidTest(0, 255, 0, "green");
    return;
  }
  if (line == "TEST BLUE") {
    triggerSolidTest(0, 0, 255, "blue");
    return;
  }
  if (line == "TEST OFF") {
    testSolidUntilMs = 0;
    Serial.println("OK test=off");
    return;
  }
  if (!line.startsWith("AGENT_LIGHT ")) {
    Serial.println("ERR code=unknown_command");
    return;
  }

  currentFrame.state = stringForKey(line, "state=", currentFrame.state);
  currentFrame.red = uint8ForKey(line, "r=", currentFrame.red);
  currentFrame.green = uint8ForKey(line, "g=", currentFrame.green);
  currentFrame.blue = uint8ForKey(line, "b=", currentFrame.blue);
  currentFrame.mode = parseMode(stringForKey(line, "mode=", "steady"));
  testSolidUntilMs = 0;

  Serial.print("OK state=");
  Serial.print(currentFrame.state);
  Serial.print(" firmware_version=");
  Serial.print(FIRMWARE_VERSION);
  Serial.print(" protocol_version=");
  Serial.print(PROTOCOL_VERSION);
  Serial.print(" hardware_revision=");
  Serial.print(HARDWARE_REVISION);
  Serial.print(" hardware_device_id=");
  Serial.print(hardwareDeviceId);
  Serial.print(" r=");
  Serial.print(currentFrame.red);
  Serial.print(" g=");
  Serial.print(currentFrame.green);
  Serial.print(" b=");
  Serial.print(currentFrame.blue);
  Serial.println();
}

void printHello(const char* prefix) {
  Serial.print(prefix);
  Serial.print(" firmware_version=");
  Serial.print(FIRMWARE_VERSION);
  Serial.print(" protocol_version=");
  Serial.print(PROTOCOL_VERSION);
  Serial.print(" hardware_revision=");
  Serial.print(HARDWARE_REVISION);
  Serial.print(" hardware_device_id=");
  Serial.print(hardwareDeviceId);
  Serial.print(" protocol=");
  Serial.print(PROTOCOL_VERSION);
  Serial.println(" pins=1,2,3 baud=115200");
}

void applyFrame() {
  uint32_t nowMs = millis();
  if (nowMs - lastFrameAtMs < FRAME_MS) {
    return;
  }
  lastFrameAtMs = nowMs;

  if (testSolidUntilMs > 0 && nowMs < testSolidUntilMs) {
    writeRgb(testFrame.red, testFrame.green, testFrame.blue);
    return;
  }
  if (testSolidUntilMs > 0 && nowMs >= testSolidUntilMs) {
    testSolidUntilMs = 0;
  }

  uint8_t level = animationLevel(currentFrame.mode, nowMs);
  writeRgb(
    scaleColor(currentFrame.red, level),
    scaleColor(currentFrame.green, level),
    scaleColor(currentFrame.blue, level)
  );
}

uint8_t animationLevel(LightMode mode, uint32_t nowMs) {
  if (mode == MODE_STEADY) {
    return 255;
  }

  if (mode == MODE_BREATHE) {
    uint16_t period = BREATHE_PERIOD_MS;
    uint16_t phase = nowMs % period;
    uint16_t half = period / 2;
    uint16_t ramp = phase < half ? phase : period - phase;
    uint8_t wave = static_cast<uint8_t>((ramp * 255UL) / half);
    return 72 + static_cast<uint8_t>((wave * 183UL) / 255);
  }

  uint16_t period = mode == MODE_REPEAT_PULSE ? 900 : 560;
  return (nowMs % period) < (period / 2) ? 255 : 0;
}

uint8_t scaleColor(uint8_t value, uint8_t level) {
  return static_cast<uint8_t>((static_cast<uint16_t>(value) * level) / 255);
}

void writeRgb(uint8_t red, uint8_t green, uint8_t blue) {
  writePwm(RED_CHANNEL, RGB_RED_PIN, red);
  writePwm(GREEN_CHANNEL, RGB_GREEN_PIN, green);
  writePwm(BLUE_CHANNEL, RGB_BLUE_PIN, blue);
}

void writePwm(uint8_t channel, uint8_t pin, uint8_t value) {
  uint8_t duty = RGB_COMMON_ANODE ? 255 - value : value;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(pin, duty);
#else
  ledcWrite(channel, duty);
#endif
}

uint8_t uint8ForKey(const String& line, const char* key, uint8_t fallback) {
  String value = stringForKey(line, key, "");
  if (value.length() == 0) {
    return fallback;
  }
  return static_cast<uint8_t>(constrain(value.toInt(), 0, 255));
}

String stringForKey(const String& line, const char* key, const String& fallback) {
  int start = line.indexOf(key);
  if (start < 0) {
    return fallback;
  }
  start += strlen(key);
  int end = line.indexOf(' ', start);
  if (end < 0) {
    end = line.length();
  }
  return line.substring(start, end);
}

LightMode parseMode(const String& value) {
  if (value == "breathe") {
    return MODE_BREATHE;
  }
  if (value == "pulse") {
    return MODE_PULSE;
  }
  if (value == "repeat_pulse") {
    return MODE_REPEAT_PULSE;
  }
  return MODE_STEADY;
}

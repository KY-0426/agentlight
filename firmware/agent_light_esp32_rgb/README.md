# Agent Light ESP32 RGB Firmware

This firmware drives a 4-pin RGB LED connected to an ESP32 Mini board.

## Wiring

| RGB LED pin | ESP32 Mini pin |
| --- | --- |
| R | GPIO 1 |
| G | GPIO 2 |
| B | GPIO 3 |
| GND | G |

The sketch assumes a common-cathode RGB LED. If the LED is common-anode, set `RGB_COMMON_ANODE` to `true` in `agent_light_esp32_rgb.ino`.

GPIO 1 and GPIO 3 are UART pins on some classic ESP32 boards. If your board uses those pins for USB serial, move the LED to three free PWM-capable GPIOs and update `RGB_RED_PIN`, `RGB_GREEN_PIN`, and `RGB_BLUE_PIN`.

During bring-up, Agent Light sends pure channel colors for three states: `standby` is blue-only breathing, `completed` is green-only blinking, and `attention` is red-only blinking. `working` is yellow steady. If every state looks green, the green channel is the only channel being driven; check the red/blue wires, GPIO 1/3 conflicts, or common-anode inversion.

## Serial Protocol

The desktop app sends one line per state change:

```text
AGENT_LIGHT protocol=agent-light-rgb-v1 state=working r=255 g=191 b=0 mode=steady seq=12
```

Supported modes:

- `steady`
- `breathe`
- `pulse`
- `repeat_pulse`

`pulse` and `repeat_pulse` are full on/off blink modes in the current sketch.

The firmware accepts `PING`, `HELLO`, and `VERSION` for diagnostics. It replies with the
firmware version, protocol version, and hardware revision:

```text
PONG firmware_version=0.2.0 protocol_version=agent-light-rgb-v1 hardware_revision=esp32-mini-rgb-dev protocol=agent-light-rgb-v1 pins=1,2,3 baud=115200
```

## Build And Upload

Using Arduino IDE:

1. Open `firmware/agent_light_esp32_rgb/agent_light_esp32_rgb.ino`.
2. Select your ESP32 board.
3. Select the USB serial port.
4. Upload.

Using `arduino-cli`:

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 firmware/agent_light_esp32_rgb
arduino-cli upload -p /dev/cu.usbmodemXXXX --fqbn esp32:esp32:esp32 firmware/agent_light_esp32_rgb
```

Replace `/dev/cu.usbmodemXXXX` with the actual board port.

## Desktop App Integration

Agent Light auto-detects macOS USB serial ports in this order:

1. `/dev/cu.usbmodem*`
2. `/dev/cu.usbserial*`
3. `/dev/tty.usbmodem*`
4. `/dev/tty.usbserial*`

Override the port when needed:

```bash
AGENT_LIGHT_SERIAL_PORT=/dev/cu.usbmodemXXXX npm run tauri dev
```

Disable hardware writes:

```bash
AGENT_LIGHT_HARDWARE=0 npm run tauri dev
```

The default baud rate is `115200`. Override it with `AGENT_LIGHT_SERIAL_BAUD`.

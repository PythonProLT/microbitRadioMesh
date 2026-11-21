# radio-mesh

A MakeCode extension for the **micro:bit V2** that lets many micro:bits behave like one network:

- every micro:bit has a **name**; you send a message to a name (or to `*` for everyone)
- every micro:bit **relays** what it hears, so a message can travel past the range of a single radio
- each micro:bit can have up to **four sensor channels** (kind + pin + threshold) that you set up by typing a short command, over USB or over the radio
- the name, channel setup and your own variables are **saved to flash** and survive power loss

You can use it for sensors, remote controls, classroom networks, or anything else where several micro:bits need to talk to each other and be set up without re-flashing them.

## Requirements

- A micro:bit with working flash storage (V2).
- Saving uses a separate flash storage extension, listed as a dependency in `pxt.json`. MakeCode adds it automatically when you add this extension. Its licence (MIT) applies to its own code; this repository only calls it and does not copy it.
- Flash entries are limited on the micro:bit. This extension keeps its own use small: the name and quiet time share one entry, channels 1-2 share one and channels 3-4 share one, and each variable you save uses one more.

## Add it to a project

In MakeCode choose **Extensions**, paste this repository's URL into the search box, press Enter, and select it.

## Quick start: sensors

Add this extension, plus the **Radio** and **Datalogger** extensions (they are built into MakeCode). You will then see two extra tabs, **Sensor node** and **Main node**.

The extension does all the mesh work in **one block** per micro:bit, plus the clock, the setup commands and pairing. Your own program does just two things: **read the sensor** and **log the data**. Full programs are in `examples/sensor.py` and `examples/main.py`; in blocks they look like this.

**Every sensor micro:bit**

```
on start
    start sensor mesh on radio group 1
    set column titles "timestamp", "channel", "value"
    on log full: delete log, set column titles again

forever
    if channel 1 is enabled
        set distance to sonar distance (mm) on pin (channel 1 pin number)
        if channel 1 detects distance and quiet time has passed
            datalogger log timestamp, channel, distance
            mesh send to "main": "LOG 1 sonar <time> <distance>"
    pause 300 ms
```

**The main micro:bit**

```
on start
    start main mesh on radio group 1
    set column titles "timestamp", "sensor", "channel", "kind", "value"

on report received (sender, text)
    serial write line  sender > text
    if word 1 of text = "LOG"
        datalogger log timestamp, sender, channel, kind, value
```

Plug the main micro:bit into a computer, open a serial monitor at **115200 baud**, and type:

```
TIME 12 34 56
DATE 11 21 2026
```
This sets the clock on the main micro:bit and on every sensor. Plug a sensor into the computer once to name it:

```
SET name north1
```

Every line you type is echoed back as `> line` and then answered. From the main micro:bit's console, tell the sensor what is connected to it:

```
@north1 PAIR sonar
@north1 STATUS
```

`PAIR` works for `sonar`, `pir`, `digital`, `mic` and `analog`. Trigger the sensor while it scans (about 8 seconds): wave at a PIR, make a noise at a mic. `HELP` lists every command.

| Block | What it does |
|---|---|
| `start sensor mesh` | joins the mesh with the saved name, relays other nodes' messages, answers `PAIR`, `TIME`, `DATE`, `STATUS`, `READ`, `CFG`, `SET`... |
| `on unknown command` / `reply with` | your program answers commands the extension doesn't know, like `LOGCLEAR` |
| `start main mesh` | joins as `main`, relays, keeps the clock, runs the serial console |
| `on report received` | your blocks run for every message `main` receives (detections and replies) |
| `on unknown console command` | your program handles console lines the extension doesn't know |
| `report sender`, `report text` | the current report, if you prefer reporters to the handler's parameters |
| `sonar distance (mm) on pin` | reads a 3-wire Sonar:bit style sensor (distance in mm, 0 = no echo) |

Needs a micro:bit V2.

## Building your own program

Every micro:bit runs the same kind of program:

```ts
mesh.defaultName("unnamed")      // used only until a name has been saved
mesh.start(1)                    // radio group 1; all nodes must use the same group
commands.enableSerial()          // lets a computer configure this micro:bit over USB

mesh.onMessage(function (sender, payload, to) {
    basic.showString(payload)
})

input.onButtonPressed(Button.A, function () {
    mesh.send("alice", "hello")  // use "*" to send to every node
})
```

Plug a micro:bit into a computer, open a serial terminal at **115200 baud** (or the MakeCode console), and type:

```
SET name alice
```

The name is saved. From now on `mesh.send("alice", ...)` reaches it, from anywhere the mesh covers.

## How messages travel

A message is `to|payload|from`. The radio can only send 19 characters at a time, so each message is cut into fragments, sent, and put back together at the other end. Payloads can be roughly 80 characters minus the two names.

Each fragment also carries a short trail of one-character tags (made from node names), one per node that has sent or relayed it. A node that finds its own tag in the trail ignores the fragment, so messages never loop back through the same node. Two names can occasionally share a tag; if a node can't hear a neighbour it should, rename one of them.

Every node that hears a fragment for the first time repeats it after a short random delay, up to a hop limit (default 4, `mesh.setMaxHops` up to 4). A node acts on a message only if the `to` name is its own name or `*`.

Things to know:

- There is **no acknowledgement or retry**. If a message is lost to a collision or weak signal it is simply gone.
- There is **no security**. Anyone on the same radio group can send, and the sender name is only text. Use a different group number for separate networks.
- Every node repeats everything, so a very chatty network will collide. Keep messages infrequent.
- Names are 1-12 characters, cannot contain `|` or `,`, and cannot be `*`.

## Sensor channels

A channel has a **kind** (a label of up to 7 characters), a **pin number** and a **threshold** (0-9999).

| kind | read by | counts as a detection when |
| --- | --- | --- |
| `pir`, `digital` | `channel.read(n)` (digital pin) | the pin reads 1 |
| `mic` | `channel.read(n)` (analog peak-to-peak over 50 ms) | the level is **above** the threshold |
| `analog` | `channel.read(n)` (analog pin) | the value is **above** the threshold |
| `sonar` | your program (see below) | the reading is above 0 and **below** the threshold |
| anything else | your program | the reading is **above** the threshold |

Analog kinds (`mic`, `analog`) must use pin 0, 1, 2, 3, 4 or 10. Other kinds can use pins 0-16.

For a kind the extension doesn't read for you (such as `sonar`), tell it how once, in your program. The extension then reads it through `channel.read(n)` like the others:

```ts
channel.onCustomRead(function (kind, pin) {
    if (kind == "sonar") {
        channel.setReading(mySonarRead(channel.digitalPin(pin)))
    }
})
```

Use `channel.triggered(n, value)` to decide whether a reading counts as a detection.

### Pairing: let the micro:bit find the sensor

`channel.pair("sonar")` (or `pir`, `digital`, `mic`, `analog`) looks for a sensor of that kind on a pin no channel uses yet, and saves it in the first free channel. It takes up to 8 seconds, so trigger the sensor while it runs.

| Kind | How it decides a pin has one |
|---|---|
| `sonar` | 2 of 3 readings between 20 and 4000 mm (needs `onCustomRead` as above). Tries pins 0, 1, 2, 8, 12-16 |
| `pir`, `digital` | the pin reads high at some moment in the 8 seconds (move in front of the PIR). Same pins |
| `mic` | on pin 0, 1 or 2: quiet at some moment and loud at another (make a noise). The threshold is set halfway |
| `analog` | on pin 0, 1 or 2: the value moves by 150 or more (turn the knob). The threshold is set halfway |

Pin 3, 4, 6, 7, 9 and 10 (LED screen), 5 and 11 (buttons) and 19 and 20 (I2C) are never scanned. A pin already used by a channel is skipped, so pair one sensor at a time and pair the sonar first, because a sonar on a free pin can look like a "digital" sensor. An unplugged analog pin can wander on its own, so keep the other analog pins quiet.

Over USB serial, or from the main node as `@north1 PAIR sonar`; `UNPAIR 2` frees channel 2.

## Commands

The same text works over USB serial (after `commands.enableSerial()` or `commands.handleSerialLine`) and as the payload of a mesh message (`commands.run(payload)` returns the reply to send back).

| command | effect |
| --- | --- |
| `CFG` | show name, quiet time and enabled channels |
| `SET name north1` | rename this node (saved) |
| `SET quiet 10` | minimum seconds between reports per channel (saved) |
| `SET ch1 sonar 2 500` | channel 1: kind, pin, threshold (saved) |
| `SET ch2 off` | switch channel 2 off |
| `PAIR sonar` | find a sonar (or `pir`, `digital`, `mic`, `analog`) on a free pin and save it in the first free channel (up to 8 s) |
| `UNPAIR 2` | switch channel 2 off |
| `SET <variable> <value>` | save your own text variable |
| `GET <name, quiet, chN or variable>` | read a setting or variable |
| `DEL <variable>`, `KEYS`, `FORGET` | delete one variable, list variables, delete all variables |

Replies start with `OK`, `ERR`, `NONE` or are the value itself.

## Blocks

- **Sensor node**: start sensor mesh, on unknown command, reply with
- **Main node**: start main mesh, on report received, on unknown console command, report sender, report text
- **Clock**: set time, set date, time, date
- **Mesh**: start mesh, send message, send value, on message, on value, set/get name, default name, max hops, last signal strength, fragments relayed
- **Channels**: channel kind / pin / threshold / enabled / description, set channel, read channel, channel detects, quiet time, pin helpers
- **Commands**: run config command, handle serial line, accept config commands over serial, word / text after word
- **Saved data**: save and read your own text or number variables

## Limits

- Whether saved data survives re-flashing depends on the flash storage extension and the board. Check this on your own board before relying on it.
- Variable names are limited to 12 characters, and the number of saved variables is limited by the flash storage extension.
- Writes to flash are skipped when the value hasn't changed, but do not save in a fast loop.
- micro:bit radio range is a few tens of metres in the open and much less through walls. Test your own layout.

## License

MIT

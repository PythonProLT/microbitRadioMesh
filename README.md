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

## Quick start

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

For a kind the extension doesn't read for you, read the sensor yourself using the channel's pin:

```ts
if (channel.kind(1) == "sonar") {
    // read the sensor with its own extension, using the channel's saved pin
    value = mySonarRead(channel.digitalPin(channel.pin(1)))
}
```

and use `channel.triggered(1, value)` to decide whether it counts as a detection.

## Commands

The same text works over USB serial (after `commands.enableSerial()` or `commands.handleSerialLine`) and as the payload of a mesh message (`commands.run(payload)` returns the reply to send back).

| command | effect |
| --- | --- |
| `CFG` | show name, quiet time and enabled channels |
| `SET name north1` | rename this node (saved) |
| `SET quiet 10` | minimum seconds between reports per channel (saved) |
| `SET ch1 sonar 2 500` | channel 1: kind, pin, threshold (saved) |
| `SET ch2 off` | switch channel 2 off |
| `SET <variable> <value>` | save your own text variable |
| `GET <name, quiet, chN or variable>` | read a setting or variable |
| `DEL <variable>`, `KEYS`, `FORGET` | delete one variable, list variables, delete all variables |

Replies start with `OK`, `ERR`, `NONE` or are the value itself.

## Blocks

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

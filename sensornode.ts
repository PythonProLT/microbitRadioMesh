/**
 * Sensor node: everything except reading the sensor and logging the data.
 *
 *   start sensor mesh on radio group 1
 *
 * That one block joins the mesh with the node's saved name, relays other nodes' messages, keeps
 * the clock, and answers commands typed on USB serial or sent from the main node:
 *      PING  STATUS  READ 1  SONAR 2  TIME 12 34 56  DATE 11 21 2026  SYNC (from main)  HELP
 *      CFG  SET ...  GET ...  PAIR sonar  UNPAIR 2
 * Over USB serial every line you type is echoed back as  > <line>  and then answered.
 * Your program reads the sensor (for example channel.sonarMm), logs with the datalogger and
 * sends reports with mesh.send. A command the extension doesn't know is handed to
 * "on unknown command" so you can add your own (for example LOGCLEAR).
 *
 * Needs the Radio extension.
 */
//% color="#16A085" weight=95 icon="" block="Sensor node"
namespace sensornode {
    let started = false
    let jobText: string[] = []
    let jobFrom: string[] = []
    let pairCommand = ""
    let pairReplyTo = ""
    let replyText = ""
    let commandHandler: (verb: string, text: string) => void = null
    let syncHandler: (syncId: number, ms: number, hops: number) => void = null
    let syncIds: number[] = []
    let syncMss: number[] = []
    let syncHops: number[] = []

    /** Work out the reply to one command. (PAIR is handled separately when it arrives by radio.) */
    function respond(payload: string): string {
        const verb = commands.word(1, payload).toUpperCase()
        const configReply = commands.run(payload)
        if (configReply != "") return configReply
        if (verb == "PING") return "PONG"
        if (verb == "STATUS") {
            return "v=0.10.2 up=" + Math.idiv(input.runningTime(), 1000) + " t=" + input.temperature() +
                " sig=" + mesh.lastSignal() + " rel=" + mesh.relayedCount() + " clk=" + clock.time()
        }
        if (verb == "READ") {
            const n = parseFloat(commands.word(2, payload))
            if (!(n >= 1 && n <= channel.MAX) || !channel.enabled(n)) return "ERR channel off"
            return "ch" + n + "=" + channel.read(n)
        }
        if (verb == "TIME") {
            if (!clock.setTime(parseFloat(commands.word(2, payload)), parseFloat(commands.word(3, payload)), parseFloat(commands.word(4, payload)))) {
                return "ERR usage: TIME 12 34 56"
            }
            return "OK " + clock.time()
        }
        if (verb == "DATE") {
            if (!clock.setDate(parseFloat(commands.word(2, payload)), parseFloat(commands.word(3, payload)), parseFloat(commands.word(4, payload)))) {
                return "ERR usage: DATE 11 21 2026"
            }
            return "OK " + clock.date()
        }
        if (verb == "STATS") return mesh.stats()
        if (verb == "HEAR") {
            const w1 = commands.word(2, payload)
            if (w1.length == 0) return "ERR usage: HEAR <names> or HEAR ALL"
            if (w1.toUpperCase() == "ALL") {
                mesh.hearAll()
                return "OK hearing everyone"
            }
            mesh.hearOnly(commands.textAfter(1, payload))
            return "OK hearing only " + commands.textAfter(1, payload)
        }
        if (verb == "SPEAK") {
            const w1 = commands.word(2, payload)
            if (w1.length == 0) return "ERR usage: SPEAK <up to 3 names> or SPEAK ALL"
            if (w1.toUpperCase() == "ALL") {
                mesh.speakAll()
                return "OK speaking to everyone"
            }
            mesh.speakOnly(commands.textAfter(1, payload))
            return "OK speaking only to " + commands.textAfter(1, payload)
        }
        if (verb == "LEAVE") {
            const sec = parseFloat(commands.word(2, payload))
            if (!(sec >= 1 && sec <= 3600)) return "ERR usage: LEAVE <seconds 1-3600>"
            mesh.leave(sec)
            return "OK LEAVING for " + Math.floor(sec) + " s, back automatically"
        }
        if (verb == "SONAR") {
            const p = parseFloat(commands.word(2, payload))
            if (!(p >= 0 && p <= 16)) return "ERR usage: SONAR <pin 0-16>"
            // three independent readings, with our own sending held and a pause between pings (same on serial and mesh)
            mesh.pauseRadio()
            const us = channel.sonarEchoUs(p)
            basic.pause(80)
            const poll = channel.sonarPollUs(p)
            basic.pause(80)
            const sb = sonarbit.sonarbit_distance(Distance_Unit.Distance_Unit_mm, channel.digitalPin(p))
            mesh.resumeRadio()
            return "p" + p + " pulsein_us=" + us + " poll_us=" + poll + " sonarbit_mm=" + sb
        }
        if (verb == "HELP") return "PING STATUS STATS HEAR SPEAK READ n SONAR n LEAVE s TIME DATE CFG SET PAIR UNPAIR"
        if (commandHandler) {
            replyText = ""
            commandHandler(verb, payload)
            if (replyText != "") return replyText
        }
        return "ERR UNKNOWN"
    }

    // background jobs: pairing takes seconds, and sensor readings are timing-sensitive, so they are done here
    // (not inside the radio's message handler) and with the radio switched off during the reading itself
    function pairLoop() {
        while (true) {
            while (syncIds.length > 0) {
                const sid = syncIds.shift()
                const sms = syncMss.shift()
                const shops = syncHops.shift()
                if (syncHandler) syncHandler(sid, sms, shops)
            }
            while (jobText.length > 0) {
                const text = jobText.shift()
                const from = jobFrom.shift()
                mesh.send(from, respond(text))
            }
            if (pairCommand != "") {
                const cmd = pairCommand
                pairCommand = ""
                mesh.send(pairReplyTo, commands.run(cmd))
            }
            basic.pause(200)
        }
    }

    /**
     * Join the mesh and answer commands. Put this one block in "on start".
     * All sensor nodes and the main node must use the same radio group.
     */
    //% block="start sensor mesh on radio group %group"
    //% group.min=0 group.max=255 group.defl=1
    //% group="Sensor node" weight=100
    export function start(group: number) {
        if (started) return
        started = true
        mesh.defaultName("unnamed")
        mesh.start(group)
        mesh.onMessage(function (sender: string, payload: string, to: string) {
            const arrived = input.runningTime()   // read the millisecond counter first, for SYNC
            if (commands.word(1, payload).toUpperCase() == "SYNC") {
                if (syncIds.length < 4) {
                    syncIds.push(parseFloat(commands.word(2, payload)))
                    syncMss.push(arrived)
                    syncHops.push(mesh.lastHops())
                }
                mesh.send(sender, "SYNCED " + commands.word(2, payload) + " hops=" + mesh.lastHops())
            } else if (commands.word(1, payload).toUpperCase() == "PAIR") {
                pairCommand = payload
                pairReplyTo = sender
                mesh.send(sender, "PAIRING, up to 8 s: trigger the sensor")
            } else if (commands.word(1, payload).toUpperCase() == "READ" || commands.word(1, payload).toUpperCase() == "SONAR") {
                if (jobText.length < 4) {
                    jobText.push(payload)
                    jobFrom.push(sender)
                }
            } else {
                let reply = respond(payload)
                // show how the command reached us: how many hops, and through whom
                if (reply == "PONG") reply = "PONG hops=" + mesh.lastHops() + " via " + mesh.lastPath()
                mesh.send(sender, reply)
            }
        })
        serial.setRxBufferSize(128)   // the default is 20 bytes, which cuts longer commands short
        serial.onDataReceived(serial.delimiters(Delimiters.NewLine), function () {
            let line = ""
            const typed = serial.readLine()
            for (let i = 0; i < typed.length; i++) {
                if (typed.charAt(i) != "\r") line += typed.charAt(i)
            }
            if (commands.word(1, line).length == 0) return
            serial.writeLine("> " + line)      // mirror what was typed
            const reply = respond(line)
            if (reply != "") serial.writeLine(reply)
        })
        control.inBackground(pairLoop)
    }

    /**
     * Runs when the main node sends SYNC. It hands you the sync number, this micro:bit's millisecond counter at the
     * moment the sync arrived, and how many hops it took. Log them as a row; classify.py uses those rows to line up
     * the clocks of nodes that are on different micro:bits.
     */
    //% block="on sync"
    //% draggableParameters="reporter"
    //% group="Sensor node" weight=85
    export function onSync(handler: (syncId: number, ms: number, hops: number) => void) {
        syncHandler = handler
    }

    let lastTriggered = [-1000000, -1000000, -1000000, -1000000]
    let hitChannel = 0
    let hitValue = 0

    /**
     * Checks every sensor you have set up and says true when one has triggered (a sonar sees something,
     * a motion sensor goes high, ...). It also tells the main node, and won't trigger the same sensor again
     * until its quiet time has passed. Use "triggered sensor ..." below to log what it saw.
     */
    //% block="a sensor triggered"
    //% group="Sensor node" weight=82
    export function sensorTriggered(): boolean {
        for (let n = 1; n <= 4; n++) {
            if (!channel.enabled(n)) continue
            const v = channel.read(n)
            if (channel.triggered(n, v) && input.runningTime() - lastTriggered[n - 1] > channel.quietMs()) {
                lastTriggered[n - 1] = input.runningTime()
                hitChannel = n
                hitValue = v
                mesh.send("main", "LOG " + n + " " + channel.kind(n) + " " + clock.time() + " " + v)
                return true
            }
        }
        basic.pause(60)
        return false
    }

    /** Channel number (1 to 4) of the sensor that just triggered. */
    //% block="triggered sensor channel"
    //% group="Sensor node" weight=81
    export function triggeredChannel(): number {
        return hitChannel
    }

    /** Kind of the sensor that just triggered: sonar, pir, digital, mic or analog. */
    //% block="triggered sensor kind"
    //% group="Sensor node" weight=80
    export function triggeredKind(): string {
        return channel.kind(hitChannel)
    }

    /** Pin of the sensor that just triggered. */
    //% block="triggered sensor pin"
    //% group="Sensor node" weight=79
    export function triggeredPin(): number {
        return channel.pin(hitChannel)
    }

    /** Reading of the sensor that just triggered (sonar: mm, motion sensor: 1). */
    //% block="triggered sensor reading"
    //% group="Sensor node" weight=78
    export function triggeredReading(): number {
        return hitValue
    }

    /**
     * Runs when a command arrives that the extension doesn't know. The verb is the first word in capitals
     * (for example LOGCLEAR); the text is the whole command. Answer with "reply with".
     */
    //% block="on unknown command"
    //% draggableParameters="reporter"
    //% group="Sensor node" weight=90
    export function onUnknownCommand(handler: (verb: string, text: string) => void) {
        commandHandler = handler
    }

    /** Set the answer to the command being handled. Use inside "on unknown command". */
    //% block="reply with %text"
    //% group="Sensor node" weight=89
    export function replyWith(text: string) {
        replyText = text
    }
}

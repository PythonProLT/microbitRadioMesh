/**
 * Sensor node: the mesh part is ONE block, the sensor part is a few simple blocks you can see.
 *
 *   on start:                 start sensor mesh on radio group 1
 *   on sensor detection:      log this detection to datalogger
 *                             report this detection to "main"
 *
 * "start sensor mesh" does all the radio work for you: it joins the mesh with its saved name,
 * relays other nodes' messages, and answers commands typed on USB serial or sent from the
 * main node:
 *      PING  STATUS  READ 1  LAST  TIME 12 34 56  DATE 11 21 2026  LOGCLEAR  HELP
 *      CFG  SET ...  GET ...  PAIR sonar  UNPAIR 2
 * "on sensor detection" runs your blocks each time a channel (see SET / PAIR) detects something,
 * no more often than the channel's quiet time.
 *
 * Needs the Radio and Datalogger extensions (micro:bit V2).
 */
//% color="#16A085" weight=95 icon="" block="Sensor node"
namespace sensornode {
    let started = false
    let reading = false
    let logReady = false
    let checkMs = 300
    let lastEvent = "none"
    let logResets = 0
    let pairCommand = ""
    let pairReplyTo = ""
    let lastSent: number[] = []
    let detectHandler: (channelNo: number, kind: string, value: number) => void = null
    // the detection that is being handled right now
    let curChannel = 0
    let curKind = ""
    let curValue = 0
    let curTime = ""

    // ----------------------------- datalogger -----------------------------

    function resetLog() {
        datalogger.deleteLog(datalogger.DeleteType.Fast)
        datalogger.setColumnTitles("timestamp", "channel", "value")
    }

    function prepareLog() {
        if (logReady) return
        logReady = true
        datalogger.setColumnTitles("timestamp", "channel", "value")
        datalogger.onLogFull(function () {
            logResets++
            resetLog()
        })
    }

    // ----------------------------- commands -----------------------------

    /** Work out the reply to one command. (PAIR is handled separately when it arrives by radio.) */
    function respond(payload: string): string {
        const verb = commands.word(1, payload).toUpperCase()
        const configReply = commands.run(payload)
        if (configReply != "") return configReply
        if (verb == "PING") return "PONG"
        if (verb == "STATUS") {
            return "up=" + Math.idiv(input.runningTime(), 1000) + " t=" + input.temperature() +
                " sig=" + mesh.lastSignal() + " rel=" + mesh.relayedCount() + " clr=" + logResets
        }
        if (verb == "READ") {
            const n = parseFloat(commands.word(2, payload))
            if (!(n >= 1 && n <= channel.MAX) || !channel.enabled(n)) return "ERR channel off"
            return "ch" + n + "=" + channel.read(n)
        }
        if (verb == "LAST") return "last " + lastEvent
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
        if (verb == "LOGCLEAR") {
            prepareLog()
            resetLog()
            return "OK log cleared"
        }
        if (verb == "HELP") return "PING STATUS READ n LAST TIME DATE LOGCLEAR PAIR CFG SET"
        return "ERR UNKNOWN"
    }

    // background job: pairing takes a few seconds, so it is done here and the radio stays free
    function pairLoop() {
        while (true) {
            if (pairCommand != "") {
                const cmd = pairCommand
                pairCommand = ""
                mesh.send(pairReplyTo, commands.run(cmd))
            }
            basic.pause(200)
        }
    }

    // ----------------------------- the mesh block -----------------------------

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
            if (commands.word(1, payload).toUpperCase() == "PAIR") {
                pairCommand = payload
                pairReplyTo = sender
                mesh.send(sender, "PAIRING, up to 8 s: trigger the sensor")
            } else {
                mesh.send(sender, respond(payload))
            }
        })
        serial.onDataReceived(serial.delimiters(Delimiters.NewLine), function () {
            const reply = respond(serial.readLine())
            if (reply != "") serial.writeLine(reply)
        })
        control.inBackground(pairLoop)
    }

    // ----------------------------- the sensor blocks -----------------------------

    function readLoop() {
        while (true) {
            for (let n = 1; n <= channel.MAX; n++) {
                if (!channel.enabled(n)) continue
                const value = channel.read(n)
                if (channel.triggered(n, value) && input.runningTime() - lastSent[n - 1] > channel.quietMs()) {
                    lastSent[n - 1] = input.runningTime()
                    curChannel = n
                    curKind = channel.kind(n)
                    curValue = value
                    curTime = clock.time()
                    lastEvent = n + " " + curKind + " " + curTime + " " + value
                    if (detectHandler) detectHandler(n, curKind, value)
                }
            }
            basic.pause(checkMs)
        }
    }

    /**
     * Runs your blocks each time a channel detects something. Set channels up with the
     * commands SET ch1 sonar 2 500 or PAIR sonar. The detection is the channel number,
     * its kind (sonar, pir, mic...) and the reading.
     */
    //% block="on sensor detection"
    //% draggableParameters="reporter"
    //% group="Sensor node" weight=90
    export function onDetection(handler: (channelNo: number, kind: string, value: number) => void) {
        detectHandler = handler
        if (reading) return
        reading = true
        for (let i = 0; i < channel.MAX; i++) lastSent.push(-1000000)
        control.inBackground(readLoop)
    }

    /** Save the current detection in the datalogger with the date and time. Clears the log by itself when it is full. */
    //% block="log this detection to datalogger"
    //% group="Sensor node" weight=80
    export function logDetection() {
        prepareLog()
        datalogger.log(
            datalogger.createCV("timestamp", clock.date() + " " + curTime),
            datalogger.createCV("channel", curChannel),
            datalogger.createCV("value", curValue)
        )
    }

    /** Send the current detection to another node (normally "main"). */
    //% block="report this detection to %name"
    //% name.defl="main"
    //% group="Sensor node" weight=79
    export function reportDetection(name: string) {
        mesh.send(name, "LOG " + lastEvent)
    }

    /** How often the channels are read, in milliseconds (default 300). */
    //% block="check sensors every %ms ms"
    //% ms.min=50 ms.max=10000 ms.defl=300
    //% group="Options" weight=60
    export function checkEvery(ms: number) {
        checkMs = Math.max(50, Math.floor(ms))
    }

    /** The last detection, like "1 sonar 12:30:00 237", or "none". */
    //% block="last detection"
    //% group="Options" weight=59
    export function lastDetection(): string {
        return lastEvent
    }
}

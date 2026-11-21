/**
 * Sensor node: everything except reading the sensor and logging the data.
 *
 *   start sensor mesh on radio group 1
 *
 * That one block joins the mesh with the node's saved name, relays other nodes' messages, keeps
 * the clock, and answers commands typed on USB serial or sent from the main node:
 *      PING  STATUS  READ 1  SONAR 2  TIME 12 34 56  DATE 11 21 2026  HELP
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
    let pairCommand = ""
    let pairReplyTo = ""
    let replyText = ""
    let commandHandler: (verb: string, text: string) => void = null

    /** Work out the reply to one command. (PAIR is handled separately when it arrives by radio.) */
    function respond(payload: string): string {
        const verb = commands.word(1, payload).toUpperCase()
        const configReply = commands.run(payload)
        if (configReply != "") return configReply
        if (verb == "PING") return "PONG"
        if (verb == "STATUS") {
            return "up=" + Math.idiv(input.runningTime(), 1000) + " t=" + input.temperature() +
                " sig=" + mesh.lastSignal() + " rel=" + mesh.relayedCount()
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
            const us = channel.sonarEchoUs(p)
            // two independent readings: our own pulse (echo_us) and the sonarbit extension (mm)
            return "p" + p + " echo_us=" + us + " sonarbit_mm=" + channel.sonarMm(p)
        }
        if (verb == "HELP") return "PING STATUS STATS HEAR SPEAK READ n SONAR n LEAVE s TIME DATE CFG SET PAIR UNPAIR"
        if (commandHandler) {
            replyText = ""
            commandHandler(verb, payload)
            if (replyText != "") return replyText
        }
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

/**
 * Sensor node: everything except reading the sensor and logging the data.
 *
 *   start sensor mesh on radio group 1
 *
 * That one block joins the mesh with the node's saved name, relays other nodes' messages, keeps
 * the clock, and answers commands typed on USB serial or sent from the main node:
 *      PING  STATUS  READ 1  TIME 12 34 56  DATE 11 21 2026  HELP
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
        if (verb == "HELP") return "PING STATUS READ n TIME DATE CFG SET PAIR UNPAIR"
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
                mesh.send(sender, respond(payload))
            }
        })
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

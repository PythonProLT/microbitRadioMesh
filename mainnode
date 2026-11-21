/**
 * Main node: the mesh part is ONE block, receiving and logging are a few simple blocks you can see.
 *
 *   on start:                 start main mesh on radio group 1
 *   on report received:       print this report to serial
 *                             log this report to datalogger
 *
 * "start main mesh" joins the mesh as "main", relays other nodes' messages, and runs the
 * serial console. Plug the micro:bit into a computer, open a serial monitor at 115200 baud
 * and type:
 *   @north1 STATUS          send a command to the node named north1 (any command works)
 *   @* CFG                  send to every node
 *   pair a sonar on north1  find a sonar on a free pin of north1 and save it
 *                           (also: pir, digital, mic, analog; trigger the sensor while it scans)
 *   TIME 12 34 56           set this clock and every node's clock
 *   DATE 11 21 2026         set this date and every node's date (month day year)
 *   LOGCLEAR                empty this micro:bit's datalogger
 *   SET name main / CFG     configure this micro:bit itself
 *   HELP                    show this list
 * Everything the sensors send back (detections and replies) arrives in "on report received".
 *
 * Needs the Radio and Datalogger extensions (micro:bit V2).
 */
//% color="#C0392B" weight=94 icon="" block="Main node"
namespace mainnode {
    let started = false
    let logReady = false
    let reportHandler: (sender: string, text: string) => void = null
    // the report that is being handled right now
    let curSender = ""
    let curText = ""

    function resetLog() {
        datalogger.deleteLog(datalogger.DeleteType.Fast)
        datalogger.setColumnTitles("timestamp", "sensor", "channel", "kind", "value")
    }

    function prepareLog() {
        if (logReady) return
        logReady = true
        datalogger.setColumnTitles("timestamp", "sensor", "channel", "kind", "value")
        datalogger.onLogFull(function () {
            resetLog()
            serial.writeLine("NOTE log was full and has been cleared")
        })
    }

    // ----------------------------- the serial console -----------------------------

    function help() {
        serial.writeLine("@name <command>   send a command to a sensor (@* = all)")
        serial.writeLine("pair a sonar on <name>   (sonar, pir, digital, mic, analog)")
        serial.writeLine("TIME 12 34 56   DATE 11 21 2026   LOGCLEAR")
        serial.writeLine("sensor commands: PING STATUS READ n LAST CFG SET PAIR UNPAIR LOGCLEAR")
    }

    function pairLine(line: string) {
        let kind = commands.word(2, line)
        let at = 3
        if (kind.toLowerCase() == "a" || kind.toLowerCase() == "an") {
            kind = commands.word(3, line)
            at = 4
        }
        if (kind.length > 0 && commands.word(at, line).toLowerCase() == "on" && commands.word(at + 1, line).length > 0) {
            const target = commands.word(at + 1, line)
            mesh.send(target, "PAIR " + kind)
            serial.writeLine("SENT PAIR " + kind + " to " + target)
        } else {
            serial.writeLine("usage: pair a sonar on north1")
        }
    }

    function handleLine(line: string) {
        const first = commands.word(1, line)
        if (first.length == 0) return
        const verb = first.toUpperCase()
        if (first.charAt(0) == "@") {
            const target = first.substr(1)
            if (target.length == 0) {
                serial.writeLine("usage: @name command")
                return
            }
            mesh.send(target, commands.textAfter(1, line))
            serial.writeLine("SENT " + target)
        } else if (verb == "TIME") {
            if (!clock.setTime(parseFloat(commands.word(2, line)), parseFloat(commands.word(3, line)), parseFloat(commands.word(4, line)))) {
                serial.writeLine("ERR usage: TIME 12 34 56")
                return
            }
            mesh.send("*", line)
            serial.writeLine("OK TIME " + clock.time())
        } else if (verb == "DATE") {
            if (!clock.setDate(parseFloat(commands.word(2, line)), parseFloat(commands.word(3, line)), parseFloat(commands.word(4, line)))) {
                serial.writeLine("ERR usage: DATE 11 21 2026")
                return
            }
            mesh.send("*", line)
            serial.writeLine("OK DATE " + clock.date())
        } else if (verb == "PAIR") {
            pairLine(line)
        } else if (verb == "LOGCLEAR") {
            prepareLog()
            resetLog()
            serial.writeLine("OK log cleared")
        } else if (verb == "HELP") {
            help()
        } else if (!commands.handleSerialLine(line)) {
            serial.writeLine("ERR UNKNOWN (type HELP)")
        }
    }

    // ----------------------------- the mesh block -----------------------------

    /**
     * Join the mesh as "main" and start the serial console. Put this one block in "on start".
     * All sensor nodes and the main node must use the same radio group.
     */
    //% block="start main mesh on radio group %group"
    //% group.min=0 group.max=255 group.defl=1
    //% group="Main node" weight=100
    export function start(group: number) {
        if (started) return
        started = true
        mesh.defaultName("main")
        mesh.start(group)
        mesh.onMessage(function (sender: string, payload: string, to: string) {
            curSender = sender
            curText = payload
            if (reportHandler) reportHandler(sender, payload)
        })
        serial.onDataReceived(serial.delimiters(Delimiters.NewLine), function () {
            handleLine(serial.readLine())
        })
    }

    // ----------------------------- the receiving and logging blocks -----------------------------

    /** Runs your blocks for every message the main node receives: detections (LOG ...) and replies to your commands. */
    //% block="on report received"
    //% draggableParameters="reporter"
    //% group="Main node" weight=90
    export function onReport(handler: (sender: string, text: string) => void) {
        reportHandler = handler
    }

    /** Print the current report to the serial console, like  north1> LOG 1 sonar 12:30:00 237. */
    //% block="print this report to serial"
    //% group="Main node" weight=80
    export function printReport() {
        serial.writeLine(curSender + "> " + curText)
    }

    /**
     * If the current report is a detection (LOG ...), save it in the datalogger with the date,
     * the sensor's name, channel, kind and value. Other reports are ignored.
     * Clears the log by itself when it is full.
     */
    //% block="log this report to datalogger"
    //% group="Main node" weight=79
    export function logReport() {
        if (commands.word(1, curText) != "LOG") return
        prepareLog()
        // LOG <channel> <kind> <time> <value>
        datalogger.log(
            datalogger.createCV("timestamp", clock.date() + " " + commands.word(4, curText)),
            datalogger.createCV("sensor", curSender),
            datalogger.createCV("channel", parseFloat(commands.word(2, curText))),
            datalogger.createCV("kind", commands.word(3, curText)),
            datalogger.createCV("value", parseFloat(commands.word(5, curText)))
        )
    }

    /** The name of the node that sent the current report. */
    //% block="report sender"
    //% group="Main node" weight=70
    export function reportSender(): string {
        return curSender
    }

    /** The text of the current report. */
    //% block="report text"
    //% group="Main node" weight=69
    export function reportText(): string {
        return curText
    }
}

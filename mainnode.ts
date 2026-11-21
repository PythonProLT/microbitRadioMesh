/**
 * Main node: everything except receiving the data and logging it.
 *
 *   start main mesh on radio group 1
 *
 * That one block joins the mesh as "main", relays other nodes' messages, keeps the clock and
 * runs the serial console. Plug the micro:bit into a computer, open a serial monitor at
 * 115200 baud and type:
 *   @north1 STATUS          send a command to the node named north1 (any command works)
 *   @* CFG                  send to every node
 *   @north1 PAIR sonar      find a sonar on a free pin of north1 and save it
 *                           (also: pir, digital, mic, analog; trigger the sensor while it scans)
 *   TIME 12 34 56           set this clock and every node's clock
 *   DATE 11 21 2026         set this date and every node's date (month day year)
 *   SET name main / CFG     configure this micro:bit itself
 *   HELP                    show this list
 * Every line you type is echoed back as  > <line>  and then answered, so you can see what the
 * micro:bit received. Everything the sensors send back (detections and replies) arrives in "on report received",
 * where your program prints and logs it. A console line the extension doesn't know is handed to
 * "on unknown console command" so you can add your own (for example LOGCLEAR).
 *
 * Needs the Radio extension.
 */
//% color="#C0392B" weight=94 icon="" block="Main node"
namespace mainnode {
    let started = false
    let reportHandler: (sender: string, text: string) => void = null
    let consoleHandler: (verb: string, text: string) => void = null
    // the report that is being handled right now
    let curSender = ""
    let curText = ""

    // remove carriage returns (some terminals send CR+LF)
    function noReturns(s: string): string {
        let out = ""
        for (let i = 0; i < s.length; i++) {
            if (s.charAt(i) != "\r") out += s.charAt(i)
        }
        return out
    }

    function help() {
        serial.writeLine("@name <command>   send a command to a sensor (@* = all)")
        serial.writeLine("@name PAIR sonar   (sonar, pir, digital, mic, analog)")
        serial.writeLine("TIME 12 34 56   DATE 11 21 2026")
        serial.writeLine("sensor commands: PING STATUS READ n CFG SET PAIR UNPAIR")
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
        } else if (verb == "HELP") {
            help()
        } else if (!commands.handleSerialLine(line)) {
            if (consoleHandler) consoleHandler(verb, line)
            else serial.writeLine("ERR UNKNOWN (type HELP)")
        }
    }

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
            const line = noReturns(serial.readLine())
            if (commands.word(1, line).length == 0) return
            serial.writeLine("> " + line)      // mirror what was typed
            handleLine(line)
        })
    }

    /** Runs your blocks for every message the main node receives: detections (LOG ...) and replies to your commands. */
    //% block="on report received"
    //% draggableParameters="reporter"
    //% group="Main node" weight=90
    export function onReport(handler: (sender: string, text: string) => void) {
        reportHandler = handler
    }

    /**
     * Runs when a line typed in the serial console isn't one the extension knows. The verb is the first
     * word in capitals (for example LOGCLEAR); the text is the whole line. Answer with serial write line.
     */
    //% block="on unknown console command"
    //% draggableParameters="reporter"
    //% group="Main node" weight=80
    export function onUnknownConsoleCommand(handler: (verb: string, text: string) => void) {
        consoleHandler = handler
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

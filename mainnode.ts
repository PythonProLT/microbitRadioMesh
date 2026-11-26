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
 *   SYNC                    every node logs its millisecond counter at this moment (run it before and after a recording)
 *   SET name main / CFG     configure this micro:bit itself
 *   @north1 LEAVE 60        take north1 out of the mesh for 60 s (it rejoins by itself)
 *   LEAVE 60 | JOIN         the same for this main node, or rejoin early
 *   @north1 STATS           packet counters of north1 (lost > 0 means missing fragments)
 *   @north2 HEAR north1     north2 only accepts packets sent by north1, which forces the route through it
 *   @north1 SPEAK north2    north1 only sends to north2 (up to 3 names; others ignore its packets)
 *   HEAR ALL / SPEAK ALL    undo (also works as @name HEAR ALL; HEAR on main limits main itself)
 *   HOPS OFF | HOPS ON      hide or show the hops line printed under every report
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
    let showHops = true
    let syncId = randint(100, 8999)    // numbers the SYNC commands (random start, so two sessions don't share numbers)
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
        serial.writeLine("TIME 12 34 56   DATE 11 21 2026   SYNC")
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
        } else if (verb == "LEAVE") {
            const sec = parseFloat(commands.word(2, line))
            if (!(sec >= 1 && sec <= 3600)) {
                serial.writeLine("usage: LEAVE <seconds>  (or @name LEAVE <seconds>)")
            } else {
                mesh.leave(sec)
                serial.writeLine("OK main leaves the mesh for " + Math.floor(sec) + " s")
            }
        } else if (verb == "STATS") {
            serial.writeLine(mesh.stats())
        } else if (verb == "HEAR") {
            const w1 = commands.word(2, line)
            if (w1.length == 0) {
                serial.writeLine("usage: HEAR <names>  or  HEAR ALL   (or @name HEAR ...)")
            } else if (w1.toUpperCase() == "ALL") {
                mesh.hearAll()
                serial.writeLine("OK main hears everyone")
            } else {
                mesh.hearOnly(commands.textAfter(1, line))
                serial.writeLine("OK main hears only " + commands.textAfter(1, line))
            }
        } else if (verb == "SPEAK") {
            const w1 = commands.word(2, line)
            if (w1.length == 0) {
                serial.writeLine("usage: SPEAK <up to 3 names>  or  SPEAK ALL   (or @name SPEAK ...)")
            } else if (w1.toUpperCase() == "ALL") {
                mesh.speakAll()
                serial.writeLine("OK main speaks to everyone")
            } else {
                mesh.speakOnly(commands.textAfter(1, line))
                serial.writeLine("OK main speaks only to " + commands.textAfter(1, line))
            }
        } else if (verb == "JOIN") {
            mesh.rejoin()
            serial.writeLine("OK main is in the mesh")
        } else if (verb == "HOPS") {
            showHops = commands.word(2, line).toUpperCase() != "OFF"
            serial.writeLine(showHops ? "OK hops shown" : "OK hops hidden")
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
        } else if (verb == "SYNC") {
            syncId += 1
            mesh.send("*", "SYNC " + syncId)
            serial.writeLine("OK SYNC " + syncId + " sent; each node that hears it answers SYNCED")
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
            // show the route every message took, so you can see the mesh relaying
            if (showHops) serial.writeLine("  [" + sender + " -> me: " + mesh.lastHops() + " hop" + (mesh.lastHops() == 1 ? "" : "s") + " via " + mesh.lastPath() + "]")
            if (reportHandler) reportHandler(sender, payload)
        })
        serial.setRxBufferSize(128)   // the default is 20 bytes, which cuts longer commands short
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

    /** How many hops the current report took to reach the main node (1 = heard directly). */
    //% block="report hops"
    //% group="Main node" weight=68
    export function reportHops(): number {
        return mesh.lastHops()
    }

    /** The path the current report took, like "north1>north2". */
    //% block="report path"
    //% group="Main node" weight=67
    export function reportPath(): string {
        return mesh.lastPath()
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

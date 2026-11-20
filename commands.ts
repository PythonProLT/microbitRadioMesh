/**
 * Text commands: configure a node by typing short commands over USB serial,
 * or by sending the same text in a mesh message. Also text helpers for
 * splitting a command into words.
 *
 *   CFG                                  show name, quiet time and enabled channels
 *   SET name north1                      rename this node (saved)
 *   SET quiet 10                         seconds between reports per channel (saved)
 *   SET ch1 sonar 2 500                  channel 1: kind, pin, threshold (saved)
 *   SET ch2 off                          switch channel 2 off
 *   SET <variable> <value>               save your own text variable
 *   GET <name|quiet|chN|variable>        read a setting or variable
 *   DEL <variable>   KEYS   FORGET       delete one / list / delete all variables
 */
//% color="#8E44AD" weight=70 icon="" block="Commands"
namespace commands {
    function strip(s: string): string {
        let out = ""
        for (let i = 0; i < s.length; i++) {
            const c = s.charAt(i)
            if (c == "\r" || c == "\n") continue
            out += c
        }
        return out
    }

    function trim(s: string): string {
        let a = 0
        let b = s.length
        while (a < b && s.charAt(a) == " ") a++
        while (b > a && s.charAt(b - 1) == " ") b--
        return s.substr(a, b - a)
    }

    function words(text: string): string[] {
        const out: string[] = []
        let cur = ""
        for (let i = 0; i < text.length; i++) {
            const c = text.charAt(i)
            if (c == " ") {
                if (cur.length > 0) {
                    out.push(cur)
                    cur = ""
                }
            } else {
                cur += c
            }
        }
        if (cur.length > 0) out.push(cur)
        return out
    }

    /** The nth space-separated word of a text (1 = first). Empty if there isn't one. */
    //% block="word %index of %text"
    //% index.min=1 index.defl=1
    //% group="Text" weight=40
    export function word(index: number, text: string): string {
        const ws = words(text)
        if (index < 1 || index > ws.length) return ""
        return ws[index - 1]
    }

    /** Everything after the first n words of a text. */
    //% block="text after word %index of %text"
    //% index.min=0 index.defl=1
    //% group="Text" weight=39
    export function textAfter(index: number, text: string): string {
        const n = text.length
        let count = 0
        let i = 0
        while (i < n && count < index) {
            while (i < n && text.charAt(i) == " ") i++
            if (i >= n) break
            while (i < n && text.charAt(i) != " ") i++
            count++
        }
        while (i < n && text.charAt(i) == " ") i++
        return text.substr(i, n - i)
    }

    /** One-line summary: name, quiet time and enabled channels. */
    //% block="config summary"
    //% group="Commands" weight=51
    export function summary(): string {
        let s = "name=" + mesh.myName() + " quiet=" + channel.quietSeconds()
        for (let n = 1; n <= channel.MAX; n++) {
            if (channel.enabled(n)) s += " ch" + n + "=" + channel.describe(n)
        }
        return s
    }

    function channelNumber(key: string): number {
        if (key.length == 3 && key.indexOf("ch") == 0) return parseFloat(key.substr(2))
        return NaN
    }

    /**
     * Run a configuration command and return the reply text, or "" if the text isn't one of ours,
     * so your own commands can be tried next.
     */
    //% block="run config command %command"
    //% group="Commands" weight=50
    export function run(command: string): string {
        const c = trim(strip(command))
        const verb = word(1, c).toUpperCase()
        if (verb == "CFG") return summary()
        if (verb == "SET") {
            const key = word(2, c).toLowerCase()
            if (key.length == 0) return "ERR usage: SET <name|quiet|chN|variable> <value>"
            if (key == "name") {
                if (!mesh.rename(textAfter(2, c))) return "ERR name must be 1-12 characters, not *"
                return "OK name=" + mesh.myName()
            }
            if (key == "quiet") return channel.setQuietSeconds(parseFloat(word(3, c)))
            const n = channelNumber(key)
            if (!isNaN(n)) {
                const k = word(3, c)
                if (k.toLowerCase() != "off" && isNaN(parseFloat(word(4, c)))) return "ERR usage: SET ch" + n + " <kind> <pin> <threshold>"
                return channel.configure(n, k, parseFloat(word(4, c)), parseFloat(word(5, c)))
            }
            nodestore.saveText(key, textAfter(2, c))
            return "OK " + key
        }
        if (verb == "GET") {
            const key = word(2, c).toLowerCase()
            if (key == "name") return "name=" + mesh.myName()
            if (key == "quiet") return "quiet=" + channel.quietSeconds()
            const n = channelNumber(key)
            if (!isNaN(n)) return key + "=" + channel.describe(n)
            if (nodestore.isSaved(key)) return key + "=" + nodestore.loadText(key, "")
            return "NONE " + key
        }
        if (verb == "DEL") {
            nodestore.deleteSaved(word(2, c))
            return "OK DEL " + word(2, c)
        }
        if (verb == "KEYS") return "KEYS " + nodestore.savedNames()
        if (verb == "FORGET") {
            nodestore.forgetAll()
            return "OK FORGET"
        }
        return ""
    }

    /** Handle one line typed over serial: runs it, prints the reply, and returns true if it was a config command. */
    //% block="handle serial line %line"
    //% group="Commands" weight=49
    export function handleSerialLine(line: string): boolean {
        const r = run(line)
        if (r == "") return false
        serial.writeLine(r)
        return true
    }

    /** Let a computer configure this node over USB serial (115200 baud). For nodes that don't use serial for anything else. */
    //% block="accept config commands over serial"
    //% group="Commands" weight=48
    export function enableSerial() {
        serial.onDataReceived(serial.delimiters(Delimiters.NewLine), function () {
            handleSerialLine(serial.readLine())
        })
    }
}

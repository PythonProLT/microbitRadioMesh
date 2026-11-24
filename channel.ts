/**
 * Channels: up to four sensor inputs per micro:bit. Each channel has a kind
 * (a label of up to 7 characters), a pin number and a threshold (0-9999), and
 * is saved to flash. Channels 1-2 share one flash entry and 3-4 share another.
 *
 * Built-in kinds (read for you by channel.read):
 *   pir, digital   digital pin; detection when it reads 1
 *   mic, analog    analog pin (0-4, 10); "mic" measures peak-to-peak over 50 ms;
 *                  detection when the value is ABOVE the threshold
 *   sonar          3-wire Sonar:bit style sensor on one pin; the reading is the distance
 *                  in mm (0 = no echo); detection when 0 < value < threshold
 * Any other kind is read by YOUR program: put a "when a channel reads a custom
 * kind" block in it, and inside it hand back the reading with "set reading to".
 * A detection for a custom kind is a reading ABOVE the threshold.
 *
 * channel.pair("sonar") (also pir, digital, mic, analog) looks for a sensor of
 * that kind on a pin no channel uses yet, and saves it in the first free channel.
 */
//% color="#E67E22" weight=80 icon="" block="Channels"
namespace channel {
    export const MAX = 4

    let kinds: string[] = []
    let pinNums: number[] = []
    let thresholds: number[] = []
    let quiet = 10
    let loaded = false

    // ----------------------------- pins -----------------------------

    /** Turn a pin number (0-16) into a digital pin, for blocks that need a pin. */
    //% block="digital pin number %n"
    //% n.min=0 n.max=16 n.defl=2
    //% group="Pins" weight=30
    export function digitalPin(n: number): DigitalPin {
        switch (n) {
            case 0: return DigitalPin.P0
            case 1: return DigitalPin.P1
            case 2: return DigitalPin.P2
            case 3: return DigitalPin.P3
            case 4: return DigitalPin.P4
            case 5: return DigitalPin.P5
            case 6: return DigitalPin.P6
            case 7: return DigitalPin.P7
            case 8: return DigitalPin.P8
            case 9: return DigitalPin.P9
            case 10: return DigitalPin.P10
            case 11: return DigitalPin.P11
            case 12: return DigitalPin.P12
            case 13: return DigitalPin.P13
            case 14: return DigitalPin.P14
            case 15: return DigitalPin.P15
            case 16: return DigitalPin.P16
            default: return DigitalPin.P0
        }
    }

    /** Turn a pin number (0, 1, 2, 3, 4 or 10) into an analog pin. */
    //% block="analog pin number %n"
    //% n.min=0 n.max=10 n.defl=0
    //% group="Pins" weight=29
    export function analogPin(n: number): AnalogPin {
        switch (n) {
            case 0: return AnalogPin.P0
            case 1: return AnalogPin.P1
            case 2: return AnalogPin.P2
            case 3: return AnalogPin.P3
            case 4: return AnalogPin.P4
            case 10: return AnalogPin.P10
            default: return AnalogPin.P0
        }
    }

    function isAnalogKind(k: string): boolean {
        return k == "mic" || k == "analog"
    }

    function pinOk(k: string, p: number): boolean {
        if (isNaN(p) || p != Math.floor(p)) return false
        if (isAnalogKind(k)) return p == 0 || p == 1 || p == 2 || p == 3 || p == 4 || p == 10
        return p >= 0 && p <= 16
    }

    function kindOk(k: string): boolean {
        if (k.length == 0 || k.length > 7) return false
        for (let i = 0; i < k.length; i++) {
            const c = k.charAt(i)
            if (c == "," || c == " " || c == "|" || c == "=") return false
        }
        return true
    }

    // ----------------------------- saved setup -----------------------------

    function ensureLoaded() {
        if (loaded) return
        loaded = true
        for (let i = 0; i < MAX; i++) {
            kinds.push("off")
            pinNums.push(0)
            thresholds.push(0)
        }
        quiet = nodestore.getQuiet(10)
        // channels 1-2 live in entry "m.a", channels 3-4 in "m.b": "kind,pin,thr;kind,pin,thr"
        for (let e = 0; e < 2; e++) {
            const raw = nodestore.getRaw(e == 0 ? "m.a" : "m.b", "")
            if (raw == "") continue
            const items = raw.split(";")
            for (let j = 0; j < items.length && j < 2; j++) {
                const p = items[j].split(",")
                if (p.length != 3) continue
                const k = p[0]
                const pn = parseFloat(p[1])
                const th = parseFloat(p[2])
                if (k != "off" && kindOk(k) && !isNaN(th) && pinOk(k, pn)) {
                    const n = e * 2 + j + 1
                    kinds[n - 1] = k
                    pinNums[n - 1] = pn
                    thresholds[n - 1] = th
                }
            }
        }
    }

    function item(n: number): string {
        if (kinds[n - 1] == "off") return "off"
        return kinds[n - 1] + "," + pinNums[n - 1] + "," + thresholds[n - 1]
    }

    function save(n: number) {
        const e = Math.idiv(n - 1, 2)
        const first = e * 2 + 1
        const key = e == 0 ? "m.a" : "m.b"
        if (kinds[first - 1] == "off" && kinds[first] == "off") {
            nodestore.removeRaw(key)
        } else {
            nodestore.putRaw(key, item(first) + ";" + item(first + 1))
        }
    }

    function valid(n: number): boolean {
        return n >= 1 && n <= MAX && n == Math.floor(n)
    }

    // ----------------------------- reading the setup -----------------------------

    /** The kind of a channel (1-4): "off", "pir", "digital", "mic", "analog", "sonar" or your own label. */
    //% block="channel %n kind"
    //% n.min=1 n.max=4 n.defl=1
    //% group="Setup" weight=60
    export function kind(n: number): string {
        ensureLoaded()
        if (!valid(n)) return "off"
        return kinds[n - 1]
    }

    /** The pin number of a channel. */
    //% block="channel %n pin number"
    //% n.min=1 n.max=4 n.defl=1
    //% group="Setup" weight=59
    export function pin(n: number): number {
        ensureLoaded()
        if (!valid(n)) return 0
        return pinNums[n - 1]
    }

    /** The threshold of a channel. */
    //% block="channel %n threshold"
    //% n.min=1 n.max=4 n.defl=1
    //% group="Setup" weight=58
    export function threshold(n: number): number {
        ensureLoaded()
        if (!valid(n)) return 0
        return thresholds[n - 1]
    }

    /** True if the channel is set up (its kind isn't "off"). */
    //% block="channel %n is enabled"
    //% n.min=1 n.max=4 n.defl=1
    //% group="Setup" weight=57
    export function enabled(n: number): boolean {
        return kind(n) != "off"
    }

    /** "kind,pin,threshold" of a channel, or "off". */
    //% block="channel %n description"
    //% n.min=1 n.max=4 n.defl=1
    //% group="Setup" weight=56
    export function describe(n: number): string {
        if (!enabled(n)) return "off"
        return kind(n) + "," + pin(n) + "," + threshold(n)
    }

    /** Minimum milliseconds between reports from the same channel. */
    //% block="quiet time (ms)"
    //% group="Setup" weight=55
    export function quietMs(): number {
        ensureLoaded()
        return quiet * 1000
    }

    /** Minimum seconds between reports. */
    export function quietSeconds(): number {
        ensureLoaded()
        return quiet
    }

    // ----------------------------- changing the setup -----------------------------

    /**
     * Set up a channel and save it. Returns "OK ..." or "ERR ...".
     * Use kind "off" to switch a channel off.
     */
    //% block="set channel %n to %kind on pin %pin threshold %threshold"
    //% n.min=1 n.max=4 n.defl=1
    //% group="Setup" weight=50
    export function configure(n: number, kind: string, pin: number, threshold: number): string {
        ensureLoaded()
        if (!valid(n)) return "ERR channel must be 1-" + MAX
        const k = kind.toLowerCase()
        if (k == "off") {
            kinds[n - 1] = "off"
            pinNums[n - 1] = 0
            thresholds[n - 1] = 0
            save(n)
            return "OK ch" + n + "=off"
        }
        if (!kindOk(k)) return "ERR kind must be 1-7 characters, no spaces or commas"
        if (!pinOk(k, pin)) return "ERR pin " + pin + " not valid for " + k
        const th = isNaN(threshold) ? 0 : Math.round(threshold)
        if (th < 0 || th > 9999) return "ERR threshold must be 0-9999"
        kinds[n - 1] = k
        pinNums[n - 1] = pin
        thresholds[n - 1] = th
        save(n)
        return "OK ch" + n + "=" + describe(n)
    }

    /** Set the minimum seconds between reports from the same channel, and save it. */
    //% block="set quiet time to %seconds s"
    //% seconds.min=0 seconds.defl=10
    //% group="Setup" weight=49
    export function setQuietSeconds(seconds: number): string {
        ensureLoaded()
        if (isNaN(seconds) || seconds < 0 || seconds > 9999) return "ERR quiet must be 0-9999 seconds"
        quiet = Math.round(seconds)
        nodestore.putQuiet(quiet)
        return "OK quiet=" + quiet
    }

    // ----------------------------- readings -----------------------------

    /** Peak-to-peak level of an analog microphone on a pin over some milliseconds. */
    //% block="analog peak on pin %pin for %ms ms"
    //% pin.min=0 pin.max=10 pin.defl=0 ms.defl=50
    //% group="Readings" weight=40
    export function analogPeak(pin: number, ms: number): number {
        const p = analogPin(pin)
        let lo = 1023
        let hi = 0
        const end = input.runningTime() + ms
        while (input.runningTime() < end) {
            const v = pins.analogReadPin(p)
            if (v < lo) lo = v
            if (v > hi) hi = v
        }
        if (hi < lo) return 0
        return hi - lo
    }

    let customHandler: (kind: string, pin: number) => void = null
    let customValue = 0
    let customSet = false

    /** Teach channels to read a kind this extension can't read itself (for example "sonar"). Inside, use "set reading to". */
    //% block="when a channel reads a custom kind"
    //% draggableParameters="reporter"
    //% group="Readings" weight=38
    export function onCustomRead(handler: (kind: string, pin: number) => void) {
        customHandler = handler
    }

    /** Use inside "when a channel reads a custom kind" to hand back the reading. */
    //% block="set reading to %value"
    //% group="Readings" weight=37
    export function setReading(value: number) {
        customValue = value
        customSet = true
    }

    /**
     * The raw echo time in microseconds from a 3-wire Sonar:bit style sensor (one pin carries both the
     * trigger pulse and the echo). 0 means no echo was heard.
     */
    //% block="sonar echo time (µs) on pin %pin"
    //% pin.min=0 pin.max=16 pin.defl=2
    //% group="Readings" weight=35
    export function sonarEchoUs(pin: number): number {
        const p = digitalPin(pin)
        pins.setPull(p, PinPullMode.PullNone)
        pins.digitalWritePin(p, 0)
        control.waitMicros(2)
        pins.digitalWritePin(p, 1)
        control.waitMicros(10)
        pins.digitalWritePin(p, 0)
        return pins.pulseIn(p, PulseValue.High, 25000)
    }

    /**
     * The same measurement as "sonar echo time", but timed by polling the pin instead of the pulseIn
     * function, so it does not depend on the micro:bit's pin-event system. 0 means no echo was heard.
     */
    //% block="sonar echo time by polling (µs) on pin %pin"
    //% pin.min=0 pin.max=16 pin.defl=2
    //% group="Readings" weight=34
    export function sonarPollUs(pin: number): number {
        const p = digitalPin(pin)
        pins.setPull(p, PinPullMode.PullNone)
        pins.digitalWritePin(p, 0)
        control.waitMicros(2)
        pins.digitalWritePin(p, 1)
        control.waitMicros(10)
        pins.digitalWritePin(p, 0)
        // the pin becomes an input on the first read; wait for the echo to start, then time it
        let t = input.runningTimeMicros()
        while (pins.digitalReadPin(p) == 0) {
            if (input.runningTimeMicros() - t > 6000) return 0
        }
        const start = input.runningTimeMicros()
        while (pins.digitalReadPin(p) == 1) {
            if (input.runningTimeMicros() - start > 25000) return 0
        }
        return input.runningTimeMicros() - start
    }

    /** Turn a sonar echo time into millimetres, the way the sonarbit extension does (whole centimetres times 10, 0 if over 400 cm). */
    export function mmFromEcho(echoUs: number): number {
        const cm = Math.idiv(echoUs, 58)
        if (cm > 400) return 0
        return cm * 10
    }

    /**
     * Distance in millimetres from a 3-wire Sonar:bit on one pin, read with the ElecFreaks sonarbit
     * extension (installed automatically with this one). Returns 0 when nothing is heard. Works from about 40 to 4000 mm.
     */
    //% block="sonar distance (mm) on pin %pin"
    //% pin.min=0 pin.max=16 pin.defl=2
    //% group="Readings" weight=36
    export function sonarMm(pin: number): number {
        // Only the ElecFreaks sonarbit extension reads the sonar. Our own sending is held during the
        // reading, and a 0 ("no echo") is retried a couple of times.
        mesh.pauseRadio()
        let mm = 0
        for (let i = 0; i < 3 && mm == 0; i++) {
            if (i > 0) basic.pause(70)
            mm = sonarbit.sonarbit_distance(Distance_Unit.Distance_Unit_mm, digitalPin(pin))
        }
        mesh.resumeRadio()
        return mm
    }

    function readKind(k: string, p: number): number {
        if (customHandler) {
            // your program gets the first go (for example to read a sonar with its own extension)
            customValue = 0
            customSet = false
            customHandler(k, p)
            if (customSet) return customValue
        }
        if (k == "sonar") return sonarMm(p)
        if (k == "mic") return analogPeak(p, 50)
        if (k == "analog") return pins.analogReadPin(analogPin(p))
        if (k == "digital" || k == "pir") return pins.digitalReadPin(digitalPin(p))
        return 0
    }

    /** Read a channel. Built-in kinds are read for you; other kinds (like sonar) use "when a channel reads a custom kind". */
    //% block="read channel %n"
    //% n.min=1 n.max=4 n.defl=1
    //% group="Readings" weight=41
    export function read(n: number): number {
        return readKind(kind(n), pin(n))
    }

    /** True if a reading counts as a detection for this channel's kind and threshold. */
    //% block="channel %n detects %value"
    //% n.min=1 n.max=4 n.defl=1
    //% group="Readings" weight=39
    export function triggered(n: number, value: number): boolean {
        const k = kind(n)
        if (k == "off") return false
        if (k == "pir" || k == "digital") return value > 0
        if (k == "sonar") return value > 0 && value < threshold(n)
        return value > threshold(n)
    }

    // ----------------------------- pairing -----------------------------

    const SCAN_MS = 8000
    // pins that are free to use: not the LED screen (3 4 6 7 9 10), buttons (5 11) or I2C (19 20)
    const DIGITAL_CANDIDATES = [0, 1, 2, 8, 12, 13, 14, 15, 16]
    // PIR/digital pairing scans every usable pin (not P5/P11, the buttons, which are always high)
    const DIGITAL_SCAN = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16]
    const ANALOG_CANDIDATES = [0, 1, 2]

    function pinInUse(p: number): boolean {
        for (let n = 1; n <= MAX; n++) {
            if (kinds[n - 1] != "off" && pinNums[n - 1] == p) return true
        }
        return false
    }

    function pairSonar(ch: number): string {
        let inUse = ""
        let heard = ""
        for (let i = 0; i < DIGITAL_CANDIDATES.length; i++) {
            const p = DIGITAL_CANDIDATES[i]
            if (pinInUse(p)) {
                inUse += (inUse == "" ? "" : ",") + p
                continue
            }
            let good = 0
            let best = 0
            for (let j = 0; j < 3; j++) {
                const d = readKind("sonar", p)
                if (d >= 20 && d <= 4000) good++
                if (d > best) best = d
                basic.pause(60)
            }
            if (good >= 2) return configure(ch, "sonar", p, 500)
            if (best > 0 && heard == "") heard = "p" + p + "=" + best
        }
        let msg = "ERR no sonar found"
        if (inUse != "") msg += ", pin in use: " + inUse
        msg += heard != "" ? ", odd echo " + heard : ", no echo on free pins"
        return msg
    }

    function pairDigital(ch: number, k: string): string {
        for (let i = 0; i < DIGITAL_SCAN.length; i++) {
            if (!pinInUse(DIGITAL_SCAN[i])) pins.setPull(digitalPin(DIGITAL_SCAN[i]), PinPullMode.PullDown)
        }
        let found = -1
        const end = input.runningTime() + SCAN_MS
        while (found < 0 && input.runningTime() < end) {
            for (let i = 0; i < DIGITAL_SCAN.length; i++) {
                const p = DIGITAL_SCAN[i]
                if (!pinInUse(p) && pins.digitalReadPin(digitalPin(p)) == 1) {
                    found = p
                    break
                }
            }
            basic.pause(10)
        }
        for (let i = 0; i < DIGITAL_SCAN.length; i++) {
            const p = DIGITAL_SCAN[i]
            if (!pinInUse(p) && p != found) pins.setPull(digitalPin(p), PinPullMode.PullNone)
        }
        let busy = ""
        for (let i = 0; i < DIGITAL_SCAN.length; i++) {
            if (pinInUse(DIGITAL_SCAN[i])) busy += (busy == "" ? "" : ",") + DIGITAL_SCAN[i]
        }
        if (found < 0) return (busy != "" ? "pins skipped, already used by a channel: " + busy + ". " : "") + "ERR no active " + k + " found in 8 s on any free pin (wait ~30 s after power-up, then wave right in front of it; or SET chN " + k + " <pin>)"
        return configure(ch, k, found, 0)
    }

    function pairAnalog(ch: number, k: string): string {
        const mins: number[] = []
        const maxs: number[] = []
        for (let i = 0; i < ANALOG_CANDIDATES.length; i++) {
            mins.push(1023)
            maxs.push(0)
        }
        const end = input.runningTime() + SCAN_MS
        while (input.runningTime() < end) {
            for (let i = 0; i < ANALOG_CANDIDATES.length; i++) {
                const p = ANALOG_CANDIDATES[i]
                if (pinInUse(p)) continue
                const v = k == "mic" ? analogPeak(p, 20) : pins.analogReadPin(analogPin(p))
                if (v < mins[i]) mins[i] = v
                if (v > maxs[i]) maxs[i] = v
            }
            basic.pause(5)
        }
        let best = -1
        let bestRange = 0
        for (let i = 0; i < ANALOG_CANDIDATES.length; i++) {
            if (pinInUse(ANALOG_CANDIDATES[i])) continue
            const range = maxs[i] - mins[i]
            // mic: quiet at some moment AND loud at another. analog: the value has to move.
            const active = k == "mic" ? (mins[i] <= 60 && maxs[i] >= 150) : range >= 150
            if (active && range > bestRange) {
                best = i
                bestRange = range
            }
        }
        if (best < 0) return "ERR no active " + k + " found (make it change during the 8 s)"
        return configure(ch, k, ANALOG_CANDIDATES[best], Math.round((mins[best] + maxs[best]) / 2))
    }

    /**
     * Look for a sensor of this kind (sonar, pir, digital, mic or analog) on a pin no channel uses yet,
     * and save it in the first free channel. Takes up to 8 seconds: trigger the sensor while it runs
     * (move in front of a PIR, make a noise at a mic, turn a knob). Returns "OK ch2=sonar,2,500" or "ERR ...".
     */
    //% block="pair a %kind sensor"
    //% group="Setup" weight=48
    export function pair(kind: string): string {
        ensureLoaded()
        const k = kind.toLowerCase()
        let ch = 0
        for (let n = 1; n <= MAX && ch == 0; n++) {
            if (kinds[n - 1] == "off") ch = n
        }
        if (ch == 0) return "ERR all " + MAX + " channels in use (SET chN off first)"
        if (k == "sonar") return pairSonar(ch)
        if (k == "pir" || k == "digital") return pairDigital(ch, k)
        if (k == "mic" || k == "analog") return pairAnalog(ch, k)
        return "ERR can't pair '" + k + "': try sonar, pir, digital, mic, analog"
    }
}

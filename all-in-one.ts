/**
 * Saved data: a small key/value store that survives power loss.
 *
 * It sits on top of a separate flash storage extension (a dependency listed in
 * pxt.json) and uses only four of its functions: put, remove, getOrDefault
 * and (for existence checks) getOrDefault with a marker value.
 *
 * Flash entries are scarce, so the node name and quiet time share one entry
 * ("m.n"), the four sensor channels share two ("m.a", "m.b"), and your own
 * variables use one entry each plus one index entry ("m.vk").
 */
//% color="#6C757D" weight=60 icon="" block="Saved data"
namespace nodestore {
    const NONE = "~~none~~"
    const K_ID = "m.n"
    const USER = "v."
    const USER_INDEX = "m.vk"
    const VAR_MAX = 12

    // ----- raw access (used by the other files; not shown as blocks) -----

    /** Write a value, skipping the write if it is already stored (saves flash wear). */
    export function putRaw(key: string, value: string) {
        if (flashstorage.getOrDefault(key, NONE) == value) return
        flashstorage.put(key, value)
    }

    /** Read a value, or the fallback if nothing is stored. */
    export function getRaw(key: string, fallback: string): string {
        return flashstorage.getOrDefault(key, fallback)
    }

    export function hasRaw(key: string): boolean {
        return flashstorage.getOrDefault(key, NONE) != NONE
    }

    export function removeRaw(key: string) {
        if (hasRaw(key)) flashstorage.remove(key)
    }

    // ----- node name and quiet time share one entry: "<name>,<quiet seconds>" -----

    function idParts(): string[] {
        const p = getRaw(K_ID, "").split(",")
        while (p.length < 2) p.push("")
        return p
    }

    export function hasName(): boolean {
        return idParts()[0] != ""
    }

    export function getName(fallback: string): string {
        const n = idParts()[0]
        return n == "" ? fallback : n
    }

    export function putName(name: string) {
        putRaw(K_ID, name + "," + idParts()[1])
    }

    export function getQuiet(fallback: number): number {
        const q = parseFloat(idParts()[1])
        return isNaN(q) ? fallback : q
    }

    export function putQuiet(seconds: number) {
        putRaw(K_ID, idParts()[0] + "," + seconds)
    }

    // ----- your own variables -----

    function safeKey(k: string): string {
        let out = ""
        for (let i = 0; i < k.length; i++) {
            const c = k.charAt(i)
            if (c == "," || c == "=" || c == " " || c == "|" || c == "\r" || c == "\n") continue
            out += c
        }
        return out.substr(0, VAR_MAX)
    }

    function varNames(): string[] {
        const raw = getRaw(USER_INDEX, "")
        if (raw == "") return []
        return raw.split(",")
    }

    /** Save a text value under a short name (up to 12 characters). Survives power loss. */
    //% block="save text %key = %value"
    //% weight=60
    export function saveText(key: string, value: string) {
        const k = safeKey(key)
        if (k.length == 0) return
        putRaw(USER + k, value)
        const names = varNames()
        if (names.indexOf(k) < 0) {
            names.push(k)
            putRaw(USER_INDEX, names.join(","))
        }
    }

    /** Read a saved text value, or the default if nothing is saved. */
    //% block="saved text %key default %fallback"
    //% weight=59
    export function loadText(key: string, fallback: string): string {
        return getRaw(USER + safeKey(key), fallback)
    }

    /** Save a number under a short name. Survives power loss. */
    //% block="save number %key = %value"
    //% weight=58
    export function saveNumber(key: string, value: number) {
        saveText(key, "" + value)
    }

    /** Read a saved number, or the default if nothing is saved. */
    //% block="saved number %key default %fallback"
    //% weight=57
    export function loadNumber(key: string, fallback: number): number {
        const t = loadText(key, "")
        if (t == "") return fallback
        const n = parseFloat(t)
        if (isNaN(n)) return fallback
        return n
    }

    /** True if something is saved under this name. */
    //% block="is %key saved"
    //% weight=56
    export function isSaved(key: string): boolean {
        return hasRaw(USER + safeKey(key))
    }

    /** Delete one saved variable. */
    //% block="delete saved %key"
    //% weight=55
    export function deleteSaved(key: string) {
        const k = safeKey(key)
        removeRaw(USER + k)
        const names = varNames()
        const at = names.indexOf(k)
        if (at >= 0) {
            names.removeAt(at)
            if (names.length == 0) removeRaw(USER_INDEX)
            else putRaw(USER_INDEX, names.join(","))
        }
    }

    /** Names of all saved variables, comma separated. */
    //% block="saved variable names"
    //% weight=54
    export function savedNames(): string {
        return varNames().join(",")
    }

    /** Delete every saved variable (the node name and channel setup are kept). */
    //% block="forget all saved variables"
    //% weight=53
    export function forgetAll() {
        const names = varNames()
        for (let i = 0; i < names.length; i++) removeRaw(USER + names[i])
        removeRaw(USER_INDEX)
    }
}
/**
 * Radio mesh: named micro:bits that relay each other's messages.
 *
 * A message is  <to-name>|<payload>|<from-name>.  Over the air it is cut into
 * fragments of at most 19 characters:
 *     [hops][id x2][index][total][for x1][trail x5][data x8]
 * The trail is the path the fragment has taken: each node that sends or relays
 * it writes its one-character tag (made from its name) into the next free spot
 * ("." = free). A node that finds its own tag already in the trail knows the
 * fragment has been through it before and ignores it. Every node also remembers
 * recent fragments, stops after a hop limit, and waits a short random time
 * before relaying. A node only delivers a message whose to-name is its own
 * name or "*".
 *
 * Tags are one character (36 possibilities), so two differently named nodes can
 * share a tag. If a node never hears a neighbour, rename one of them.
 *
 * There is no routing table, no acknowledgement and no security.
 */
//% color="#2E86C1" weight=90 icon="" block="Mesh"
namespace mesh {
    const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"
    const HEADER = 6
    const TRAIL = 5
    const CHUNK = 19 - HEADER - TRAIL
    const MAX_FRAGS = 10
    const SEEN_MAX = 60
    const PENDING_MAX = 6
    const NAME_MAX = 12

    class Assembly {
        id: string
        total: number
        got: number
        parts: string[]
        have: boolean[]
        trail: string
        constructor(id: string, total: number, trail: string) {
            this.id = id
            this.total = total
            this.trail = trail
            this.got = 0
            this.parts = []
            this.have = []
            for (let i = 0; i < total; i++) {
                this.parts.push("")
                this.have.push(false)
            }
        }
    }

    let nodeName = "unnamed"
    let maxHops = 4
    let msgCounter = 0
    let started = false
    let lastSig = 0
    let relayed = 0
    let repeats = 2
    let allowed = ""
    let speakTags = ""
    let nHeard = 0
    let nDup = 0
    let nBlocked = 0
    let nDone = 0
    let nLost = 0
    let txQueue: string[] = []
    let txDue: number[] = []
    let pumping = false
    let groupNum = 0
    let radioPaused = false
    let lastRxMs = 0
    let seen: string[] = []
    let pending: Assembly[] = []
    let lastTrail = "."
    let awayFrom = 0
    let awayUntil = 0
    let tagKeys: string[] = []
    let tagNames: string[] = []
    let msgHandler: (sender: string, payload: string, to: string) => void = null
    let valueHandler: (sender: string, key: string, value: number) => void = null

    // ----------------------------- helpers -----------------------------

    function strip(s: string): string {
        let out = ""
        for (let i = 0; i < s.length; i++) {
            const c = s.charAt(i)
            if (c == "\r" || c == "\n" || c == "|") continue
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

    function cleanName(name: string): string {
        return trim(strip(name))
    }

    function nameOk(n: string): boolean {
        return n.length > 0 && n.length <= NAME_MAX && n != "*" && n.indexOf(",") < 0
    }

    /** One-character tag for a name (0-9, a-z). Same name always gives the same tag. */
    function tagOf(name: string): string {
        let h = 0
        for (let i = 0; i < name.length; i++) {
            h = (h * 31 + name.charCodeAt(i)) % 36
        }
        return DIGITS.charAt(h)
    }

    // ----------------------------- node name -----------------------------

    /** Change this node's name and save it. Returns false if the name isn't allowed (1-12 characters, no comma or |, not "*"). */
    export function rename(name: string): boolean {
        const n = cleanName(name)
        if (!nameOk(n)) return false
        nodeName = n
        nodestore.putName(n)
        return true
    }

    /** Give this micro:bit a name and save it (up to 12 characters, no | and not "*"). */
    //% block="set my mesh name to %name"
    //% group="Node" weight=80
    export function setName(name: string) {
        rename(name)
    }

    /** Use this name only if no name has been saved on this micro:bit yet. */
    //% block="default mesh name %name"
    //% group="Node" weight=81
    export function defaultName(name: string) {
        if (!nodestore.hasName()) {
            const n = cleanName(name)
            if (nameOk(n)) nodeName = n
        }
    }

    /** The name of this micro:bit. */
    //% block="my mesh name"
    //% group="Node" weight=79
    export function myName(): string {
        return nodeName
    }

    /** How many relay hops a message may take (0-4, limited by the 5-spot trail). Default 4. */
    //% block="set mesh max hops %hops"
    //% hops.min=0 hops.max=4 hops.defl=4
    //% group="Node" weight=70
    export function setMaxHops(hops: number) {
        maxHops = Math.max(0, Math.min(TRAIL - 1, Math.floor(hops)))
    }

    /** Signal strength (dBm, negative) of the last radio packet this node heard. */
    //% block="mesh last signal strength"
    //% group="Node" weight=69
    export function lastSignal(): number {
        return lastSig
    }

    /**
     * Take this node out of the mesh for a number of seconds (1 to 3600). It starts after about 1.5 s, so
     * the reply to the command still gets out. While away it sends, receives and relays nothing, then it
     * rejoins by itself.
     */
    //% block="mesh leave for %seconds s"
    //% seconds.min=1 seconds.max=3600 seconds.defl=60
    //% group="Node" weight=65
    export function leave(seconds: number) {
        const s = Math.max(1, Math.min(3600, Math.floor(seconds)))
        awayFrom = input.runningTime() + 1500
        awayUntil = awayFrom + s * 1000
    }

    /** Rejoin the mesh now (works from the node's own program or serial console; a node that is away cannot hear commands). */
    //% block="mesh rejoin"
    //% group="Node" weight=64
    export function rejoin() {
        awayUntil = 0
    }

    /** True while this node is excluded from the mesh. */
    //% block="mesh is away"
    //% group="Node" weight=63
    export function isAway(): boolean {
        const t = input.runningTime()
        return t >= awayFrom && t < awayUntil
    }

    /** Seconds left before this node rejoins the mesh (0 if it is in the mesh). */
    //% block="mesh seconds until rejoin"
    //% group="Node" weight=62
    export function awayLeft(): number {
        const t = input.runningTime()
        return t < awayUntil ? Math.idiv(awayUntil - t, 1000) + 1 : 0
    }

    /**
     * How many radio hops the last message delivered to this node took.
     * 1 means it was heard straight from the sender; 2 means one node relayed it, and so on.
     */
    //% block="mesh last message hops"
    //% group="Node" weight=67
    export function lastHops(): number {
        const n = lastTrail.indexOf(".")
        return n < 0 ? TRAIL : n
    }

    /**
     * The path the last delivered message took, sender first, like "north1>k>north2".
     * Nodes are shown by name when this node has heard from them, otherwise by their one-character tag.
     * This node itself is not included.
     */
    //% block="mesh last message path"
    //% group="Node" weight=66
    export function lastPath(): string {
        let out = ""
        const n = lastHops()
        for (let i = 0; i < n; i++) {
            const tag = lastTrail.charAt(i)
            const k = tagKeys.indexOf(tag)
            out += (i > 0 ? ">" : "") + (k >= 0 ? tagNames[k] : tag)
        }
        return out
    }

    /** Send every packet this many times (1 to 3, default 2). Repeats make lost packets much rarer; duplicates are ignored by the receivers. */
    //% block="mesh send each packet %times times"
    //% times.min=1 times.max=3 times.defl=2
    //% group="Node" weight=61
    export function setRepeats(times: number) {
        repeats = Math.max(1, Math.min(3, Math.floor(times)))
    }

    /**
     * Only accept packets that were transmitted by one of these nodes (names separated by spaces). Use it to
     * force a route when every node can hear every other: a node told to hear only "k" can only be reached through k.
     * Not saved: it resets when the micro:bit restarts. The names are matched by their one-character tag.
     */
    //% block="mesh hear only %names"
    //% group="Node" weight=60
    export function hearOnly(names: string) {
        let tags = ""
        let word = ""
        for (let i = 0; i <= names.length; i++) {
            const c = i < names.length ? names.charAt(i) : " "
            if (c == " " || c == ",") {
                if (word.length > 0) tags += tagOf(word)
                word = ""
            } else {
                word += c
            }
        }
        allowed = tags
    }

    /**
     * Only send to these nodes (up to 3 names, separated by spaces): every packet this node sends or relays
     * is marked for one of them, and the other nodes ignore it. Together with "hear only" this makes a fixed
     * route. Not saved: it resets when the micro:bit restarts.
     */
    //% block="mesh speak only to %names"
    //% group="Node" weight=57
    export function speakOnly(names: string) {
        let tags = ""
        let word = ""
        for (let i = 0; i <= names.length; i++) {
            const c = i < names.length ? names.charAt(i) : " "
            if (c == " " || c == ",") {
                if (word.length > 0 && tags.length < 3 && tags.indexOf(tagOf(word)) < 0) tags += tagOf(word)
                word = ""
            } else {
                word += c
            }
        }
        speakTags = tags
    }

    /** Send to everyone again (undo "mesh speak only"). */
    //% block="mesh speak to everyone"
    //% group="Node" weight=56
    export function speakAll() {
        speakTags = ""
    }

    /** Hear every node again (undo "mesh hear only"). */
    //% block="mesh hear everyone"
    //% group="Node" weight=59
    export function hearAll() {
        allowed = ""
    }

    /**
     * Counters since power-up: heard (every packet), new (not seen before) dup (copies ignored), blocked
     * (refused by hear-only), relayed, done (messages fully assembled) and lost (messages that never completed).
     * "lost" above 0 means fragments went missing.
     */
    //% block="mesh statistics"
    //% group="Node" weight=58
    export function stats(): string {
        return "heard=" + nHeard + " dup=" + nDup + " blocked=" + nBlocked + " rel=" + relayed + " done=" + nDone + " lost=" + nLost
    }

    /** How many fragments this node has relayed since power-up. */
    //% block="mesh fragments relayed"
    //% group="Node" weight=68
    export function relayedCount(): number {
        return relayed
    }

    /** Start the mesh: loads the saved name, sets the radio group, starts relaying. */
    //% block="start mesh on radio group %group"
    //% group.min=0 group.max=255 group.defl=1
    //% group="Node" weight=90
    export function start(group: number) {
        groupNum = group
        radio.setGroup(group)
        radio.setTransmitPower(7)
        nodeName = nodestore.getName(nodeName)
        msgCounter = randint(0, 1295)
        if (!started) {
            started = true
            radio.onReceivedString(onPacket)
        }
        if (!pumping) {
            pumping = true
            control.inBackground(function () {
                while (true) {
                    pump()
                    basic.pause(5)
                }
            })
        }
    }

    // ----------------------------- sending -----------------------------

    function remember(key: string) {
        seen.push(key)
        if (seen.length > SEEN_MAX) seen.shift()
    }

    /** Send a message to a named node, or "*" for every node. */
    //% block="mesh send to %to message %payload"
    //% group="Messages" weight=100
    export function send(to: string, payload: string) {
        if (!started) return
        for (let w = 0; w < 100 && radioPaused; w++) basic.pause(10)
        if (isAway()) return
        const target = cleanName(to)
        const me = nodeName
        if (target.length == 0) return
        const room = MAX_FRAGS * CHUNK - target.length - me.length - 2
        if (room < 0) return
        const body = strip(payload).substr(0, room)
        const logical = target + "|" + body + "|" + me
        let trail = tagOf(me)
        while (trail.length < TRAIL) trail += "."
        const total = Math.idiv(logical.length + CHUNK - 1, CHUNK)
        msgCounter = (msgCounter + 1) % 1296
        const id = DIGITS.charAt(Math.idiv(msgCounter, 36)) + DIGITS.charAt(msgCounter % 36)
        for (let i = 0; i < total; i++) remember(id + DIGITS.charAt(i) + DIGITS.charAt(total))
        for (let r = 0; r < repeats; r++) {
            for (let i = 0; i < total; i++) {
                const key = id + DIGITS.charAt(i) + DIGITS.charAt(total)
                const core = DIGITS.charAt(maxHops) + key
                const rest = trail + logical.substr(i * CHUNK, CHUNK)
                const copies = speakTags.length == 0 ? 1 : speakTags.length
                for (let c = 0; c < copies; c++) {
                    radio.sendString(core + (speakTags.length == 0 ? "." : speakTags.charAt(c)) + rest)
                    basic.pause(20)
                }
            }
            if (r < repeats - 1) basic.pause(randint(40, 120))
        }
    }

    /** Send "name=number" to a named node (received by "on mesh value"). */
    //% block="mesh send to %to value %key = %value"
    //% group="Messages" weight=99
    export function sendValue(to: string, key: string, value: number) {
        send(to, key + "=" + value)
    }

    // ----------------------------- receiving / relaying -----------------------------

    function onPacket(frag: string) {
        if (isAway()) return          // excluded from the mesh: hear nothing, relay nothing
        lastRxMs = input.runningTime()
        lastSig = radio.receivedPacket(RadioPacketProperty.SignalStrength)
        nHeard++
        if (frag.length < HEADER + TRAIL + 1) return
        const hops = DIGITS.indexOf(frag.charAt(0))
        const id = frag.substr(1, 2)
        const idx = DIGITS.indexOf(frag.charAt(3))
        const total = DIGITS.indexOf(frag.charAt(4))
        if (hops < 0 || idx < 0 || total < 1 || idx >= total) return
        // this copy is meant for one particular neighbour (see "mesh speak only"): ignore it if that is not me
        const forTag = frag.charAt(5)
        if (forTag != "." && forTag != tagOf(nodeName)) {
            nBlocked++
            return
        }
        const trail = frag.substr(HEADER, TRAIL)
        const free = trail.indexOf(".")
        // "hear only" filter: accept only fragments whose last transmitter is on the list
        if (allowed.length > 0 && allowed.indexOf(trail.charAt(free < 0 ? TRAIL - 1 : free - 1)) < 0) {
            nBlocked++
            return
        }
        // Loops are stopped by the seen list, not by the trail: with only 36 one-character tags two nodes
        // can share a tag, and a trail check would then wrongly throw their messages away.
        const key = frag.substr(1, 4)
        if (seen.indexOf(key) >= 0) {
            nDup++
            return
        }
        remember(key)
        if (hops > 0 && free >= 0) {
            const me = tagOf(nodeName)
            const newTrail = trail.substr(0, free) + me + trail.substr(free + 1)
            const core = DIGITS.charAt(hops - 1) + key
            const rest = newTrail + frag.substr(HEADER + TRAIL)
            // do not wait inside this handler (it would make the radio drop the next packets):
            // queue the relay, the background loop sends it after a random delay
            const copies = speakTags.length == 0 ? 1 : speakTags.length
            for (let c = 0; c < copies; c++) {
                const out = core + (speakTags.length == 0 ? "." : speakTags.charAt(c)) + rest
                queueTx(out, randint(5, 40))
                if (repeats > 1) queueTx(out, randint(60, 160))
            }
            relayed++
        }
        collect(id, idx, total, frag.substr(HEADER + TRAIL), trail)
    }

    /**
     * Wait (up to maxMs) until the radio has been quiet for a moment: nothing heard for 250 ms and nothing
     * waiting to be relayed. Timing-sensitive readings (the sonar) call this first, because radio traffic
     * during a reading can spoil it. Never call it from inside "on mesh message".
     */
    //% blockHidden=true
    export function waitQuiet(maxMs: number) {
        const end = input.runningTime() + maxMs
        while (input.runningTime() < end && (txQueue.length > 0 || input.runningTime() - lastRxMs < 250)) {
            basic.pause(10)
        }
    }

    /** Hold this node's own sending during a timing-sensitive reading. Always follow with resumeRadio. */
    //% blockHidden=true
    export function pauseRadio() {
        if (!started || radioPaused) return
        radioPaused = true
    }

    /** Allow sending again after pauseRadio. */
    //% blockHidden=true
    export function resumeRadio() {
        if (!radioPaused) return
        lastRxMs = input.runningTime()
        radioPaused = false
    }

    function queueTx(frame: string, delayMs: number) {
        txQueue.push(frame)
        txDue.push(input.runningTime() + delayMs)
        if (txQueue.length > 24) {
            txQueue.shift()
            txDue.shift()
        }
    }

    /** Sends queued relays that are due. Called by the background loop; not a block. */
    //% blockHidden=true
    export function pump() {
        if (radioPaused) return
        const t = input.runningTime()
        for (let i = 0; i < txQueue.length; i++) {
            if (txDue[i] <= t) {
                const f = txQueue[i]
                txQueue.removeAt(i)
                txDue.removeAt(i)
                if (!isAway()) radio.sendString(f)
                return
            }
        }
    }

    function collect(id: string, idx: number, total: number, data: string, trail: string) {
        let a: Assembly = null
        for (let i = 0; i < pending.length; i++) {
            if (pending[i].id == id && pending[i].total == total) a = pending[i]
        }
        if (a === null) {
            a = new Assembly(id, total, trail)
            pending.push(a)
            if (pending.length > PENDING_MAX) {
                pending.shift()
                nLost++
            }
        }
        if (a.have[idx]) return
        a.have[idx] = true
        a.parts[idx] = data
        a.got++
        if (a.got == a.total) {
            pending.removeElement(a)
            nDone++
            deliver(a.parts.join(""), a.trail)
        }
    }

    // remember which name goes with a one-character tag, so paths can be shown with names
    function learn(tag: string, name: string) {
        const i = tagKeys.indexOf(tag)
        if (i >= 0) {
            tagNames[i] = name
            return
        }
        tagKeys.push(tag)
        tagNames.push(name)
        if (tagKeys.length > 12) {
            tagKeys.shift()
            tagNames.shift()
        }
    }

    function deliver(logical: string, trail: string) {
        const f = logical.split("|")
        if (f.length != 3) return
        const to = f[0]
        const payload = f[1]
        const sender = f[2]
        lastTrail = trail
        if (trail.charAt(0) != ".") learn(trail.charAt(0), sender)
        if (to != nodeName && to != "*") return
        if (msgHandler) msgHandler(sender, payload, to)
        if (valueHandler) {
            const eq = payload.indexOf("=")
            if (eq > 0) valueHandler(sender, payload.substr(0, eq), parseFloat(payload.substr(eq + 1)))
        }
    }

    /** Runs when a message addressed to this node (or "*") arrives. */
    //% block="on mesh message"
    //% draggableParameters="reporter"
    //% group="Messages" weight=90
    export function onMessage(handler: (sender: string, payload: string, to: string) => void) {
        msgHandler = handler
    }

    /** Runs when a "name=number" message addressed to this node arrives. */
    //% block="on mesh value"
    //% draggableParameters="reporter"
    //% group="Messages" weight=89
    export function onValue(handler: (sender: string, key: string, value: number) => void) {
        valueHandler = handler
    }
}
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
        for (let i = 0; i < DIGITAL_CANDIDATES.length; i++) {
            if (!pinInUse(DIGITAL_CANDIDATES[i])) pins.setPull(digitalPin(DIGITAL_CANDIDATES[i]), PinPullMode.PullDown)
        }
        let found = -1
        const end = input.runningTime() + SCAN_MS
        while (found < 0 && input.runningTime() < end) {
            for (let i = 0; i < DIGITAL_CANDIDATES.length; i++) {
                const p = DIGITAL_CANDIDATES[i]
                if (!pinInUse(p) && pins.digitalReadPin(digitalPin(p)) == 1) {
                    found = p
                    break
                }
            }
            basic.pause(10)
        }
        for (let i = 0; i < DIGITAL_CANDIDATES.length; i++) {
            const p = DIGITAL_CANDIDATES[i]
            if (!pinInUse(p) && p != found) pins.setPull(digitalPin(p), PinPullMode.PullNone)
        }
        if (found < 0) return "ERR no active " + k + " found in 8 s"
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
 *   PAIR sonar                           find a sonar on a free pin and save it in the first free channel
 *                                        (also: pir, digital, mic, analog; "PAIR a sonar" works too; takes up to 8 s)
 *   UNPAIR 2                             switch channel 2 off
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
        if (verb == "PAIR") {
            let what = word(2, c)
            if (what.toLowerCase() == "a" || what.toLowerCase() == "an") what = word(3, c)
            if (what.length == 0) return "ERR usage: PAIR <sonar|pir|digital|mic|analog>"
            return channel.pair(what)
        }
        if (verb == "UNPAIR") {
            const n = parseFloat(word(2, c))
            if (isNaN(n)) return "ERR usage: UNPAIR <channel 1-4>"
            return channel.configure(n, "off", 0, 0)
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
/**
 * A simple clock: set the time and date once, then read them as text.
 * It keeps running by itself but is forgotten when the power is lost, so set it again
 * after a restart (the main micro:bit can do this for every sensor with "TIME" and "DATE").
 */
//% color="#D4AC0D" weight=60 icon="" block="Clock"
namespace clock {
    let baseMs = 0
    let secOfDay = 0
    let curYear = 2000
    let curMonth = 1
    let curDay = 1
    let ticking = false

    function isLeap(y: number): boolean {
        return (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
    }

    function daysIn(m: number, y: number): number {
        if (m == 2) return isLeap(y) ? 29 : 28
        if (m == 4 || m == 6 || m == 9 || m == 11) return 30
        return 31
    }

    function pad2(n: number): string {
        return n < 10 ? "0" + n : "" + n
    }

    function advance(seconds: number) {
        const total = secOfDay + seconds
        let days = Math.idiv(total, 86400)
        secOfDay = total % 86400
        while (days > 0) {
            curDay++
            if (curDay > daysIn(curMonth, curYear)) {
                curDay = 1
                curMonth++
                if (curMonth > 12) {
                    curMonth = 1
                    curYear++
                }
            }
            days--
        }
    }

    // fold the time that has passed into the saved time (done often, so the counter never gets huge)
    function sync() {
        const now = input.runningTime()
        let elapsed = now - baseMs
        if (elapsed < 0) elapsed += 4294967296
        const whole = Math.idiv(elapsed, 1000)
        if (whole <= 0) return
        baseMs = now - (elapsed % 1000)
        advance(whole)
    }

    function startTicker() {
        if (ticking) return
        ticking = true
        baseMs = input.runningTime()
        control.inBackground(function () {
            while (true) {
                sync()
                basic.pause(10000)
            }
        })
    }

    /** Set the time of day (24-hour clock). Returns false if a number is out of range. */
    //% block="set time to %hour : %minute : %second"
    //% hour.min=0 hour.max=23 minute.min=0 minute.max=59 second.min=0 second.max=59
    //% group="Clock" weight=100
    export function setTime(hour: number, minute: number, second: number): boolean {
        if (isNaN(hour) || isNaN(minute) || isNaN(second)) return false
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return false
        startTicker()
        sync()
        secOfDay = Math.floor(hour) * 3600 + Math.floor(minute) * 60 + Math.floor(second)
        baseMs = input.runningTime()
        return true
    }

    /** Set the date. Returns false if a number is out of range. */
    //% block="set date to month %month day %day year %year"
    //% month.min=1 month.max=12 day.min=1 day.max=31 year.min=2000 year.max=2099 year.defl=2026
    //% group="Clock" weight=99
    export function setDate(month: number, day: number, year: number): boolean {
        if (isNaN(month) || isNaN(day) || isNaN(year)) return false
        month = Math.floor(month)
        day = Math.floor(day)
        year = Math.floor(year)
        if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1 || day > daysIn(month, year)) return false
        startTicker()
        sync()
        curYear = year
        curMonth = month
        curDay = day
        return true
    }

    /** The time as text, like 13:05:09. */
    //% block="time (HH:MM:SS)"
    //% group="Clock" weight=90
    export function time(): string {
        startTicker()
        sync()
        const h = Math.idiv(secOfDay, 3600)
        const m = Math.idiv(secOfDay % 3600, 60)
        return pad2(h) + ":" + pad2(m) + ":" + pad2(secOfDay % 60)
    }

    /** The date as text, like 2026-11-21. */
    //% block="date (YYYY-MM-DD)"
    //% group="Clock" weight=89
    export function date(): string {
        startTicker()
        sync()
        return curYear + "-" + pad2(curMonth) + "-" + pad2(curDay)
    }
}
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
    let jobText: string[] = []
    let jobFrom: string[] = []
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
            return "v=0.8.3 up=" + Math.idiv(input.runningTime(), 1000) + " t=" + input.temperature() +
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
    // (not inside the radio's message handler) and only once the radio has gone quiet
    function pairLoop() {
        while (true) {
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
            if (commands.word(1, payload).toUpperCase() == "PAIR") {
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

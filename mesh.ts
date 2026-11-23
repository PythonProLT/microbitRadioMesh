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
        if (!started || isAway()) return
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

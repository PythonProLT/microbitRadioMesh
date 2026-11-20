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

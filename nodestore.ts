/**
 * Saved data: a small key/value store that survives power loss.
 * It uses MakeCode's `settings` library (the same flash storage the datalogger
 * extension uses), so it needs a micro:bit V2.
 *
 * Internal keys (node name, channel setup) and your own saved variables share
 * the same store; your variables are kept apart by a prefix.
 */
//% color="#6C757D" weight=60 icon="" block="Saved data"
namespace nodestore {
    const PREFIX = "mn."
    const USER = "v."
    const USER_INDEX = "vk"

    // ----- raw access (used by the other files; not shown as blocks) -----

    /** Write a value, skipping the write if it is already stored (saves flash wear). */
    export function putRaw(key: string, value: string) {
        const k = PREFIX + key
        if (settings.exists(k) && settings.readString(k) == value) return
        settings.writeString(k, value)
    }

    /** Read a value, or the fallback if nothing is stored. */
    export function getRaw(key: string, fallback: string): string {
        const k = PREFIX + key
        if (!settings.exists(k)) return fallback
        const v = settings.readString(k)
        if (v === undefined || v === null) return fallback
        return v
    }

    export function hasRaw(key: string): boolean {
        return settings.exists(PREFIX + key)
    }

    export function removeRaw(key: string) {
        settings.remove(PREFIX + key)
    }

    // ----- your own variables -----

    function safeKey(k: string): string {
        let out = ""
        for (let i = 0; i < k.length; i++) {
            const c = k.charAt(i)
            if (c == "," || c == "=" || c == " " || c == "|" || c == "\r" || c == "\n") continue
            out += c
        }
        return out
    }

    function varNames(): string[] {
        const raw = getRaw(USER_INDEX, "")
        if (raw == "") return []
        return raw.split(",")
    }

    /** Save a text value under a short name. Survives power loss. */
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

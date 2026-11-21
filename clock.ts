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

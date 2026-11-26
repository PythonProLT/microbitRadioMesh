# EXAMPLE: sensor node (MakeCode, shown here as Python; every line is also a block).
# Extensions to add: radio-mesh (this repo), Radio, Datalogger. micro:bit V2.
#
# Only 3 blocks talk to the main node:
#   start sensor mesh   joins the mesh, relays, keeps the clock, answers commands (TIME, PAIR, STATUS, READ 1 ...)
#   on sync             the main node's SYNC command: we log this micro:bit's millisecond counter
#   report to main      tells the main node a sensor triggered
# Everything else (reading the sensors and logging) is written out below.
#
# Set up from the main node's console:  TIME 12 34 56 / DATE 11 21 2026,  @north1 PAIR sonar  (or pir, ...)
# Name it once over USB:                SET name north1

sensornode.start(1)

datalogger.set_column_titles("timestamp", "channel", "kind", "pin", "value", "ms")

# when the flash is full, wipe it and start again
def on_log_full():
    datalogger.delete_log(datalogger.DeleteType.FAST)
    datalogger.set_column_titles("timestamp", "channel", "kind", "pin", "value", "ms")
datalogger.on_log_full(on_log_full)

# SYNC from main: log the millisecond counter (kind "sync", pin = hops, value = sync number)
def on_sync(sync_id, ms, hops):
    datalogger.log(datalogger.create_cv("timestamp", clock.date() + " " + clock.time()),
        datalogger.create_cv("channel", 0),
        datalogger.create_cv("kind", "sync"),
        datalogger.create_cv("pin", hops),
        datalogger.create_cv("value", sync_id),
        datalogger.create_cv("ms", ms))
sensornode.on_sync(on_sync)

# the last time each channel was reported (so one event isn't logged again and again)
last_time = [-1000000, -1000000, -1000000, -1000000]
n = 0
reading = 0

# Read every channel you set up. If it triggered, log it and tell main.
def on_forever():
    global n, reading
    for index in range(4):
        n = index + 1
        if channel.enabled(n):
            reading = channel.read(n)
            if channel.triggered(n, reading) and input.running_time() - last_time[index] > channel.quiet_ms():
                last_time[index] = input.running_time()
                datalogger.log(datalogger.create_cv("timestamp", clock.date() + " " + clock.time()),
                    datalogger.create_cv("channel", n),
                    datalogger.create_cv("kind", channel.kind(n)),
                    datalogger.create_cv("pin", channel.pin(n)),
                    datalogger.create_cv("value", reading),
                    datalogger.create_cv("ms", input.running_time()))
                sensornode.report(n, reading)
    basic.pause(60)
basic.forever(on_forever)

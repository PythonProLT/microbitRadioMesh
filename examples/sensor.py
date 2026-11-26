# EXAMPLE: sensor node (MakeCode, shown here as Python; every line is also a block).
# Extensions to add: radio-mesh (this repo), Radio, Datalogger. micro:bit V2.
#
# The extension does the radio side: joining the mesh, reporting to main, the clock, commands, SYNC.
# This program just waits for a sensor to trigger and logs it.
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

def on_forever():
    if sensornode.sensor_triggered():
        datalogger.log(datalogger.create_cv("timestamp", clock.date() + " " + clock.time()),
            datalogger.create_cv("channel", sensornode.triggered_channel()),
            datalogger.create_cv("kind", sensornode.triggered_kind()),
            datalogger.create_cv("pin", sensornode.triggered_pin()),
            datalogger.create_cv("value", sensornode.triggered_reading()),
            datalogger.create_cv("ms", input.running_time()))
basic.forever(on_forever)

# EXAMPLE: sensor node (MakeCode Python).
# Extensions to add: radio-mesh (this repo), Radio, Datalogger. micro:bit V2.
#
# The extension does everything except logging the data:
#   start sensor mesh   joins the mesh, relays, keeps the clock, answers commands
#                       (SET name north1, PAIR sonar, TIME, STATUS, READ 1, ...)
# This program goes through every channel you set up (sonar, pir, digital, mic, analog),
# logs each detection with the datalogger (with the sensor kind and pin), and reports it to "main".
#
# One-time setup, typed in the main node's console:   TIME 12 34 56 / DATE 11 21 2026
# and plugged into USB once to name it:               SET name north1
# then set up a sensor from the main node:            @north1 PAIR sonar   or   @north1 SET ch1 pir 15

sensornode.start(1)

ch = 0
value = 0
lastSent = [-1000000, -1000000, -1000000, -1000000]

def clear_log():
    datalogger.delete_log(datalogger.DeleteType.FAST)
    datalogger.set_column_titles("timestamp", "channel", "kind", "pin", "value")

datalogger.set_column_titles("timestamp", "channel", "kind", "pin", "value")
datalogger.on_log_full(clear_log)

# the extension hands us commands it doesn't know
def on_unknown_command(verb, text):
    if verb == "LOGCLEAR":
        clear_log()
        sensornode.reply_with("OK log cleared")
sensornode.on_unknown_command(on_unknown_command)

def on_forever():
    global ch, value
    for index in range(4):
        ch = index + 1
        if channel.enabled(ch):
            # channel.read reads the channel by its kind (sonar, pir, digital, mic or analog)
            value = channel.read(ch)
            if channel.triggered(ch, value) and input.running_time() - lastSent[index] > channel.quiet_ms():
                lastSent[index] = input.running_time()
                datalogger.log(datalogger.create_cv("timestamp", clock.date() + " " + clock.time()),
                    datalogger.create_cv("channel", ch),
                    datalogger.create_cv("kind", channel.kind(ch)),
                    datalogger.create_cv("pin", channel.pin(ch)),
                    datalogger.create_cv("value", value))
                mesh.send("main", "LOG " + str(ch) + " " + channel.kind(ch) + " " + clock.time() + " " + str(value))
    basic.pause(300)
basic.forever(on_forever)

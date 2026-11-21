# EXAMPLE: sensor node (MakeCode Python).
# Extensions to add: radio-mesh (this repo), Radio, Datalogger. micro:bit V2.
#
# The extension does everything except reading the sonar and logging the data:
#   start sensor mesh   joins the mesh, relays, keeps the clock, answers commands
#                       (SET name north1, PAIR sonar, TIME, STATUS, READ 1, ...)
# This program reads the sonar, logs each detection with the datalogger, and reports it to "main".
#
# One-time setup, typed in the main node's console:   TIME 12 34 56 / DATE 11 21 2026
# and plugged into USB once to name it:               SET name north1
# then from the main node:                            pair a sonar on north1

sensornode.start(1)

lastReport = -1000000

def clear_log():
    datalogger.delete_log(datalogger.DeleteType.FAST)
    datalogger.set_column_titles("timestamp", "channel", "value")

datalogger.set_column_titles("timestamp", "channel", "value")
datalogger.on_log_full(clear_log)

# the extension hands us commands it doesn't know
def on_unknown_command(verb, text):
    if verb == "LOGCLEAR":
        clear_log()
        sensornode.reply_with("OK log cleared")
sensornode.on_unknown_command(on_unknown_command)

def on_forever():
    global lastReport
    if channel.enabled(1):
        distance = channel.sonar_mm(channel.pin(1))
        if channel.triggered(1, distance) and input.running_time() - lastReport > channel.quiet_ms():
            lastReport = input.running_time()
            datalogger.log(datalogger.create_cv("timestamp", clock.date() + " " + clock.time()),
                datalogger.create_cv("channel", 1),
                datalogger.create_cv("value", distance))
            mesh.send("main", "LOG 1 sonar " + clock.time() + " " + str(distance))
    basic.pause(300)
basic.forever(on_forever)

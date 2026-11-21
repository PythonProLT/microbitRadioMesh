# EXAMPLE: sensor node (MakeCode Python)
# Extensions: radio-mesh (this repo), sonarbit, timeanddate, datalogger.
# The same program runs on every sensor; what differs is its saved setup.
#
# Set a sensor up over USB serial (115200 baud), or over the mesh from the main
# micro:bit with "@name <command>" (commands are UPPERCASE):
#   SET name north1
#   PAIR sonar               (also: PAIR pir / digital / mic / analog; "PAIR a sonar" works too)
#   UNPAIR 2                 (switch channel 2 off)
#   SET ch1 sonar 2 500      (by hand instead: channel 1, kind, pin, threshold)
#   SET quiet 10             (seconds between reports per channel)
#   CFG                      (show the setup)
# Other commands over the mesh:
#   PING   STATUS   READ 1   LAST   TIME 12 34 56   DATE 11 20 2026   LOGCLEAR   HELP
#
# PAIR looks for a sensor of that kind on a pin no channel uses yet and saves it in the
# first free channel. It takes up to 8 s, so trigger the sensor while it runs (wave at a
# PIR, make a noise at a mic, turn a knob). Pair the sonar first, then the others.
#
# The datalogger keeps every detection with a timestamp. When its flash fills up
# the log is cleared automatically (otherwise the micro:bit would stop with error
# 928). Download the log before then, or send LOGCLEAR yourself.

def reset_log():
    datalogger.delete_log(datalogger.DeleteType.FAST)
    datalogger.set_column_titles("timestamp", "channel", "value")

def on_log_full():
    global logResets
    logResets += 1
    reset_log()
datalogger.on_log_full(on_log_full)

# Teaches the channels how to read a sonar (the extension can't, it doesn't know sonarbit)
def on_custom_read(kind, pin):
    if kind == "sonar":
        channel.set_reading(sonarbit.sonarbit_distance(Distance_Unit.DISTANCE_UNIT_MM, channel.digital_pin(pin)))
channel.on_custom_read(on_custom_read)

def on_mesh_message(sender, payload, to):
    global verb, reply, value, ch, pairCommand, pairReplyTo
    verb = commands.word(1, payload)
    if verb == "PAIR":
        # pairing takes a few seconds, so the forever loop does it (keeps the radio responsive)
        pairCommand = payload
        pairReplyTo = sender
        mesh.send(sender, "PAIRING, up to 8 s: trigger the sensor")
    else:
        reply = commands.run(payload)
        if reply != "":
            mesh.send(sender, reply)
        elif verb == "PING":
            mesh.send(sender, "PONG")
        elif verb == "STATUS":
            mesh.send(sender, "up=" + str(Math.idiv(input.running_time(), 1000)) + " t=" + str(input.temperature()) + " sig=" + str(mesh.last_signal()) + " rel=" + str(mesh.relayed_count()) + " clr=" + str(logResets))
        elif verb == "READ":
            ch = int(commands.word(2, payload))
            if channel.enabled(ch):
                value = channel.read(ch)
                mesh.send(sender, "ch" + str(ch) + "=" + str(value))
            else:
                mesh.send(sender, "ERR channel off")
        elif verb == "LOGCLEAR":
            reset_log()
            mesh.send(sender, "OK log cleared")
        elif verb == "HELP":
            mesh.send(sender, "PING STATUS READ n LAST TIME DATE LOGCLEAR PAIR CFG SET")
        elif verb == "LAST":
            mesh.send(sender, "last " + lastEvent)
        elif verb == "TIME":
            timeanddate.set24_hour_time(int(commands.word(2, payload)), int(commands.word(3, payload)), int(commands.word(4, payload)))
            mesh.send(sender, "OK " + timeanddate.time(timeanddate.TimeFormat.HHMMSS2_4HR))
        elif verb == "DATE":
            timeanddate.set_date(int(commands.word(2, payload)), int(commands.word(3, payload)), int(commands.word(4, payload)))
            mesh.send(sender, "OK " + timeanddate.date(timeanddate.DateFormat.YYYY_MM_DD))
        else:
            mesh.send(sender, "ERR UNKNOWN")
mesh.on_message(on_mesh_message)

lastEvent = "none"
logResets = 0
stamp = ""
reply = ""
verb = ""
value = 0
ch = 0
pairCommand = ""
pairReplyTo = ""
lastSent = [-10000, -10000, -10000, -10000]
datalogger.set_column_titles("timestamp", "channel", "value")
mesh.default_name("unnamed")
mesh.start(1)
commands.enable_serial()

def on_forever():
    global ch, lastEvent, stamp, value, pairCommand
    if pairCommand != "":
        reply2 = pairCommand
        pairCommand = ""
        mesh.send(pairReplyTo, commands.run(reply2))
    for index in range(4):
        ch = index + 1
        if channel.enabled(ch):
            value = channel.read(ch)
            if channel.triggered(ch, value) and input.running_time() - lastSent[index] > channel.quiet_ms():
                lastSent[index] = input.running_time()
                lastEvent = "" + str(ch) + " " + channel.kind(ch) + " " + timeanddate.time(timeanddate.TimeFormat.HHMMSS2_4HR) + " " + str(value)
                stamp = "" + timeanddate.date(timeanddate.DateFormat.YYYY_MM_DD) + " " + timeanddate.time(timeanddate.TimeFormat.HHMMSS2_4HR)
                datalogger.log(datalogger.create_cv("timestamp", stamp),
                    datalogger.create_cv("channel", ch),
                    datalogger.create_cv("value", value))
                mesh.send("main", "LOG " + lastEvent)
    basic.pause(300)
basic.forever(on_forever)

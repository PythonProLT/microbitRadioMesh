# EXAMPLE: sensor node (MakeCode Python)
# Extensions: radio-mesh (this repo), sonarbit, timeanddate, datalogger.
# The same program runs on every sensor; what differs is its saved setup.
#
# Set a sensor up over USB serial (115200 baud), or over the mesh from the main
# micro:bit with "@name <command>":
#   SET name north1
#   SET ch1 sonar 2 500      (channel 1: kind, pin, threshold)
#   SET ch2 mic 0 300        (channel 2: analog microphone on pin 0)
#   SET ch3 pir 8 0          (channel 3: PIR motion sensor on pin 8)
#   SET quiet 10             (seconds between reports per channel)
#   CFG                      (show the setup)
# Other commands over the mesh:
#   PING   STATUS   READ 1   LAST   TIME 12 34 56   DATE 11 20 2026

def read_channel(n):
    global value
    if channel.kind(n) == "sonar":
        value = sonarbit.sonarbit_distance(Distance_Unit.DISTANCE_UNIT_MM, channel.digital_pin(channel.pin(n)))
    else:
        value = channel.read(n)

def on_mesh_message(sender, payload, to):
    global verb, reply, value, ch
    reply = commands.run(payload)
    if reply != "":
        mesh.send(sender, reply)
    else:
        verb = commands.word(1, payload)
        if verb == "PING":
            mesh.send(sender, "PONG")
        elif verb == "STATUS":
            mesh.send(sender, "up=" + str(Math.idiv(input.running_time(), 1000)) + " t=" + str(input.temperature()) + " sig=" + str(mesh.last_signal()) + " rel=" + str(mesh.relayed_count()))
        elif verb == "READ":
            ch = int(commands.word(2, payload))
            if channel.enabled(ch):
                read_channel(ch)
                mesh.send(sender, "ch" + str(ch) + "=" + str(value))
            else:
                mesh.send(sender, "ERR channel off")
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
stamp = ""
reply = ""
verb = ""
value = 0
ch = 0
lastSent = [-10000, -10000, -10000, -10000]
datalogger.set_column_titles("timestamp", "channel", "value")
mesh.default_name("unnamed")
mesh.start(1)
commands.enable_serial()

def on_forever():
    global ch, lastEvent, stamp
    for index in range(4):
        ch = index + 1
        if channel.enabled(ch):
            read_channel(ch)
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

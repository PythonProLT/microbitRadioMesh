# EXAMPLE: main node (MakeCode Python)
# Extensions: radio-mesh (this repo), timeanddate, datalogger.
# Plug it into a computer and open a serial terminal at 115200 baud (or the MakeCode console).
#
# Console lines you can type:
#   @north1 STATUS          send "STATUS" to the node named north1 (any command works, incl. SET / CFG)
#   @north1 SET ch2 mic 0 300
#   @* CFG                  send to every node
#   TIME 12 34 56           set this node's clock and every node's clock
#   DATE 11 20 2026         set this node's date and every node's date (month day year)
#   SET name main / CFG / GET key / KEYS      configure this micro:bit itself
# Replies and reports print as:  north1> <text>

def on_data_received():
    global pending
    pending = serial.read_line()
serial.on_data_received(serial.delimiters(Delimiters.NEW_LINE), on_data_received)

def on_mesh_message(sender, payload, to):
    global stamp
    serial.write_line(sender + "> " + payload)
    if commands.word(1, payload) == "LOG":
        # LOG <channel> <kind> <time> <value>
        stamp = "" + timeanddate.date(timeanddate.DateFormat.YYYY_MM_DD) + " " + commands.word(4, payload)
        datalogger.log(datalogger.create_cv("timestamp", stamp),
            datalogger.create_cv("sensor", sender),
            datalogger.create_cv("channel", int(commands.word(2, payload))),
            datalogger.create_cv("kind", commands.word(3, payload)),
            datalogger.create_cv("value", int(commands.word(5, payload))))
mesh.on_message(on_mesh_message)

stamp = ""
target = ""
verb = ""
line = ""
pending = ""
datalogger.set_column_titles("timestamp", "sensor", "channel", "kind", "value")
mesh.default_name("main")
mesh.start(1)

def on_forever():
    global pending, line, verb, target
    if pending != "":
        line = pending
        pending = ""
        verb = commands.word(1, line)
        if verb.index_of("@") == 0:
            target = verb.substr(1, len(verb) - 1)
            mesh.send(target, commands.text_after(1, line))
            serial.write_line("SENT " + target)
        elif verb == "TIME":
            timeanddate.set24_hour_time(int(commands.word(2, line)), int(commands.word(3, line)), int(commands.word(4, line)))
            mesh.send("*", line)
            serial.write_line("OK TIME " + timeanddate.time(timeanddate.TimeFormat.HHMMSS2_4HR))
        elif verb == "DATE":
            timeanddate.set_date(int(commands.word(2, line)), int(commands.word(3, line)), int(commands.word(4, line)))
            mesh.send("*", line)
            serial.write_line("OK DATE " + timeanddate.date(timeanddate.DateFormat.YYYY_MM_DD))
        else:
            if not commands.handle_serial_line(line):
                serial.write_line("ERR UNKNOWN")
    basic.pause(100)
basic.forever(on_forever)

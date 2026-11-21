# EXAMPLE: main node (MakeCode Python).
# Extensions to add: radio-mesh (this repo), Radio, Datalogger. micro:bit V2.
#
# The extension does everything except receiving the data and logging it:
#   start main mesh     joins the mesh as "main", relays, keeps the clock, runs the serial console
# Plug it into a computer, open a serial monitor at 115200 baud and type (each line is echoed back as "> line", then answered):
#     TIME 12 34 56
#     DATE 11 21 2026
#     @north1 PAIR sonar
#     @north1 STATUS
#     HELP

mainnode.start(1)

def clear_log():
    datalogger.delete_log(datalogger.DeleteType.FAST)
    datalogger.set_column_titles("timestamp", "sensor", "channel", "kind", "value")

datalogger.set_column_titles("timestamp", "sensor", "channel", "kind", "value")
datalogger.on_log_full(clear_log)

# the extension hands us console lines it doesn't know
def on_unknown_console_command(verb, text):
    if verb == "LOGCLEAR":
        clear_log()
        serial.write_line("OK log cleared")
    else:
        serial.write_line("ERR UNKNOWN (type HELP)")
mainnode.on_unknown_console_command(on_unknown_console_command)

# every message that reaches the main node: print it, and log it if it is a detection
def on_report(sender, text):
    serial.write_line(sender + "> " + text)
    if commands.word(1, text) == "LOG":
        # LOG <channel> <kind> <time> <value>
        datalogger.log(datalogger.create_cv("timestamp", clock.date() + " " + commands.word(4, text)),
            datalogger.create_cv("sensor", sender),
            datalogger.create_cv("channel", int(commands.word(2, text))),
            datalogger.create_cv("kind", commands.word(3, text)),
            datalogger.create_cv("value", int(commands.word(5, text))))
mainnode.on_report(on_report)

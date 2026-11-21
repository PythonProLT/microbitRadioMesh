# STEP 2: log made-up data to flash with the datalogger. Needs only the datalogger extension.
# micro:bit V2 only. Every 2 seconds it logs a row: n, random, uptime_s.
# Rows are also printed to serial (mirror), and the LED shows a tick each time one is written.
# Button A: print how many rows were logged this run.
# Button B: delete the log and start over.
#
# To check the flash really has the data: in MakeCode click "Show data" (under the simulator,
# with the micro:bit connected), or open the MY_DATA drive that appears on your computer.

count = 0

def reset_log():
    global count
    datalogger.delete_log(datalogger.DeleteType.FAST)
    datalogger.set_column_titles("n", "random", "uptime_s")
    count = 0

def on_log_full():
    reset_log()
    serial.write_line("log was full, cleared")
datalogger.on_log_full(on_log_full)

def on_button_a():
    serial.write_line("rows logged this run: " + str(count))
input.on_button_pressed(Button.A, on_button_a)

def on_button_b():
    reset_log()
    serial.write_line("log cleared")
input.on_button_pressed(Button.B, on_button_b)

datalogger.set_column_titles("n", "random", "uptime_s")
datalogger.mirror_to_serial(True)
serial.write_line("Started")

def on_forever():
    global count
    count += 1
    datalogger.log(datalogger.create_cv("n", count),
        datalogger.create_cv("random", randint(0, 1000)),
        datalogger.create_cv("uptime_s", Math.idiv(input.running_time(), 1000)))
    serial.write_line("logged row " + str(count))
    basic.show_icon(IconNames.YES)
    basic.pause(300)
    basic.clear_screen()
    basic.pause(1700)
basic.forever(on_forever)

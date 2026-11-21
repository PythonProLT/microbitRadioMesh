# STEP 3: a PIR (AM312 / HW-740) on one pin, logged with timestamps. No sonar, no mesh.
# Extensions: timeanddate, datalogger.
# Wire: PIR GND -> GND, PIR VCC -> 3V, PIR OUT -> the pin chosen below (P1 by default).
# Give a PIR about a minute after power-up to settle before trusting it.
#
# Serial shows a heartbeat every 5 s (pir=0 or 1) and "MOTION <time>" for each logged hit.
# Hits closer together than QUIET_MS are ignored.

PIR_PIN = DigitalPin.P1
QUIET_MS = 5000

lastHit = -100000
beat = 0

datalogger.set_column_titles("Timestamp", "Sensor", "Data")
datalogger.mirror_to_serial(True)
timeanddate.set24_hour_time(0, 0, 0)

def on_log_full():
    datalogger.delete_log(datalogger.DeleteType.FAST)
    datalogger.set_column_titles("Timestamp", "Sensor", "Data")
datalogger.on_log_full(on_log_full)

serial.write_line("Started")

def on_forever():
    global lastHit, beat
    if pins.digital_read_pin(PIR_PIN) == 1 and input.running_time() - lastHit > QUIET_MS:
        lastHit = input.running_time()
        datalogger.log(datalogger.create_cv("Timestamp", timeanddate.time(timeanddate.TimeFormat.HHMMSS2_4HR)),
            datalogger.create_cv("Sensor", "PIR"),
            datalogger.create_cv("Data", 1))
        serial.write_line("MOTION " + timeanddate.time(timeanddate.TimeFormat.HHMMSS2_4HR))
    beat += 1
    if beat >= 50:
        beat = 0
        serial.write_line("pir=" + str(pins.digital_read_pin(PIR_PIN)))
    basic.pause(100)
basic.forever(on_forever)

# STEP 1: find the sonar and print its distance to serial. Needs only the sonarbit extension.
# Plug the Sonar:bit's 3 wires in as: GND -> GND, VCC -> 3V, signal -> any pad below.
# Open the console (or a serial terminal at 115200 baud). Press A to scan again.
# A real reading is 4-400 cm, so 40-4000 mm. Keep your hand at least 10 cm away.
#
# Pins scanned: P0 P1 P2 P8 P12 P13 P14 P15 P16.
# Not scanned: P3 P4 P6 P7 P9 P10 (shared with the LED screen), P5 P11 (buttons), P19 P20 (I2C).

sonarPin = DigitalPin.P0
bestScore = 0
bestName = "none"
distance = 0

def probe(name: str, pin: DigitalPin):
    global bestScore, bestName, sonarPin, distance
    good = 0
    for index in range(3):
        distance = sonarbit.sonarbit_distance(Distance_Unit.DISTANCE_UNIT_MM, pin)
        if distance >= 20 and distance <= 4000:
            good += 1
        basic.pause(60)
    serial.write_line(name + " valid readings: " + str(good) + " of 3")
    if good > bestScore:
        bestScore = good
        bestName = name
        sonarPin = pin

def scan_all():
    global bestScore, bestName
    bestScore = 0
    bestName = "none"
    serial.write_line("--- scanning ---")
    probe("P0", DigitalPin.P0)
    probe("P1", DigitalPin.P1)
    probe("P2", DigitalPin.P2)
    probe("P8", DigitalPin.P8)
    probe("P12", DigitalPin.P12)
    probe("P13", DigitalPin.P13)
    probe("P14", DigitalPin.P14)
    probe("P15", DigitalPin.P15)
    probe("P16", DigitalPin.P16)
    if bestScore >= 2:
        serial.write_line("SONAR FOUND ON " + bestName)
    else:
        serial.write_line("NO SONAR FOUND. Check wiring and power, then press A")

def on_button_a():
    scan_all()
input.on_button_pressed(Button.A, on_button_a)

serial.write_line("Started")
scan_all()

def on_forever():
    global distance
    if bestScore >= 2:
        distance = sonarbit.sonarbit_distance(Distance_Unit.DISTANCE_UNIT_MM, sonarPin)
        serial.write_line(bestName + " distance_mm=" + str(distance))
    basic.pause(500)
basic.forever(on_forever)

# STEP 4: mesh test with fake data. Extensions: radio-mesh (this repo), timeanddate.
# Put this on a test sensor micro:bit and examples/main.py on the main micro:bit (both on group 1).
# Name the sensor over USB serial first (115200 baud):   SET name test1
# Every 10 seconds it sends "LOG 1 test <time> <random number>" to "main".
# The main prints   test1> LOG 1 test 00:00:12 417   and writes a row to its datalogger.
# From the main console you can also check the link:   @test1 PING   ->   test1> PONG

timeanddate.set24_hour_time(0, 0, 0)
mesh.default_name("unnamed")
mesh.start(1)
commands.enable_serial()

def on_forever():
    mesh.send("main", "LOG 1 test " + timeanddate.time(timeanddate.TimeFormat.HHMMSS2_4HR) + " " + str(randint(0, 999)))
    basic.pause(10000)
basic.forever(on_forever)

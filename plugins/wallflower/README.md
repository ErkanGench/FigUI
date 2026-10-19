# Wallflower

Converts an SVG to G-code for a vertical plotter or polargraph, saves it to the
controller's SD card, and starts the job — without leaving FigUI.

Written for wall drawing robots running FluidNC: two axes plus a servo for the
pen, with the center of the page at 0,0.

## What it does

- Reads an SVG and flattens every path, including curves, to millimeters
- Places the drawing with the **center of the page at 0,0**, which is what a
  polargraph wants, rather than at a corner
- Optional line merge, line sort and simplify, all off or adjustable — nothing
  reorders your drawing unless you ask it to
- Pen up and down as `M3 S<value>`, with the servo value and the dwell either
  side of it under your control
- Previews the drawing to scale **inside the whole machine**, with the motors
  drawn where your config says they hang
- Writes the G-code to the SD card and starts the job

The G-code is plain Cartesian. The firmware does the polargraph math, so nothing
here needs to know about belt lengths.

## Requirements

- A FluidNC controller, reachable in FigUI
- Two axes and a servo on the spindle output, so `M3 S<value>` moves the pen
- For the motors in the preview: `WallPlotter` kinematics in your `config.yaml`.
  Without it the drawing and travel limits still show, just no motors.

## Install

Install it from the FigUI plugin store. It opens in the center panel, with the
terminal and file list still on the right.

## The preview

The view frames the **whole machine**, not just the drawing, so a small drawing
looks small. Read on it:

- **Motors** — the two anchor points from `kinematics/WallPlotter/` in your
  config, drawn at the top corners
- **Dashed cables** — from each motor down to where the pen starts, meeting at
  a small circle for the gondola
- **Dashed box** — the axis travel from `axes/x/max_travel_mm` and
  `axes/y/max_travel_mm`, centered on 0,0
- **Solid rectangle** — your sheet, from the SVG's own size
- **Crosshair** — 0,0, the center of the page

Scroll to zoom, drag to pan, double-click to reset. **Whole machine** and
**Fit drawing** jump between the two useful framings.

The config is read each time the plugin window opens, so if you edit
`config.yaml` just close and reopen the plugin.

## Settings

Defaults in parentheses.

### Merge and Sort Options

**Line Merge** (off) — Joins separate paths whose ends nearly touch into one
continuous stroke, so the pen stays down instead of lifting and re-placing.
Useful for drawings exported as thousands of tiny unconnected segments.

**Tolerance (mm)** (0.1) — How far apart two ends can be and still get joined.
Only used when Line Merge is on.

**Line Sort** (off) — Reorders the paths so each one starts near where the last
finished. Cuts travel time without changing the drawing.

**Preserve Direction** (off) — Stops the sorter from reversing a path to reach
its nearer end. Leave it off unless stroke direction matters to you.

**Simplify (mm)** (0.01) — Drops points that sit within this distance of the
straight line between their neighbors. Curves arrive from the SVG as many short
segments, and this throws out the ones that don't change the shape. Raise it and
curves start to look faceted.

These run in order: merge, then simplify, then sort.

### Drawing Options

Center of the page is 0,0.

**Scale (%)** (100) — Resizes the drawing. 100 means the SVG's own millimeter
size.

**Flip Horizontal** (off) — Mirrors left to right.

**Flip Vertical** (off) — Mirrors top to bottom. SVG counts Y downward and the
machine counts it upward, so Wallflower already flips Y; this checkbox flips it
back.

**Offset X / Offset Y (mm)** (0) — Moves the whole drawing on the page. Applied
after scaling, so these are always real millimeters. Positive X is right,
positive Y is up.

### Servo Values

**Pen Up (M3 S)** (0) — Servo value written as `M3 S0` to lift the pen off the
paper.

**Pen Down (M3 S)** (80) — Servo value for the pen touching the paper. Use the
Pen Up and Pen Down buttons to send these live and find your own numbers before
converting anything.

**Dwell (s)** (0.2) — Pause written before and after every pen-down, giving the
servo time to arrive before the machine moves. FluidNC counts `G4 P` in
**seconds**, not milliseconds — a value like 150 would stop the machine for two
and a half minutes per line. 

**Pen Up Dwell (s)** (0.2) — Pause after lifting. Set it to 0 and no pause line
gets written at all.

*The **dwell values** are important for accuracy, for something where more accuracy, a longer pause is better as it stabilizes the gondola.*

**Draw Speed (mm/min)** (2300) — Feed rate for drawing moves. Travel moves run
at the machine's own max rate from the config, so this only affects lines being
drawn.

### Drawing Info

Read-only. Page size, line and point counts, how far the pen draws and how far
it travels, X and Y extents in machine coordinates, and a rough time estimate.
It warns you if the drawing runs past the axis travel limits in your config.

### Save to SD Card

**Filename** — `.gcode` is added if you don't type an extension.

**Start Job** — Runs the file you just saved. Click once to arm it, again to
confirm. It disables itself whenever you change a setting or load a new SVG, so
it can't run a stale file.

**Reset settings** — Back to the defaults above. Settings are otherwise
remembered between sessions.

## What the G-code looks like

```gcode
G90              ; Force Absolute Distance Mode (Critical for WallPlotters)
G21              ; Force Millimeters Mode
M3 S0
G4 P0.2

G0 F2300 X-15.0000 Y15.0000
G4 P0.2
M3 S80
G4 P0.2
G1 X15.0000 Y15.0000
G1 X15.0000 Y-15.0000
M3 S0
G4 P0.2

G0 X0.0000 Y0.0000
```

One `G0` to the start of each line, pen down, `G1` through the points, pen up.
It ends by sending the gondola back to 0,0.

## If your curves look faceted

Check the SVG first. Text from a stroke font often arrives as a 16-sided polygon
where you expected a circle, and no amount of simplifying will smooth something
that was never curved.

If the geometry is fine and the machine still jerks through curves, it is
cornering, not the G-code. Try adding to your `config.yaml`, at the top level:

```yaml
junction_deviation_mm: 0.05
```

Short segments and a low acceleration mean the machine can never reach the feed
rate you asked for, so it accelerates and brakes through every point. Raising
acceleration or junction deviation lets it carry speed around corners.

## Tutorial

Full build instructions for the wall drawing robot coming soon

## Version history

1.1.0 — The preview now shows the whole machine to scale instead of just the drawing: the two motors drawn at the anchor points from your config, dashed cables down to the gondola, and the axis travel as a dashed box. Scroll to zoom, drag to pan. The machine config is read each time the plugin opens, so edits to config.yaml show up on reopen.

1.0.0 — First release. SVG to G-code with center origin, optional merge, sort and simplify, servo pen control, save to SD card and start the job.

## Credits

By [Liz Melchor](https://lizmelchor.com) — [@i.draw.monkeys](https://instagram.com/i.draw.monkeys)
Coded with help from Claude.

Built as a plugin for [FigUI](https://github.com/figamore/FigUI).

# Washdown

A FigUI plugin for switching a washdown pump through a FluidNC digital output and displaying its state from a separate digital feedback input. The button and ON indicator turn green when feedback confirms the output is ON.

## Installation

Keep `plugin.json`, `index.html`, and `icon.png` together in a `washdown` folder. In FigUI, open **Plugins → Add** and select that folder. Alternatively, copy it to `/sd/plugins/washdown/` and refresh the plugin list.

## Configuration

Add a top-level `config` object to `plugin.json`:

```json
{
  "name": "Washdown",
  "description": "A FigUI plugin for switching a washdown pump through a FluidNC digital output and displaying its state from a separate digital feedback input.",
  "version": "1.1.1",
  "entry": "index.html",
  "layout": "default",
  "icon": "icon.png",
  "config": {
    "outputIndex": 0,
    "inputIndex": 0,
    "feedbackLabel": "Washdown output"
  }
}
```

| Setting | Purpose |
| --- | --- |
| `outputIndex` | FluidNC `user_outputs` digital slot to switch. `0` selects `digital0_pin`; ON sends `M64 P0`, OFF sends `M65 P0`. |
| `inputIndex` | FluidNC `user_inputs` digital slot to sample. `0` selects `digital0_pin`; the read sends `M66 P0 L0`. |
| `feedbackLabel` | Display label for the feedback source. It does not assign or query a physical GPIO. |

The input and output indexes are independent and need not match. Use numeric integer indexes for slots defined in your FluidNC configuration. The plugin loads the manifest through FigUI's `readFile` API each time it opens. After changing the manifest, close and reopen the plugin. Missing or invalid configuration leaves the state Unknown and disables controls; no output command is sent.

## FluidNC setup

Physical pin assignments belong in FluidNC's YAML. For index `0`, assign your chosen output and feedback input to their respective `digital0_pin` slots. Replace the placeholders below with pin names supported by your controller:

```yaml
user_outputs:
  digital0_pin: <output_pin>

user_inputs:
  digital0_pin: <feedback_input_pin>
```

Provide a feedback signal to the configured input. A loopback from the output control signal is one option when the controller's output and input circuits are electrically compatible; isolated relay feedback is another. Check signal voltage, grounding or isolation, and the controller's input requirements before wiring. The plugin expects the configured input to read HIGH for ON and LOW for OFF. If the feedback circuit reverses that relationship, configure the input polarity in FluidNC.

Enable informational messages so the plugin can receive its tagged PRINT response:

```gcode
$Message/Level=Info
```

## Operation

- Reads feedback when opened, after each toggle, and when **Refresh state** is clicked. It also refreshes when the machine returns to Idle.
- Uses `M66` to sample the configured input into `#5399`, followed by a tagged PRINT message. The displayed state comes from this measurement, not the last requested command.
- Does not periodically query the input. Controls and reads are available while Idle because `M66` can synchronize queued motion.
- Opening or closing the plugin does not switch the output. Turn washdown OFF and confirm OFF before closing it.
- Missing feedback or a controller error displays Unknown. A command/feedback mismatch displays the measured state with a mismatch message.

The displayed state confirms the configured feedback input. What it verifies depends on the feedback source: a control-signal loopback confirms the output signal, while relay or flow feedback can report the corresponding hardware condition. The plugin does not infer pump operation from a command alone.

## Author

Created by [Douglas Reynolds](https://github.com/DougReynolds), with development assistance from OpenAI Codex.

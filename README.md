# Freebuff Computer Use

Gives [Freebuff](https://freebuff.com)'s agent computer use: it can see and control your Windows desktop, across any number of monitors, through built-in tools (not an MCP server).

## Features

- **Agent tools:** `computer_screenshot`, `computer_click`, `computer_move`, `computer_drag`, `computer_scroll`, `computer_type`, `computer_key`, `computer_windows`, `computer_snapshot` (UI Automation tree), `computer_clipboard`, `computer_wait`, `computer_displays`
- **Multi-monitor:** pick a display by index or use `"all"`; clicks map exactly across mixed resolutions and DPI scales.
- **Settings › Computer Use** inside Freebuff:
  - turn it on or off, or make it view-only
  - choose which monitors the agent may use, with a test screenshot per monitor
  - set screenshot size, format and quality
  - list blocked apps
- **"Freebuff is using this monitor":** a light-green badge on each monitor the agent is using. It is click-through and hidden from the agent's screenshots.
- **Fail-safe:** move the mouse into the top-left corner of any monitor to stop the agent's actions.

## Install

1. Run `FreebuffComputerUse-Setup.exe`, or drag your Freebuff folder onto it. It finds Freebuff automatically (`%LOCALAPPDATA%\Programs\@codebufffreebuff-desktop`).
2. Let it close and restart Freebuff.

Run it again to reinstall or uninstall. Uninstalling restores Freebuff's files exactly; your settings stay in `%LOCALAPPDATA%\FreebuffComputerUse\config.json`.

Freebuff updates replace the patched files, so run the installer again after updating. The installer can optionally do this for you at sign-in.

| Flag | Effect |
| --- | --- |
| `"<folder>"` | install into this Freebuff folder |
| `--uninstall` | remove Computer Use |
| `--yes` | no questions; closes Freebuff if it is running |
| `--reapply` | silent; re-patch only if an update removed it |

## How it works

| Piece | Role |
| --- | --- |
| `helper/FbcuHelper.cs` | Native .NET helper (JSON lines over stdio). Handles screenshots, mouse/keyboard input, windows, UI Automation, the clipboard and the monitor badge. |
| `ext/extension.cjs` | Registers the `computer_*` tools into Freebuff's orchestrator tool list. |
| `ext/electron-main.cjs`, `ext/settings-ui.js` | IPC and the Settings › Computer Use panel. |
| `ext/patch.cjs` | Small, marker-delimited hooks (`/*fbcu:start*/ … /*fbcu:end*/`) for `orchestrator.js`, the orchestrator loader and `app.asar`. |
| `installer/` | The setup program, including a minimal asar repacker. Bundled with Bun into a single exe. |

## Build

You need Windows with .NET Framework 4 (for `csc.exe`), plus Bun. Bun is taken from the Freebuff install if it is present.

```
build.cmd
```

This produces `build\FbcuHelper.exe` and `build\FreebuffComputerUse-Setup.exe`.

## Disclaimer

This project is unofficial and not affiliated with Freebuff or Codebuff. It gives an AI agent control of your mouse and keyboard, so use view-only mode, monitor restrictions and blocked apps to limit it.

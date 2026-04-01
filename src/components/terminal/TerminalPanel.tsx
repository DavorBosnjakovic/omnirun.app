import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../../stores/settingsStore";
import { useProjectStore } from "../../stores/projectStore";
import { terminalThemes } from "./terminalThemes";
import "@xterm/xterm/css/xterm.css";

function TerminalPanel() {
  const terminalElRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // Use refs for values that change but are read inside the onData closure
  const inputBuffer = useRef("");
  const commandHistory = useRef<string[]>([]);
  const historyIndex = useRef(-1);
  const cwdRef = useRef("");
  const projectPathRef = useRef("");
  const isRunning = useRef(false);

  const { theme } = useSettingsStore();
  const { projectPath } = useProjectStore();

  // Keep refs in sync with state
  useEffect(() => {
    projectPathRef.current = projectPath || "";
    if (!cwdRef.current && projectPath) {
      cwdRef.current = projectPath;
    }
  }, [projectPath]);

  // When project changes, reset cwd and notify user
  useEffect(() => {
    if (projectPath) {
      cwdRef.current = projectPath;
      const term = xtermRef.current;
      if (term) {
        const folder = projectPath.split(/[\\/]/).pop() || "~";
        term.write(`\r\n\x1b[90mSwitched to project: ${folder}\x1b[0m`);
        writePrompt(term);
        term.scrollToBottom();
      }
    }
  }, [projectPath]);

  // --- Helper functions that read from refs (always fresh values) ---

  function getPromptFolder(): string {
    const cwd = cwdRef.current || projectPathRef.current || "~";
    return cwd.split(/[\\/]/).pop() || "~";
  }

  function writePrompt(term: Terminal) {
    const folder = getPromptFolder();
    term.write(`\r\n\x1b[1;32m${folder}\x1b[0m \x1b[1;34m›\x1b[0m `);
  }

  function clearCurrentInput(term: Terminal) {
    const len = inputBuffer.current.length;
    for (let i = 0; i < len; i++) {
      term.write("\b \b");
    }
    inputBuffer.current = "";
  }

  async function executeCommand(term: Terminal, command: string) {
    if (!command.trim()) {
      writePrompt(term);
      term.scrollToBottom();
      return;
    }

    // Add to history
    commandHistory.current.push(command);
    historyIndex.current = commandHistory.current.length;

    const trimmed = command.trim();

    // Handle 'clear' / 'cls' locally
    if (trimmed === "clear" || trimmed === "cls") {
      term.clear();
      term.write("\x1b[1;36momnirun Terminal\x1b[0m");
      writePrompt(term);
      term.scrollToBottom();
      return;
    }

    // Handle 'cd' locally (changes working directory for next commands)
    if (trimmed === "cd" || trimmed.startsWith("cd ")) {
      const target = trimmed === "cd" ? projectPathRef.current : trimmed.slice(3).trim();
      try {
        const resolved: string = await invoke("resolve_path", {
          cwd: cwdRef.current || projectPathRef.current || "",
          target,
        });
        cwdRef.current = resolved;
        const folder = resolved.split(/[\\/]/).pop() || "~";
        term.write(`\r\n\x1b[90m${folder}\x1b[0m`);
      } catch (err: unknown) {
        term.write(`\r\n\x1b[1;31m${err}\x1b[0m`);
      }
      writePrompt(term);
      term.scrollToBottom();
      return;
    }

    // Run command via Rust backend
    isRunning.current = true;
    try {
      const result = await invoke<{ stdout: string; stderr: string; exit_code: number }>(
        "execute_command",
        {
          command: trimmed,
          cwd: cwdRef.current || projectPathRef.current || "",
        }
      );

      if (result.stdout) {
        const out = result.stdout.replace(/\n$/, "");
        term.write("\r\n" + out.replace(/\n/g, "\r\n"));
      }
      if (result.stderr) {
        const err = result.stderr.replace(/\n$/, "");
        term.write("\r\n\x1b[1;31m" + err.replace(/\n/g, "\r\n") + "\x1b[0m");
      }
    } catch (err: unknown) {
      term.write(`\r\n\x1b[1;31mError: ${err}\x1b[0m`);
    }
    isRunning.current = false;

    writePrompt(term);
    term.scrollToBottom();
  }

  // --- Initialize terminal (once) ---
  useEffect(() => {
    if (!terminalElRef.current || xtermRef.current) return;

    cwdRef.current = projectPath || "";
    projectPathRef.current = projectPath || "";

    const xtermTheme = terminalThemes[theme] || terminalThemes.dark;

    const term = new Terminal({
      theme: xtermTheme,
      fontSize: 13,
      fontFamily:
        "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Menlo, monospace",
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 5000,
      convertEol: false,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalElRef.current);

    // Small delay to ensure container has size before fitting
    setTimeout(() => {
      try {
        fitAddon.fit();
      } catch {
        /* ignore */
      }
    }, 50);

    // Welcome message
    term.write("\x1b[1;36momnirun Terminal\x1b[0m\r\n");
    term.write(
      "\x1b[90mType commands below. Use 'clear' to reset.\x1b[0m"
    );
    writePrompt(term);

    // Handle all input via onData (covers keyboard + paste)
    term.onData((data) => {
      // Ignore input while a command is running
      if (isRunning.current && data !== "\x03") return;

      if (data === "\r") {
        // ── Enter ──
        const cmd = inputBuffer.current;
        inputBuffer.current = "";
        executeCommand(term, cmd);
      } else if (data === "\x7f" || data === "\b") {
        // ── Backspace ──
        if (inputBuffer.current.length > 0) {
          inputBuffer.current = inputBuffer.current.slice(0, -1);
          term.write("\b \b");
        }
      } else if (data === "\x03") {
        // ── Ctrl+C ──
        inputBuffer.current = "";
        term.write("^C");
        writePrompt(term);
        term.scrollToBottom();
      } else if (data === "\x1b[A") {
        // ── Up arrow ── previous command in history
        if (
          commandHistory.current.length > 0 &&
          historyIndex.current > 0
        ) {
          historyIndex.current--;
          clearCurrentInput(term);
          const cmd = commandHistory.current[historyIndex.current];
          inputBuffer.current = cmd;
          term.write(cmd);
        }
      } else if (data === "\x1b[B") {
        // ── Down arrow ── next command in history
        clearCurrentInput(term);
        if (historyIndex.current < commandHistory.current.length - 1) {
          historyIndex.current++;
          const cmd = commandHistory.current[historyIndex.current];
          inputBuffer.current = cmd;
          term.write(cmd);
        } else {
          historyIndex.current = commandHistory.current.length;
          inputBuffer.current = "";
        }
      } else if (!data.startsWith("\x1b")) {
        // ── Printable characters + paste ──
        // Filter out escape sequences (arrow keys etc already handled above)
        const clean = data.replace(/[\r\n]/g, "");
        if (clean) {
          inputBuffer.current += clean;
          term.write(clean);
        }
      }
    });

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Auto-fit when container resizes (from the stretchable divider)
    const container = terminalElRef.current;
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        /* ignore */
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Update theme live (no terminal restart needed) ---
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme =
        terminalThemes[theme] || terminalThemes.dark;
    }
  }, [theme]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden min-h-0">
      <div
        ref={terminalElRef}
        className="flex-1 w-full min-h-0 overflow-hidden"
        style={{ padding: "4px" }}
      />
      {/* Fixed spacer — always visible below terminal, prevents prompt from touching bottom edge */}
      <div className="flex-shrink-0" style={{ height: "16px" }} />
    </div>
  );
}

export default TerminalPanel;
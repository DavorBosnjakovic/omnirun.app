// src/services/errorCapture.ts
// Captures browser console errors so ChatArea can send them to the AI for fixing.

const capturedErrors: string[] = [];

// Custom event name so ChatArea can react without polling
const ERROR_EVENT = "omnirun:console-error";

function dispatch() {
  window.dispatchEvent(new CustomEvent(ERROR_EVENT, { detail: [...capturedErrors] }));
}

export function initErrorCapture() {
  // Intercept console.error
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    const msg = args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(" ");
    capturedErrors.push(msg);
    dispatch();
    originalError(...args);
  };

  // Uncaught JS errors
  window.addEventListener("error", (e) => {
    const msg = e.error instanceof Error
      ? `${e.error.message}\n${e.error.stack}`
      : `${e.message} at ${e.filename}:${e.lineno}:${e.colno}`;
    capturedErrors.push(msg);
    dispatch();
  });

  // Unhandled promise rejections
  window.addEventListener("unhandledrejection", (e) => {
    const msg = e.reason instanceof Error
      ? `Unhandled promise rejection: ${e.reason.message}\n${e.reason.stack}`
      : `Unhandled promise rejection: ${String(e.reason)}`;
    capturedErrors.push(msg);
    dispatch();
  });
}

export function getErrors(): string[] {
  return [...capturedErrors];
}

export function clearErrors() {
  capturedErrors.length = 0;
  dispatch();
}

export function onErrorsChange(cb: (errors: string[]) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<string[]>).detail);
  window.addEventListener(ERROR_EVENT, handler);
  return () => window.removeEventListener(ERROR_EVENT, handler);
}
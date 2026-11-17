"use client";
'use strict';

var react = require('react');
var jsxRuntime = require('react/jsx-runtime');

// src/components/Button.tsx
var Button = react.forwardRef(function Button2({ variant = "primary", busy, className, type = "button", onClick, children, ...rest }, ref) {
  const isBusy = busy ?? false;
  return /* @__PURE__ */ jsxRuntime.jsx(
    "button",
    {
      ref,
      type,
      className: ["kit-button", `kit-button--${variant}`, className].filter(Boolean).join(" "),
      "aria-busy": isBusy || void 0,
      "aria-disabled": isBusy || void 0,
      onClick: (e) => {
        if (isBusy) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      },
      ...rest,
      children
    }
  );
});
function useField({ hint, error }, idProp) {
  const auto = react.useId();
  const id = idProp ?? auto;
  const hintId = hint ? `${id}-hint` : void 0;
  const errorId = error ? `${id}-error` : void 0;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || void 0;
  return { id, hintId, errorId, controlProps: { id, "aria-describedby": describedBy, "aria-invalid": error ? true : void 0 } };
}
function FieldShell(props) {
  return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "kit-field", children: [
    /* @__PURE__ */ jsxRuntime.jsx("label", { className: "kit-field__label", htmlFor: props.id, children: props.label }),
    props.children,
    props.hint && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "kit-field__hint", id: props.hintId, children: props.hint }),
    props.error && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "kit-field__error", id: props.errorId, children: props.error })
  ] });
}
var Input = react.forwardRef(function Input2({ label, hint, error, className, id: idProp, ...rest }, ref) {
  const { id, hintId, errorId, controlProps } = useField({ hint, error }, idProp);
  return /* @__PURE__ */ jsxRuntime.jsx(FieldShell, { label, hint, error, id, hintId, errorId, children: /* @__PURE__ */ jsxRuntime.jsx("input", { ref, className: ["kit-input", className].filter(Boolean).join(" "), ...controlProps, ...rest }) });
});
var Select = react.forwardRef(function Select2({ label, hint, error, className, id: idProp, children, ...rest }, ref) {
  const { id, hintId, errorId, controlProps } = useField({ hint, error }, idProp);
  return /* @__PURE__ */ jsxRuntime.jsx(FieldShell, { label, hint, error, id, hintId, errorId, children: /* @__PURE__ */ jsxRuntime.jsx("select", { ref, className: ["kit-select", className].filter(Boolean).join(" "), ...controlProps, ...rest, children }) });
});
function Dialog({ open, onClose, title, children, actions }) {
  const ref = react.useRef(null);
  const titleId = react.useId();
  react.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "dialog",
    {
      ref,
      className: "kit-dialog",
      "aria-labelledby": titleId,
      onClose,
      onClick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (e.target === e.currentTarget && !inside) onClose();
      },
      children: [
        /* @__PURE__ */ jsxRuntime.jsx("h2", { className: "kit-dialog__title", id: titleId, children: title }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { children }),
        actions && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "kit-dialog__actions", children: actions })
      ]
    }
  );
}
var ToastContext = react.createContext(null);
function useToast() {
  const ctx = react.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
function ToastProvider({ children }) {
  const [items, setItems] = react.useState([]);
  const nextId = react.useRef(1);
  const dismiss = react.useCallback((id) => setItems((s) => s.filter((t) => t.id !== id)), []);
  const toast = react.useCallback((o) => {
    const variant = o.variant ?? "info";
    const id = nextId.current++;
    setItems((s) => [...s, { id, message: o.message, variant, duration: o.duration ?? (variant === "error" ? 0 : 5e3) }]);
    return id;
  }, []);
  const value = react.useMemo(() => ({ toast, dismiss }), [toast, dismiss]);
  return /* @__PURE__ */ jsxRuntime.jsxs(ToastContext.Provider, { value, children: [
    children,
    /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "kit-toast-region", children: [
      /* @__PURE__ */ jsxRuntime.jsx("div", { role: "status", "aria-live": "polite", children: items.filter((t) => t.variant === "info").map((t) => /* @__PURE__ */ jsxRuntime.jsx(ToastView, { item: t, dismiss }, t.id)) }),
      /* @__PURE__ */ jsxRuntime.jsx("div", { role: "alert", children: items.filter((t) => t.variant === "error").map((t) => /* @__PURE__ */ jsxRuntime.jsx(ToastView, { item: t, dismiss }, t.id)) })
    ] })
  ] });
}
function ToastView({ item, dismiss }) {
  react.useEffect(() => {
    if (!item.duration) return;
    const t = setTimeout(() => dismiss(item.id), item.duration);
    return () => clearTimeout(t);
  }, [item, dismiss]);
  return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: `kit-toast kit-toast--${item.variant}`, children: [
    /* @__PURE__ */ jsxRuntime.jsx("span", { children: item.message }),
    /* @__PURE__ */ jsxRuntime.jsx("button", { type: "button", className: "kit-toast__close", "aria-label": "Dismiss notification", onClick: () => dismiss(item.id), children: "\xD7" })
  ] });
}
var STORAGE_KEY = "kit-theme";
var ThemeContext = react.createContext(null);
function useTheme() {
  const ctx = react.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
function readStored(fallback) {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : fallback;
  } catch {
    return fallback;
  }
}
var systemPrefersDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
function ThemeProvider({ children, defaultTheme = "system" }) {
  const [theme, setThemeState] = react.useState(defaultTheme);
  const [systemDark, setSystemDark] = react.useState(false);
  react.useEffect(() => {
    setThemeState(readStored(defaultTheme));
    setSystemDark(systemPrefersDark());
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = (e) => setSystemDark(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, [defaultTheme]);
  react.useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);
  const setTheme = react.useCallback((t) => {
    setThemeState(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
    }
  }, []);
  const resolved = theme === "system" ? systemDark ? "dark" : "light" : theme;
  const value = react.useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
  return /* @__PURE__ */ jsxRuntime.jsx(ThemeContext.Provider, { value, children });
}

// src/tokens.json
var tokens_default = {
  shared: {
    "space-1": "0.25rem",
    "space-2": "0.5rem",
    "space-3": "0.75rem",
    "space-4": "1rem",
    "space-6": "1.5rem",
    "radius-sm": "0.25rem",
    "radius-md": "0.5rem",
    "font-sans": "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    "font-size-sm": "0.875rem",
    "font-size-md": "1rem",
    "focus-ring-width": "3px",
    "motion-duration": "150ms"
  },
  light: {
    "color-bg": "#ffffff",
    "color-surface": "#f6f7f9",
    "color-text": "#14171f",
    "color-text-muted": "#4a5160",
    "color-border": "#8a91a0",
    "color-primary": "#1d4ed8",
    "color-primary-text": "#ffffff",
    "color-danger": "#b42318",
    "color-focus": "#1d4ed8",
    "color-overlay": "rgba(10, 12, 18, 0.55)"
  },
  dark: {
    "color-bg": "#0f1219",
    "color-surface": "#1a1f2b",
    "color-text": "#eef0f5",
    "color-text-muted": "#a7aebd",
    "color-border": "#7a8296",
    "color-primary": "#7aa2ff",
    "color-primary-text": "#0b1020",
    "color-danger": "#ff8a80",
    "color-focus": "#9db9ff",
    "color-overlay": "rgba(0, 0, 0, 0.7)"
  }
};

exports.Button = Button;
exports.Dialog = Dialog;
exports.Input = Input;
exports.Select = Select;
exports.ThemeProvider = ThemeProvider;
exports.ToastProvider = ToastProvider;
exports.tokens = tokens_default;
exports.useTheme = useTheme;
exports.useToast = useToast;

const root = document.documentElement;
const toggle = document.querySelector("#theme-toggle");
const icon = document.querySelector("#theme-icon");
const label = document.querySelector("#theme-label");
const sun = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>';
const moon = '<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>';

function setTheme(theme) {
  root.dataset.theme = theme;
  const dark = theme === "dark";
  icon.innerHTML = dark ? sun : moon;
  label.textContent = dark ? "Light mode" : "Dark mode";
  toggle.setAttribute("aria-label", `Switch to ${dark ? "light" : "dark"} mode`);
  window.dispatchEvent(new CustomEvent("webtools-theme-change"));
}

const savedTheme = localStorage.getItem("webtools-theme");
setTheme(savedTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

toggle.addEventListener("click", () => {
  const theme = root.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("webtools-theme", theme);
  setTheme(theme);
});

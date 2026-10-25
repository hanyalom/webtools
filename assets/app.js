const root = document.documentElement;
const themeToggle = document.querySelector("#theme-toggle");
const themeIcon = document.querySelector("#theme-icon");
const themeLabel = document.querySelector("#theme-label");
const themeColor = document.querySelector('meta[name="theme-color"]');
const searchInput = document.querySelector("#tool-search");
const toolGrid = document.querySelector("#tool-grid");
const toolCards = [...document.querySelectorAll(".tool-card")];
const visibleCount = document.querySelector("#visible-count");
const countLabel = document.querySelector("#count-label");
const emptyState = document.querySelector("#empty-state");
const viewButtons = [...document.querySelectorAll("[data-view-button]")];

const sunIcon = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>';
const moonIcon = '<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>';

function updateTheme(theme) {
  root.dataset.theme = theme;
  const isDark = theme === "dark";
  themeIcon.innerHTML = isDark ? sunIcon : moonIcon;
  themeLabel.textContent = isDark ? "Light mode" : "Dark mode";
  themeToggle.setAttribute("aria-label", `Switch to ${isDark ? "light" : "dark"} mode`);
  themeColor.content = isDark ? "#11151d" : "#f4f6fb";
}

const savedTheme = localStorage.getItem("webtools-theme");
updateTheme(savedTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

themeToggle.addEventListener("click", () => {
  const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("webtools-theme", nextTheme);
  updateTheme(nextTheme);
});

function updateSearch() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  let count = 0;

  toolCards.forEach((card) => {
    const matches = card.textContent.toLocaleLowerCase().includes(query)
      || card.dataset.search.includes(query)
      || card.dataset.category.toLocaleLowerCase().includes(query);
    card.hidden = !matches;
    if (matches) count += 1;
  });

  visibleCount.textContent = count;
  countLabel.textContent = count === 1 ? "tool to explore" : "tools to explore";
  emptyState.hidden = count !== 0;
}

searchInput.addEventListener("input", updateSearch);

function updateView(view) {
  toolGrid.dataset.view = view;
  viewButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.viewButton === view));
  });
  localStorage.setItem("webtools-view", view);
}

viewButtons.forEach((button) => {
  button.addEventListener("click", () => updateView(button.dataset.viewButton));
});

const savedView = localStorage.getItem("webtools-view");
if (savedView === "list" || savedView === "grid") updateView(savedView);

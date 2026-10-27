// Sitcom Tracker: loads catalog.json and lists the shows.
// The catalog is only read, never changed.

// Turn a show's years into display text, e.g. "1982–1993".
// A missing end year does not mean the show is running (see meta.missing_value_policy),
// so in that case we show the catalog's own status instead of guessing.
function formatYears(show) {
  const start = show.years.start ?? "?";
  if (show.years.end) {
    return `${start}–${show.years.end}`;
  }
  return `${start}– (${show.status})`;
}

// Build one <li> for a show. textContent is used instead of innerHTML so
// that text from the data is always shown as plain text.
function makeShowItem(show) {
  const item = document.createElement("li");

  const title = document.createElement("span");
  title.className = "title";
  title.textContent = show.title;

  const years = document.createElement("span");
  years.className = "years";
  years.textContent = formatYears(show);

  item.append(title, years);
  return item;
}

async function loadCatalog() {
  const status = document.getElementById("status");
  const list = document.getElementById("show-list");

  try {
    const response = await fetch("catalog.json");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const catalog = await response.json();

    status.textContent = `${catalog.shows.length} shows in the catalog (version ${catalog.meta.version}).`;
    for (const show of catalog.shows) {
      list.append(makeShowItem(show));
    }
  } catch (error) {
    // The usual cause is opening index.html directly from disk:
    // browsers block fetch() for file:// pages.
    status.className = "error";
    status.textContent =
      "Could not load catalog.json (" + error.message + "). " +
      "If you opened this file directly, run a local web server instead (see README).";
  }
}

loadCatalog();

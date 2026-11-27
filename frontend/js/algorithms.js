/**
 * Small, dependency-free algorithms used by the menu.
 *
 * Sorting: a stable top-down merge sort (O(n log n)).
 * Searching: normalized exact binary search for precise lookups and a
 * fuzzy token search as a fallback for partial or typo searches.
 */
window.MKAlgorithms = (function () {
  function mergeSort(items, compare) {
    if (!Array.isArray(items) || items.length < 2) return items ? [...items] : [];

    const middle = Math.floor(items.length / 2);
    const left = mergeSort(items.slice(0, middle), compare);
    const right = mergeSort(items.slice(middle), compare);
    const merged = [];
    let leftIndex = 0;
    let rightIndex = 0;

    while (leftIndex < left.length && rightIndex < right.length) {
      if (compare(left[leftIndex], right[rightIndex]) <= 0) {
        merged.push(left[leftIndex]);
        leftIndex += 1;
      } else {
        merged.push(right[rightIndex]);
        rightIndex += 1;
      }
    }

    return merged.concat(left.slice(leftIndex), right.slice(rightIndex));
  }

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenize(value) {
    return normalize(value).split(" ").filter(Boolean);
  }

  function editDistance(first, second) {
    const a = normalize(first);
    const b = normalize(second);
    const rows = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));

    for (let i = 0; i <= a.length; i += 1) rows[i][0] = i;
    for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;

    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        rows[i][j] = Math.min(
          rows[i - 1][j] + 1,
          rows[i][j - 1] + 1,
          rows[i - 1][j - 1] + cost
        );
      }
    }

    return rows[a.length][b.length];
  }

  function scoreItem(item, query) {
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) return 1;

    const name = normalize(item.name);
    const description = normalize(item.description);
    const category = normalize(item.categoryName);
    const tags = normalize((item.tags || []).join(" "));
    const haystack = `${name} ${description} ${category} ${tags}`;
    const queryTokens = tokenize(normalizedQuery);
    const nameWords = tokenize(name);
    let score = 0;

    if (name === normalizedQuery) score += 120;
    if (name.startsWith(normalizedQuery)) score += 55;
    if (name.includes(normalizedQuery)) score += 45;
    if (category.includes(normalizedQuery)) score += 14;
    if (tags.includes(normalizedQuery)) score += 18;

    for (const token of queryTokens) {
      if (nameWords.includes(token)) score += 22;
      else if (name.includes(token)) score += 14;
      else if (tags.includes(token)) score += 9;
      else if (description.includes(token)) score += 5;
      else if (category.includes(token)) score += 4;
      else if (haystack.includes(token)) score += 2;
      else {
        const typoMatch = [...nameWords, ...tokenize(tags)].some(
          (word) => word.length >= 4 && token.length >= 4 && editDistance(word, token) <= 1
        );
        if (typoMatch) score += 5;
      }
    }

    return score;
  }

  /**
   * Exact product-name lookup (binary search). Returns [] or a one item list.
   */
  function searchExact(items, query) {
    const target = normalize(query);
    if (!target) return [];

    const ranked = mergeSort(items || [], (a, b) =>
      normalize(a.name).localeCompare(normalize(b.name), "en", { sensitivity: "base" })
    );

    let low = 0;
    let high = ranked.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = normalize(ranked[middle].name);
      if (candidate === target) return [ranked[middle]];
      if (candidate < target) low = middle + 1;
      else high = middle - 1;
    }
    return [];
  }

  /**
   * Partial product-name search (linear scan, O(n)).
   */
  function searchPartial(items, query) {
    const target = normalize(query);
    if (!target) return [];
    return (items || []).filter(
      (item) => normalize(item.name).includes(target) ||
        normalize(item.categoryName).includes(target) ||
        normalize((item.tags || []).join(" ")).includes(target) ||
        normalize(item.description).includes(target)
    );
  }

  function searchMenu(items, query) {
    if (!normalize(query)) return [...items];

    const exact = searchExact(items, query);
    if (exact.length === 1) return exact;

    const partial = searchPartial(items, query);
    if (partial.length) return partial;

    const matches = items
      .map((item) => ({ item, score: scoreItem(item, query) }))
      .filter((entry) => entry.score > 0);

    return mergeSort(matches, (a, b) => b.score - a.score).map((entry) => entry.item);
  }

  function sortMenu(items, mode) {
    const compare = {
      recommended: (a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0),
      "price-asc": (a, b) => a.price - b.price || a.name.localeCompare(b.name),
      "price-desc": (a, b) => b.price - a.price || a.name.localeCompare(b.name),
      "name-asc": (a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
      "name-desc": (a, b) => b.name.localeCompare(a.name, "en", { sensitivity: "base" })
    }[mode] || ((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));

    return mergeSort(items, compare);
  }

  function formatPeso(value) {
    const amount = Number(value) || 0;
    const hasCents = Math.round(amount * 100) % 100 !== 0;
    return `₱${amount.toLocaleString("en-PH", {
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: 2
    })}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /**
   * Phone inputs: keep only digits, capped to the Philippine mobile formats
   * (09XXXXXXXXX = 11 digits, or +63 written out as 639XXXXXXXXX = 12 used
   * verbatim). Extra typing (or a spammed keypad) can never overflow the field.
   */
  function cleanPhoneDigits(raw) {
    const digits = String(raw ?? "").replace(/\D/g, "");
    return digits.slice(0, digits.startsWith("639") ? 12 : 11);
  }

  function debounce(fn, delay = 160) {
    let timeout;
    return function debounced(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  return {
    mergeSort,
    normalize,
    editDistance,
    searchExact,
    searchPartial,
    searchMenu,
    sortMenu,
    formatPeso,
    escapeHtml,
    cleanPhoneDigits,
    debounce
  };
})();

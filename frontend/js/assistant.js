/**
 * K-Bot — voice-only ordering assistant.
 *
 * Speech goes in through the browser's SpeechRecognition, replies come back
 * as text bubbles and spoken voice (SpeechSynthesis). There is intentionally
 * no text input anywhere in the panel.
 *
 * Its knowledge is the live menu only (names, prices, options, availability).
 * It never suggests, upsells or recommends anything the customer did not say,
 * and it answers nothing beyond ordering from the menu. A draft order is
 * built in this file, read back, and only committed to the cart (My Order)
 * after the customer confirms by voice.
 *
 * Works best in Chrome or Edge, served from localhost or HTTPS.
 */
(function () {
  "use strict";

  const A = window.MKAlgorithms;
  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => A.escapeHtml(value);

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const voice = {
    supported: Boolean(SpeechRecognition),
    synthSupported: "speechSynthesis" in window,
    recognition: null,
    listening: false,
    thinking: false,
    opened: false,
    finalHandled: false,
    sound: localStorage.getItem("mk_voice_sound") !== "off",
    lastReply: "",
    selectedVoice: null,
    // True while the last reply ended with a question: the mic reopens by
    // itself so the customer can answer hands-free.
    awaitReply: false
  };

  const els = {};

  // The in-progress voice order. Lines live here until the customer confirms;
  // only then are they committed to the real cart through window.MK.
  const order = {
    lines: [],
    pending: null,   // { type: "pick" | "options", ... }
    confirming: false
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    els.panel = $("#voice-panel");
    els.launcher = $("#voice-launcher");
    els.mic = $("#voice-mic");
    els.close = $("#voice-close");
    els.status = $("#voice-status");
    els.log = $("#voice-log");
    els.sound = $("#voice-sound");

    if (!els.panel) return;

    bindTriggers();
    setupRecognition();
    setupVoices();
    updateSoundButton();

    if (!voice.supported) {
      setStatus("Voice input is not available in this browser.");
      say("I need Chrome or Edge to hear you. Please open this site in Chrome or Edge on localhost or HTTPS, then tap the mic again.");
    }
  }

  function bindTriggers() {
    const openers = [
      els.launcher,
      $("#hero-voice"),
      $("#service-voice"),
      $("#footer-voice")
    ].filter(Boolean);

    openers.forEach((button) => {
      button.addEventListener("click", () => openPanel(true));
    });

    els.close?.addEventListener("click", () => closePanel(false));
    els.mic?.addEventListener("click", toggleListening);
    els.sound?.addEventListener("click", toggleSound);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && els.panel.classList.contains("is-open")) {
        closePanel(false);
      }
    });
  }

  function openPanel(autoListen = false) {
    if (!els.panel) return;
    els.panel.classList.add("is-open");
    els.panel.setAttribute("aria-hidden", "false");
    voice.opened = true;

    if (!voice.supported) {
      setStatus("Voice input is not available in this browser.");
      say("Please open MDNGHT K-RAVINGS in Chrome or Edge so I can hear you. You can still order with the menu buttons.");
      return;
    }

    if (!els.log.childElementCount) {
      say("Hi! I take orders by voice. Tell me what you're craving — for example “add 2 cheese kimbap”. Say “menu” to hear the sections.");
    }

    if (autoListen) {
      window.setTimeout(() => {
        if (!voice.listening && els.panel.classList.contains("is-open")) startListening();
      }, 320);
    }
  }

  function closePanel(keepSpeech = false) {
    if (!els.panel) return;
    els.panel.classList.remove("is-open", "is-listening", "is-thinking");
    els.panel.setAttribute("aria-hidden", "true");
    voice.opened = false;
    voice.awaitReply = false;
    stopListening();
    if (!keepSpeech && voice.synthSupported) window.speechSynthesis.cancel();
  }

  function setupRecognition() {
    if (!voice.supported) return;
    const recognition = new SpeechRecognition();
    recognition.lang = "en-PH";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      voice.listening = true;
      voice.finalHandled = false;
      els.panel.classList.add("is-listening");
      els.panel.classList.remove("is-thinking");
      setStatus("Listening… speak now.");
    };

    recognition.onresult = (event) => {
      let interim = "";
      let finalText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript || "";
        if (result.isFinal) finalText += text;
        else interim += text;
      }

      if (interim) setStatus(`Heard: “${interim.trim()}”`);
      if (finalText && !voice.finalHandled) {
        voice.finalHandled = true;
        heard(finalText.trim());
        window.setTimeout(() => handleCommand(finalText.trim()), 120);
      }
    };

    recognition.onerror = (event) => {
      const messages = {
        "not-allowed": "Microphone permission is blocked. Tap the padlock in the address bar and allow the microphone.",
        "service-not-allowed": "Microphone permission is blocked. Please allow microphone access for this site.",
        "audio-capture": "I couldn't find a microphone. Please check that one is connected.",
        "no-speech": "I didn't hear anything. Tap the mic and try again a little closer.",
        network: "The speech service is offline. Please check your internet connection.",
        aborted: ""
      };
      const message = messages[event.error];
      if (message) {
        voice.awaitReply = false;
        setStatus(message);
        say(message);
      }
    };

    recognition.onend = () => {
      voice.listening = false;
      els.panel.classList.remove("is-listening");
      if (!voice.thinking && els.panel.classList.contains("is-open") && !voice.awaitReply) {
        setStatus("Tap the mic to continue.");
      }
    };

    voice.recognition = recognition;
  }

  function setupVoices() {
    if (!voice.synthSupported) return;
    const load = () => {
      const voices = window.speechSynthesis.getVoices();
      voice.selectedVoice =
        voices.find((candidate) => /en-PH/i.test(candidate.lang)) ||
        voices.find((candidate) => /en-US/i.test(candidate.lang)) ||
        voices.find((candidate) => /^en/i.test(candidate.lang)) ||
        null;
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
  }

  function toggleListening() {
    if (!voice.supported) {
      openPanel(false);
      return;
    }
    if (voice.listening) stopListening();
    else startListening();
  }

  function startListening() {
    if (!voice.recognition || voice.listening) return;
    if (voice.synthSupported) window.speechSynthesis.cancel();
    try {
      voice.recognition.start();
    } catch {
      /* Calling start twice throws; ignore and keep the current session. */
    }
  }

  function stopListening() {
    if (!voice.recognition) return;
    try {
      voice.recognition.stop();
    } catch {
      /* Nothing to stop. */
    }
    voice.listening = false;
    els.panel?.classList.remove("is-listening");
  }

  function setStatus(text) {
    if (els.status) els.status.textContent = text;
  }

  /* ---------------------------------------------------------------------------
     Chat log: bubbles with auto-scroll. Bot replies are also spoken.
     ------------------------------------------------------------------------- */

  function addMsg(kind, html) {
    if (!els.log) return;
    const div = document.createElement("div");
    div.className = `voice-msg voice-msg-${kind}`;
    div.innerHTML = html;
    els.log.appendChild(div);
    els.log.scrollTop = els.log.scrollHeight;
    while (els.log.childElementCount > 60) els.log.firstElementChild.remove();
  }

  function itemCards(cards) {
    return (cards || []).map((item) => `
      <div class="voice-card">
        <img src="${esc(window.resolveMenuImage(item.imageKey))}" alt="">
        <span><strong>${esc(item.name)}</strong><small>${esc(A.formatPeso(item.price))}</small></span>
      </div>
    `).join("");
  }

  function say(text, cards = []) {
    voice.lastReply = text;
    addMsg("bot", `<span class="voice-tag">K-Bot</span><p>${esc(text)}</p>${itemCards(cards)}`);
    speak(text);
  }

  function heard(text) {
    addMsg("user", `<span class="voice-tag">You</span><p>${esc(text)}</p>`);
  }

  function updateSoundButton() {
    if (!els.sound) return;
    els.sound.textContent = voice.sound ? "Sound on" : "Sound off";
    els.sound.setAttribute("aria-pressed", String(voice.sound));
  }

  function toggleSound() {
    voice.sound = !voice.sound;
    localStorage.setItem("mk_voice_sound", voice.sound ? "on" : "off");
    updateSoundButton();
    if (!voice.sound && voice.synthSupported) window.speechSynthesis.cancel();
    if (voice.sound && voice.lastReply) speak(voice.lastReply);
  }

  function speak(text) {
    if (!text) return;
    voice.lastReply = text;
    if (!voice.sound || !voice.synthSupported) {
      afterSpeak();
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      String(text)
        .replace(/[₱]\s?([\d,.]+)/g, "$1 pesos")
        .replace(/[•·]/g, ", ")
        .replace(/[–—]/g, " to ")
    );
    utterance.lang = "en-PH";
    utterance.rate = 0.96;
    utterance.pitch = 1.02;
    utterance.volume = 1;
    if (voice.selectedVoice) utterance.voice = voice.selectedVoice;

    voice.thinking = true;
    els.panel?.classList.add("is-thinking");
    setStatus("Speaking… tap the mic to interrupt.");
    utterance.onend = () => afterSpeak();
    utterance.onerror = () => afterSpeak();
    window.speechSynthesis.speak(utterance);
  }

  function afterSpeak() {
    voice.thinking = false;
    els.panel?.classList.remove("is-thinking");
    if (voice.opened && voice.awaitReply && voice.supported && !voice.listening) {
      // Hands-free: the mic reopens after a question so the customer can
      // answer without tapping again.
      startListening();
    } else if (voice.opened && !voice.listening) {
      setStatus("Tap the mic to continue.");
    }
  }

  /* ---------------------------------------------------------------------------
     Menu data helpers (live from the same source the menu page uses)
     ------------------------------------------------------------------------- */

  function menuReady() {
    return Boolean(window.MK && window.MK.state && window.MK.state.items.length);
  }

  function availableItems() {
    return window.MK.state.items.filter((item) => item.isAvailable);
  }

  function matchItems(query) {
    const clean = String(query || "").trim();
    if (!clean) return [];
    return window.MK.searchItems(clean, 4);
  }

  function nameOf(value) {
    return A.normalize(value);
  }

  // One clear winner, or null when the matches are ambiguous.
  // - one result: take it (typo-tolerant search already ranked it)
  // - several results where the spoken phrase appears in the names: a single
  //   hit wins; a multi-word phrase ("cheese kimbap") trusts the search
  //   ranking; a single generic word ("wings") stays ambiguous.
  // - fuzzy-only ties: ask, never guess.
  function pickItem(results, query) {
    if (!results.length) return { item: null, results };
    if (results.length === 1) return { item: results[0], results };
    const clean = nameOf(query);
    const contained = results.filter((item) => nameOf(item.name).includes(clean));
    if (contained.length === 1) return { item: contained[0], results };
    if (contained.length > 1 && clean.split(" ").length > 1) return { item: contained[0], results };
    return { item: null, results };
  }

  const NUM_WORDS = {
    one: 1, isa: 1,
    two: 2, tu: 2, dalawa: 2,
    three: 3, tatlo: 3,
    four: 4, apat: 4,
    five: 5, lima: 5,
    six: 6, anim: 6,
    seven: 7, pito: 7,
    eight: 8, walo: 8,
    nine: 9, siyam: 9,
    ten: 10, sampu: 10,
    eleven: 11, twelve: 12
  };

  function parseQty(q) {
    const digit = q.match(/(?:^|\s)(\d{1,2})(?:\s|$)/);
    if (digit) {
      const value = Math.max(1, Math.min(20, Number(digit[1])));
      return { qty: value, text: q.replace(digit[0], " ") };
    }
    for (const [word, value] of Object.entries(NUM_WORDS)) {
      const hit = new RegExp(`(?:^|\\s)${word}s?(?:\\s|$)`).exec(q);
      if (hit) return { qty: value, text: q.replace(hit[0], " ") };
    }
    return { qty: 0, text: q };
  }

  const FILLER = [
    "please", "po", "nga", "ako", "me", "the", "a", "an", "for", "my", "your",
    "some", "order", "add", "buy", "find", "search", "show", "looking", "want",
    "like", "would", "i", "is", "are", "of", "to", "can", "you", "may", "have",
    "get", "give", "let", "us", "we", "do", "did", "meron", "ba", "ang", "ng",
    "sa", "na", "lang", "nang", "yung", "ung", "mga"
  ];

  function cleanQuery(q, prefixes = []) {
    let text = ` ${q} `;
    prefixes
      .slice()
      .sort((a, b) => b.length - a.length)
      .forEach((prefix) => {
        text = text.replace(new RegExp(`\\s${escapeRegExp(prefix)}\\s`, "g"), " ");
      });
    FILLER.forEach((word) => {
      text = text.replace(new RegExp(`\\s${word}\\s`, "g"), " ");
    });
    return text.replace(/\s+/g, " ").trim();
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /* ---------------------------------------------------------------------------
     Draft order helpers
     ------------------------------------------------------------------------- */

  function draftSubtotal() {
    return order.lines.reduce((total, line) => total + line.unitPrice * line.quantity, 0);
  }

  function draftReadBack() {
    const parts = order.lines.map((line) =>
      `${line.quantity} ${line.quantity === 1 ? "piece" : "pieces"} of ${line.item.name}${line.optionsText ? ` (${line.optionsText})` : ""}`
    );
    return `${parts.join(", ")}. Subtotal ${A.formatPeso(draftSubtotal())}.`;
  }

  function addDraft(item, quantity, selected) {
    const quote = window.MK.quoteLine(item, selected);
    const existing = order.lines.find((line) => line.key === quote.key);
    if (existing) {
      existing.quantity = Math.min(20, existing.quantity + quantity);
    } else {
      order.lines.push({ key: quote.key, item, quantity, selected, unitPrice: quote.unitPrice, optionsText: quote.optionsText });
    }
  }

  function resetDraft() {
    order.lines = [];
    order.pending = null;
    order.confirming = false;
  }

  // Ask for one missing required option group. One short question, no guessing.
  function askMissingOption(item, quantity, selected, group) {
    order.pending = { type: "options", item, quantity, selected };
    const names = (Array.isArray(group.choices) ? group.choices : [])
      .map((choice) => (typeof choice === "string" ? choice : choice?.name))
      .filter(Boolean)
      .slice(0, 5);
    say(`Got it — ${quantity} ${quantity === 1 ? "piece" : "pieces"} of ${item.name}. Which ${stripLabel(group.label) || "option"}? Say one of: ${names.join(", ")}.`);
    voice.awaitReply = true;
  }

  function stripLabel(label) {
    return String(label || "").replace(/^choose your /i, "").replace(/^choose /i, "").replace(/\(s\)/g, "s");
  }

  // Match spoken option names against a group's choices. Only what was said.
  function matchedChoices(group, q) {
    const names = (Array.isArray(group.choices) ? group.choices : [])
      .map((choice) => (typeof choice === "string" ? choice : choice?.name))
      .filter(Boolean);
    const spoken = [];
    names.forEach((name) => {
      const clean = nameOf(name);
      if (clean.length > 1 && q.includes(clean)) spoken.push([q.indexOf(clean), name]);
    });
    spoken.sort((a, b) => a[0] - b[0]);
    return spoken.map((entry) => entry[1]);
  }

  // Build the selection from the utterance; list required groups left empty.
  function fillOptions(item, q) {
    const selected = {};
    const missing = [];
    for (const group of item.optionGroups || []) {
      const type = group.type || "radio";
      const matched = matchedChoices(group, q);
      if (type === "flavors" || type === "checkbox") {
        const max = type === "flavors" ? Math.max(1, Number(group.max) || 4) : Math.max(1, Number(group.max) || matched.length || 1);
        const picked = matched.slice(0, max);
        if (picked.length) selected[group.key] = picked;
      } else if (matched.length) {
        selected[group.key] = matched[0];
      }
      if (group.required && !selected[group.key]) missing.push(group);
    }
    return { selected, missing };
  }

  function describeLine(line) {
    return `${line.quantity} ${line.quantity === 1 ? "piece" : "pieces"} of ${line.item.name}${line.optionsText ? ` (${line.optionsText})` : ""}`;
  }

  function addedReply() {
    voice.awaitReply = true;
    const rest = order.lines.length > 1 ? ` Your order so far: ${order.lines.map(describeLine).join(", ")}.` : "";
    say(`Added. ${describeLine(order.lines[order.lines.length - 1])}.${rest} Subtotal ${A.formatPeso(draftSubtotal())}. Say “that's all” when done, or keep adding.`);
  }

  /* ---------------------------------------------------------------------------
     Intent handling — menu knowledge only, no suggestions, no upselling
     ------------------------------------------------------------------------- */

  function handleCommand(raw) {
    voice.awaitReply = false;

    if (!menuReady()) {
      say("The menu is still loading. Please give me a moment and try again.");
      return;
    }

    const q = A.normalize(raw);
    if (!q) {
      say("I didn't catch that. Try “add cheese kimbap” or say “menu”.");
      return;
    }

    const has = (...words) => words.some((word) => q.includes(word));

    if (has("stop", "quiet", "shut up", "silence")) {
      if (voice.synthSupported) window.speechSynthesis.cancel();
      voice.thinking = false;
      els.panel.classList.remove("is-thinking");
      voice.awaitReply = false;
      setStatus("Okay, I'll stay quiet.");
      say("Okay, I'll stay quiet. Tap the mic whenever you need me.");
      return;
    }

    if (has("repeat", "say again", "ulit", "uli")) {
      if (voice.lastReply) say(voice.lastReply);
      else say("I haven't said anything yet. Tell me what you're craving.");
      return;
    }

    if (has("cancel", "never mind", "nevermind", "kanselahin", "start over", "forget it")) {
      if (order.lines.length || order.pending || order.confirming) {
        resetDraft();
        say("Okay, cancelled. Nothing was added to your order. Tell me what you'd like instead.");
      } else {
        say("There's no order in progress. Tell me what you're craving.");
      }
      return;
    }

    // Answering a pending clarifying question.
    if (order.pending) {
      handlePending(q, raw);
      return;
    }

    // Confirming the read-back.
    if (order.confirming) {
      handleConfirm(q);
      return;
    }

    if (has("remove", "delete", "take out", "takeoff", "alisin", "tanggalin", "tanggal")) {
      handleRemove(q);
      return;
    }

    if (has("change", "make it", "baguhin", "palitan")) {
      handleChange(q);
      return;
    }

    if (has("hello", "hi ", "hey", "kumusta", "kamusta", "good evening", "good morning") && q.length < 28) {
      say("Hi! I take orders by voice. Try “add 2 cheese kimbap”, or say “menu” to hear the sections.");
      voice.awaitReply = true;
      return;
    }

    if (has("thank", "salamat", "thanks")) {
      say("You're welcome! Say “menu” whenever you want to order.");
      return;
    }

    if (has("how do i order", "how to order", "paano order", "paano mag order", "help me order", "how does this work", "guide me", "what can you do", "help")) {
      say("Ordering by voice works like this: say “add” plus the dish — for example “add 2 cheese kimbap”. I'll ask for flavors if needed. Say “that's all” and I'll read the order back; say “yes” to put it in My Order, then finish checkout there. You can also say “remove that”, “change it to 3”, or “cancel”.");
      voice.awaitReply = true;
      return;
    }

    // normalize() turns "that's" into "that s", so match both shapes.
    if (has("that s all", "thats all", "that s it", "thats it", "i m done", "im done", "ready to order", "read my order", "read back", "review my order")) {
      handleCheckoutIntent();
      return;
    }

    if (has("my order", "my cart", "cart", "basket", "what's in my", "whats in my", "order summary", "open my order")) {
      handleOpenOrder();
      return;
    }

    if (has("checkout", "check out", "place my order", "pay now", "check out na")) {
      handleCheckoutIntent();
      return;
    }

    if (has("how much", "price", "magkano", "cost", "presyo")) {
      const query = cleanQuery(q, ["how much is", "how much are", "how much", "magkano ang", "magkano", "price of", "price", "cost of", "cost", "presyo ng", "presyo"]);
      const results = matchItems(query);
      if (results.length) {
        const item = results[0];
        const options = item.optionGroups.length ? " Options may add a little more." : "";
        window.MK.setQuery(item.name, { scroll: true });
        say(`${item.name} is ${A.formatPeso(item.price)}.${options} Say “add ${nameOf(item.name)}” to order it.`, [item]);
        voice.awaitReply = true;
      } else {
        say("Tell me the dish and I'll tell you the price. For example: how much is cheese kimbap?");
        voice.awaitReply = true;
      }
      return;
    }

    if (has("add ", "add to", "order a", "order some", "i want", "i'd like", "i would like", "gusto ko", "buy", "bilhin", "order ng")) {
      handleAdd(q);
      return;
    }

    if (has("menu", "what do you have", "what food", "food list", "categories", "ano meron", "ano ang meron")) {
      const sections = window.MK.state.categories.map((category) => {
        const names = (category.items || []).filter((item) => item.isAvailable).slice(0, 3).map((item) => item.name);
        return `${category.name} — ${names.join(", ")}`;
      });
      say(`We have ${window.MK.state.categories.length} sections on the menu. ${sections.join(". ")}. Say “add” plus a dish to order it.`);
      voice.awaitReply = true;
      return;
    }

    // Last chance: treat the whole phrase as a dish search. No guessing adds.
    runSearch(cleanQuery(q));
  }

  function handleAdd(q) {
    const { qty, text } = parseQty(q);
    const quantity = qty || 1;
    const query = cleanQuery(text, ["add to cart", "add to order", "add", "order a", "order some", "i want", "i'd like", "i would like", "gusto ko", "buy", "bilhin", "order ng", "order"]);
    if (!query) {
      say("Which dish should I add? For example: add cheese kimbap.");
      voice.awaitReply = true;
      return;
    }
    const { item, results } = pickItem(matchItems(query), query);
    if (!item) {
      if (results.length > 1) {
        order.pending = { type: "pick", quantity, candidates: results.slice(0, 2) };
        const names = order.pending.candidates.map((candidate) => candidate.name);
        say(`I found a few matches: ${names.join(" or ")}. Which one?`);
        voice.awaitReply = true;
        return;
      }
      window.MK.setQuery(query, { scroll: true });
      say(`I couldn't find “${query}” on the menu. I only know the dishes on our menu — say “menu” to hear them.`);
      voice.awaitReply = true;
      return;
    }
    startAdd(item, quantity, q);
  }

  function startAdd(item, quantity, q) {
    if (!item.isAvailable) {
      say(`Sorry, ${item.name} is unavailable right now. Say “menu” to see what we have.`);
      voice.awaitReply = true;
      return;
    }
    const { selected, missing } = fillOptions(item, nameOf(q));
    if (missing.length) {
      askMissingOption(item, quantity, selected, missing[0]);
      return;
    }
    addDraft(item, quantity, selected);
    addedReply();
  }

  function handlePending(q, raw) {
    // Corrections and navigation win over a half-answered question: drop the
    // pending item and handle the request normally.
    const stopPending = (...words) => words.some((word) => q.includes(word));
    if (stopPending("remove", "delete", "take out", "alisin", "change", "make it", "that s all", "thats all", "open my order", "my cart", "place my order", "checkout")) {
      order.pending = null;
      handleCommand(raw);
      return;
    }
    const pending = order.pending;

    if (pending.type === "pick") {
      const { item, results } = pickItem(pending.candidates, q);
      if (item || results.length === 1) {
        order.pending = null;
        startAdd(item || results[0], pending.quantity, q);
        return;
      }
      const other = matchItems(q);
      const otherPick = pickItem(other, q);
      if (otherPick.item) {
        order.pending = null;
        startAdd(otherPick.item, pending.quantity, q);
        return;
      }
      say(`Which one — ${pending.candidates.map((candidate) => candidate.name).join(" or ")}?`);
      voice.awaitReply = true;
      return;
    }

    // type "options": fill the missing required group(s) from this utterance.
    const { selected, missing } = fillOptions(pending.item, q);
    if (missing.length) {
      askMissingOption(pending.item, pending.quantity, selected, missing[0]);
      return;
    }
    order.pending = null;
    addDraft(pending.item, pending.quantity, selected);
    addedReply();
  }

  function handleRemove(q) {
    if (!order.lines.length) {
      say("There's nothing in your voice order yet. Say 'add' plus a dish to start.");
      voice.awaitReply = true;
      return;
    }
    const { text } = parseQty(q);
    const query = cleanQuery(text, ["remove the", "remove", "delete the", "delete", "take out the", "take out", "takeoff", "alisin", "tanggalin", "tanggal", "that", "it", "last", "one"]);
    if (query) {
      const index = order.lines.findIndex((line) => nameOf(line.item.name).includes(query) || query.includes(nameOf(line.item.name)));
      if (index >= 0) {
        const [line] = order.lines.splice(index, 1);
        say(`Removed ${line.item.name}. ${order.lines.length ? `Left: ${order.lines.map(describeLine).join(", ")}.` : "Your voice order is empty now."}`);
        voice.awaitReply = true;
        return;
      }
      // A specific dish was named but is not in the draft: never silently
      // delete a different line instead.
      say(`I couldn't find ${query} in your voice order. ${order.lines.length ? `Your order: ${order.lines.map(describeLine).join(", ")}.` : "Your voice order is empty now."}`);
      voice.awaitReply = true;
      return;
    }
    // No dish named ("remove that"): the last line is the one meant.
    const [last] = order.lines.splice(-1);
    say(`Removed ${last.item.name}. ${order.lines.length ? `Left: ${order.lines.map(describeLine).join(", ")}.` : "Your voice order is empty now."}`);
    voice.awaitReply = true;
  }

  function handleChange(q) {
    if (!order.lines.length) {
      say("There's nothing to change yet. Say 'add' plus a dish first.");
      voice.awaitReply = true;
      return;
    }
    const { qty, text } = parseQty(q);
    if (!qty) {
      say("To what number? For example: change it to 3.");
      voice.awaitReply = true;
      return;
    }
    // If a dish was named, edit THAT line; "change it to 3" falls back to the
    // most recent line. A named dish that isn't in the draft is never guessed.
    const named = cleanQuery(text, ["change the", "change", "make the", "make it", "make", "baguhin", "palitan", "it", "that", "to"]);
    let target = null;
    if (named) {
      target = order.lines.find((line) => nameOf(line.item.name).includes(named) || named.includes(nameOf(line.item.name))) || null;
      if (!target) {
        say(`You don't have ${named} in your voice order. ${order.lines.map(describeLine).join(", ")}.`);
        voice.awaitReply = true;
        return;
      }
    }
    const line = target || order.lines[order.lines.length - 1];
    line.quantity = Math.max(1, Math.min(20, qty));
    say(`Done - ${describeLine(line)}. Subtotal ${A.formatPeso(draftSubtotal())}. Say "that's all" when done.`);
    voice.awaitReply = true;
  }

  function handleOpenOrder() {
    if (order.lines.length) {
      order.confirming = true;
      say(`Your voice order: ${draftReadBack()} Say “yes” to add it to My Order, or “no” to cancel.`);
      voice.awaitReply = true;
      return;
    }
    if (window.MK.cartCount()) {
      const totals = window.MK.cartTotals();
      say(`You have ${window.MK.cartCount()} ${window.MK.cartCount() === 1 ? "item" : "items"} in your order. Subtotal ${A.formatPeso(totals.subtotal)}. I've opened My Order.`);
      closePanel(true);
      window.MK.openCart();
      return;
    }
    say("Your order is empty. Tell me what you're craving — for example “add 6 piece wings”.");
    voice.awaitReply = true;
  }

  function handleCheckoutIntent() {
    if (order.lines.length) {
      order.confirming = true;
      say(`Here's your order: ${draftReadBack()} Say “yes” to add it to My Order, or “no” to cancel.`);
      voice.awaitReply = true;
      return;
    }
    if (window.MK.cartCount()) {
      say("Opening My Order. Finish checkout there — I only take the order by voice.");
      closePanel(true);
      window.MK.openCart();
      return;
    }
    say("Your order is empty. Tell me what you're craving first.");
    voice.awaitReply = true;
  }

  function handleConfirm(q) {
    const has = (...words) => words.some((word) => q.includes(word));
    if (has("yes", "yeah", "yep", "confirm", "oo", "sige", "go ahead", "ok", "okay")) {
      const lines = order.lines.map((line) => ({ item: line.item, selected: line.selected, quantity: line.quantity }));
      const summary = draftReadBack();
      resetDraft();
      say(`Done! ${summary.replace(/\.$/, "")} is now in My Order — finish checkout there.`);
      window.MK.commitVoiceLines(lines);
      window.MK.openCart();
      return;
    }
    if (has("no", "nope", "hindi", "wait")) {
      const kept = order.lines.length;
      resetDraft();
      say(kept ? "Okay, cancelled — nothing was added. Tell me what you'd like instead." : "Okay. Tell me what you'd like to order.");
      voice.awaitReply = true;
      return;
    }
    // Anything else during confirmation: read it back once more.
    say(`Still waiting on your order: ${draftReadBack()} Say “yes” to add it to My Order, or “no” to cancel.`);
    voice.awaitReply = true;
  }

  function runSearch(query) {
    const clean = String(query || "").trim();
    if (!clean) {
      say("What dish are you looking for? Try “find cheese kimbap” or say “menu”.");
      voice.awaitReply = true;
      return;
    }

    // Long phrases are sentences, not dish names — the menu is all K-Bot
    // knows, so anything else gets the polite menu-only answer.
    if (clean.split(" ").length > 4) {
      say("I can only help with ordering from our menu. Say “menu” to hear the sections, or “add cheese kimbap” to start an order.");
      voice.awaitReply = true;
      return;
    }

    const results = matchItems(clean);
    const contained = results.filter((item) => nameOf(item.name).includes(clean));
    // A multi-word phrase that no dish name contains is a sentence, not a
    // dish: fuzzy matches for it are guesses, and K-Bot never guesses. Single
    // words keep typo tolerance ("kimba" still finds kimbap).
    const sentenceLike = clean.split(" ").length >= 2 && !contained.length;
    if (!results.length || (!contained.length && (results.length > 1 || sentenceLike))) {
      // Off-topic or unknown: the menu is the only thing K-Bot knows.
      say(`I couldn't find “${clean}” — I can only help with ordering from our menu. Say “menu” to hear the sections.`);
      voice.awaitReply = true;
      return;
    }

    window.MK.setQuery(clean, { scroll: true });
    const names = results.slice(0, 3).map((item) => `${item.name} at ${A.formatPeso(item.price)}`);
    say(`On the menu: ${names.join(", ")}. Say “add ${nameOf(results[0].name)}” to order it.`, results.slice(0, 3));
    voice.awaitReply = true;
  }

  // Small test/automation seam: drive the assistant without a microphone.
  window.MKBot = { handleCommand, draft: () => order.lines.map((line) => ({ name: line.item.name, quantity: line.quantity, optionsText: line.optionsText })), reset: resetDraft };
})();

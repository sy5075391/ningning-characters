"use strict";

const storageKey = "ningning-characters-v1";
const starterWords = Array.from(window.RECOGNITION_WORDS ?? "人大小山水火木日");
const wordExplanations = window.WORD_EXPLANATIONS ?? {};
const han = /[\p{Unified_Ideograph}〇]/gu;
const praiseClipCount = 40;

const bandit = document.getElementById("bandit");
const bluey = document.getElementById("bluey");
const bingo = document.getElementById("bingo");
const board = document.getElementById("board");
const glyph = document.getElementById("glyph");
const position = document.getElementById("position");
const announcement = document.getElementById("announcement");
const previousButton = document.getElementById("previous");
const nextButton = document.getElementById("next");
const correctButton = document.getElementById("correct");
const readButton = document.getElementById("read-word");
const encouragement = document.getElementById("encouragement");
const wordList = document.getElementById("word-list");
const pagination = document.getElementById("pagination");
const pageNumber = document.getElementById("page-number");
const previousPage = document.getElementById("previous-page");
const nextPage = document.getElementById("next-page");
const addToggle = document.getElementById("add-toggle");
const addForm = document.getElementById("add-form");
const wordButtons = new Map();
const count = document.getElementById("count");
const newWords = document.getElementById("new-words");
const addStatus = document.getElementById("add-status");
const storageWarning = document.getElementById("storage-warning");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const speaker = window.speechSynthesis;

let state = restoreProgress();
let pageSize = 0;
let nextPraise = 0;
let praiseAudio;
let wordAudio;
let currentUtterance;
let speechStartTimer;
let outgoing;

speaker?.getVoices();

function restoreProgress() {
  const fallback = { words: starterWords.slice(), current: starterWords[0] };

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const stored = JSON.parse(raw);
    if (!Array.isArray(stored?.words)) return fallback;

    const storedWords = stored.words.filter((word) =>
      typeof word === "string" && word.match(han)?.[0] === word
    );
    const words = [...new Set([...starterWords, ...storedWords])];
    return { words, current: words.includes(stored.current) ? stored.current : words[0] };
  } catch {
    return fallback;
  }
}

function saveProgress() {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
    storageWarning.hidden = true;
    return true;
  } catch {
    storageWarning.hidden = false;
    return false;
  }
}

function updateSelection() {
  const index = state.words.indexOf(state.current);
  glyph.textContent = state.current;
  position.textContent = `${index + 1} / ${state.words.length}`;
  previousButton.disabled = index === 0;
  nextButton.disabled = index === state.words.length - 1;

  for (const button of wordButtons.values()) {
    if (button.dataset.word === state.current) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  }
}

function appendWordButtons(words) {
  for (const word of words) {
    let page = wordList.lastElementChild;
    if (!page || page.childElementCount === pageSize) {
      page = document.createElement("div");
      page.className = "word-page";
      wordList.append(page);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "word-button";
    button.textContent = word;
    button.dataset.word = word;
    button.addEventListener("click", () => selectWord(word));
    wordButtons.set(word, button);
    page.append(button);
  }
  count.textContent = `${state.words.length} 个字`;
  pagination.hidden = wordList.childElementCount < 2;
  updatePagination();
}

function fitWordPages() {
  const width = wordList.clientWidth;
  const height = wordList.clientHeight;
  const gap = 6;
  const tileHeight = height >= 156 ? 46 : height >= 85 ? 36 : 30;
  const columns = Math.max(1, Math.min(8, Math.floor(width / (46 + gap))));
  const rows = Math.max(1, Math.floor(height / (tileHeight + gap)));
  const capacity = columns * rows;

  wordList.style.setProperty("--word-columns", columns);
  wordList.style.setProperty("--word-height", `${tileHeight}px`);
  if (capacity === pageSize) return;

  pageSize = capacity;
  wordList.replaceChildren();
  wordButtons.clear();
  appendWordButtons(state.words);
  updateSelection();
  goToPage(Math.floor(state.words.indexOf(state.current) / pageSize), false);
}

function visiblePage() {
  const index = Math.round(wordList.scrollLeft / (wordList.clientWidth || 1));
  return Math.max(0, Math.min(index, wordList.childElementCount - 1));
}

function updatePagination() {
  const index = visiblePage();
  const total = wordList.childElementCount;
  pageNumber.textContent = `${index + 1} / ${total}`;
  previousPage.disabled = index <= 0;
  nextPage.disabled = index >= total - 1;
}

function goToPage(index, smooth = true) {
  wordList.scrollTo({
    left: wordList.clientWidth * index,
    behavior: smooth && !reduceMotion.matches ? "smooth" : "instant",
  });
  updatePagination();
}

function revealSelectedPage() {
  const index = Math.floor(state.words.indexOf(state.current) / pageSize);
  const currentPage = visiblePage();
  if (currentPage !== index) goToPage(index, Math.abs(currentPage - index) === 1);
}

function animateCharacter(character, frames, duration, delay = 0) {
  if (reduceMotion.matches || !character.animate) return;
  for (const animation of character.getAnimations()) animation.cancel();

  const rest = { transform: "none" };
  character.animate([rest, ...frames, rest], { duration, delay, easing: "ease-in-out" });
}

function animateBoard(oldWord) {
  if (reduceMotion.matches || !board.animate) return;
  outgoing?.remove();
  for (const animation of board.getAnimations()) animation.cancel();

  const departing = document.createElement("div");
  const oldGlyph = document.createElement("span");
  departing.className = "board";
  departing.setAttribute("aria-hidden", "true");
  oldGlyph.textContent = oldWord;
  departing.append(oldGlyph);
  board.before(departing);
  outgoing = departing;

  departing.animate([
    { transform: "translateY(0) rotate(0)", opacity: 1 },
    { transform: "translateY(95%) rotate(-11deg)", opacity: 0 },
  ], { duration: 180, easing: "ease-in" }).onfinish = () => departing.remove();

  board.animate([
    { transform: "translateY(90%) rotate(10deg)", opacity: 0, offset: 0 },
    { transform: "translateY(90%) rotate(10deg)", opacity: 0, offset: .24 },
    { transform: "translateY(-7%) rotate(-2deg)", opacity: 1, offset: .79 },
    { transform: "translateY(0) rotate(0)", opacity: 1, offset: 1 },
  ], { duration: 400, easing: "ease-out" });
}

function selectWord(word) {
  if (!word || word === state.current) return;
  const oldWord = state.current;
  state.current = word;
  stopSpeech();
  stopWordAudio();
  stopPraiseAudio();
  encouragement.textContent = "";
  updateSelection();
  announcement.textContent = `当前汉字：${word}`;
  saveProgress();
  animateBoard(oldWord);
  animateCharacter(bandit, [
    { transform: "translateY(19px) rotate(-5deg) scale(1.035, .93)", offset: .32 },
    { transform: "translateY(-10px) rotate(3deg) scale(.99, 1.025)", offset: .72 },
  ], 400);
}

function moveBy(offset) {
  selectWord(state.words[state.words.indexOf(state.current) + offset]);
  revealSelectedPage();
}

function stopSpeech() {
  window.clearTimeout(speechStartTimer);
  const shouldCancel = currentUtterance || speaker?.speaking || speaker?.pending;
  currentUtterance = undefined;
  if (shouldCancel) speaker.cancel();
}

function speakMandarin(text, rate, pitch, onError, onStart, onEnd) {
  if (!speaker || !window.SpeechSynthesisUtterance) {
    onError("当前打开方式不支持语音，请用 Safari 打开本地预览");
    return;
  }

  const mainland = /^(?:zh(?:-hans)?-cn|zh-hans|cmn(?:-hans)?(?:-cn)?)$/i;
  const mandarin = /^(?:zh(?:-hant)?-tw|zh-sg|zh|cmn-tw)$/i;
  const voices = speaker.getVoices();
  const mainlandVoices = voices.filter((voice) => mainland.test(voice.lang.replaceAll("_", "-")));
  const voice = mainlandVoices.find((option) => option.localService)
    ?? voices.find((option) => option.localService && mandarin.test(option.lang.replaceAll("_", "-")))
    ?? mainlandVoices[0];

  const utterance = new SpeechSynthesisUtterance(text);
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang ?? "zh-CN";
  utterance.rate = rate;
  utterance.pitch = pitch;
  let started = false;
  const fail = () => {
    if (currentUtterance !== utterance) return;
    stopSpeech();
    onError(voice
      ? "语音没能播放，请调高媒体音量后重试"
      : "普通话语音没能启动，请用 Safari 打开本地预览");
  };
  utterance.onstart = () => {
    if (currentUtterance !== utterance) return;
    started = true;
    window.clearTimeout(speechStartTimer);
    onStart?.();
  };
  utterance.onend = () => {
    if (currentUtterance !== utterance) return;
    if (!started) {
      fail();
      return;
    }
    window.clearTimeout(speechStartTimer);
    currentUtterance = undefined;
    onEnd?.();
  };
  utterance.onerror = fail;

  stopSpeech();
  currentUtterance = utterance;
  speechStartTimer = window.setTimeout(fail, 3500);
  try {
    speaker.speak(utterance);
  } catch {
    fail();
  }
}

function stopPraiseAudio() {
  const audio = praiseAudio;
  praiseAudio = undefined;
  audio?.pause();
}

function stopWordAudio() {
  const audio = wordAudio;
  wordAudio = undefined;
  audio?.pause();
}

function playWordAudio(url, onFailure, onEnded) {
  const audio = new Audio(url);
  let failed = false;
  const fail = () => {
    if (failed || wordAudio !== audio) return;
    failed = true;
    wordAudio = undefined;
    onFailure();
  };
  wordAudio = audio;
  audio.onplaying = () => {
    if (wordAudio === audio) encouragement.textContent = "";
  };
  audio.onended = () => {
    if (wordAudio !== audio) return;
    wordAudio = undefined;
    onEnded?.();
  };
  audio.onerror = fail;
  audio.play().catch(fail);
}

function readCurrentWord() {
  stopSpeech();
  stopWordAudio();
  stopPraiseAudio();
  encouragement.textContent = "正在准备朗读…";
  const word = state.current;
  const codePoint = word.codePointAt(0).toString(16);
  const explanation = wordExplanations[word];
  const playExplanation = () => {
    if (!explanation || state.current !== word) return;
    playWordAudio(`assets/audio/explanations/${codePoint}.mp3`, () => {
      encouragement.textContent = "";
    });
  };
  const useSystemVoice = () => {
    speakMandarin(word, .62, 1, (message) => {
      encouragement.textContent = message;
    }, () => {
      encouragement.textContent = "";
    }, playExplanation);
  };
  playWordAudio(`assets/audio/words/${codePoint}.mp3`, useSystemVoice, playExplanation);
}

function showEncouragement() {
  stopSpeech();
  stopWordAudio();
  stopPraiseAudio();
  encouragement.textContent = "";
  const blueyCheer = [
    { transform: "translateY(7px) scale(1.12, .86)", offset: .14 },
    { transform: "translate(-7px, -30px) rotate(-14deg) scale(1.08)", offset: .36 },
    { transform: "translate(5px, -10px) rotate(10deg)", offset: .56 },
    { transform: "translate(-4px, -25px) rotate(-8deg) scale(1.06)", offset: .72 },
    { transform: "translateY(5px) scale(1.06, .92)", offset: .88 },
  ];
  const bingoCheer = [
    { transform: "translateY(7px) scale(1.12, .86)", offset: .14 },
    { transform: "translate(7px, -30px) rotate(14deg) scale(1.08)", offset: .36 },
    { transform: "translate(-5px, -10px) rotate(-10deg)", offset: .56 },
    { transform: "translate(4px, -25px) rotate(8deg) scale(1.06)", offset: .72 },
    { transform: "translateY(5px) scale(1.06, .92)", offset: .88 },
  ];
  animateCharacter(bluey, blueyCheer, 820);
  animateCharacter(bingo, bingoCheer, 820, 100);

  const number = String(nextPraise + 1).padStart(2, "0");
  nextPraise = (nextPraise + 1) % praiseClipCount;

  const audio = new Audio(`assets/audio/praise-${number}.mp3`);
  praiseAudio = audio;
  audio.onended = () => {
    if (praiseAudio === audio) praiseAudio = undefined;
  };
  audio.play().catch(() => {
    if (praiseAudio !== audio) return;
    praiseAudio = undefined;
    encouragement.textContent = "夸奖语音没能播放";
  });
}

addForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const enteredWords = newWords.value.match(han) ?? [];
  if (!enteredWords.length) {
    addStatus.textContent = "请输入至少一个汉字。";
    return;
  }

  const targetWord = enteredWords[0];
  const known = new Set(state.words);
  const additions = [];
  for (const word of enteredWords) {
    if (known.has(word)) continue;
    known.add(word);
    additions.push(word);
  }
  if (additions.length) {
    state.words.push(...additions);
    appendWordButtons(additions);
  }

  const saved = saveProgress();
  selectWord(targetWord);
  revealSelectedPage();
  newWords.value = "";
  if (!additions.length) {
    addStatus.textContent = `已定位到“${targetWord}”。`;
  } else if (saved) {
    addStatus.textContent = `已添加 ${additions.length} 个字，并定位到“${targetWord}”。`;
  } else {
    addStatus.textContent = `已添加并定位到“${targetWord}”，关闭页面后可能丢失。`;
  }
});

addToggle.addEventListener("click", () => {
  const willOpen = addForm.hidden;
  addForm.hidden = !willOpen;
  addToggle.setAttribute("aria-expanded", String(willOpen));
  addToggle.textContent = willOpen ? "×" : "＋";
  if (willOpen) newWords.focus();
});

previousButton.addEventListener("click", () => moveBy(-1));
nextButton.addEventListener("click", () => moveBy(1));
correctButton.addEventListener("click", showEncouragement);
readButton.addEventListener("click", readCurrentWord);
wordList.addEventListener("scroll", updatePagination, { passive: true });
previousPage.addEventListener("click", () => goToPage(visiblePage() - 1));
nextPage.addEventListener("click", () => goToPage(visiblePage() + 1));
fitWordPages();
const wordListObserver = new ResizeObserver(fitWordPages);
wordListObserver.observe(wordList);
saveProgress();

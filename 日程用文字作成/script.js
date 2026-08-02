"use strict";

// localStorageへ保存するときの識別名。ほかのWebアプリのデータとの衝突を防ぐ。
const STORAGE_KEY = "schedule-text-maker-templates-v1";

// schedule-core.jsで定義した、日付計算に必要な関数を取り出す。
const { toDateInputValue, parseLocalDate, validate, buildCandidates } = ScheduleCore;

// HTML要素を最初に取得してまとめておくと、各処理から再利用しやすい。
const elements = {
  startDate: document.querySelector("#start-date"),
  endDate: document.querySelector("#end-date"),
  scheduleBody: document.querySelector("#schedule-body"),
  emptyScheduleTemplate: document.querySelector("#empty-schedule-template"),
  slotTemplate: document.querySelector("#slot-row-template"),
  addSlotButton: document.querySelector("#add-slot-button"),
  generateButton: document.querySelector("#generate-button"),
  errorMessage: document.querySelector("#error-message"),
  resultList: document.querySelector("#result-list"),
  resultCount: document.querySelector("#result-count"),
  selectAll: document.querySelector("#select-all"),
  copyButton: document.querySelector("#copy-button"),
  clearButton: document.querySelector("#clear-button"),
  templateName: document.querySelector("#template-name"),
  templateSelect: document.querySelector("#template-select"),
  saveTemplateButton: document.querySelector("#save-template-button"),
  loadTemplateButton: document.querySelector("#load-template-button"),
  deleteTemplateButton: document.querySelector("#delete-template-button"),
  overwriteDialog: document.querySelector("#overwrite-dialog"),
  overwriteTemplateName: document.querySelector("#overwrite-template-name"),
  cancelOverwriteButton: document.querySelector("#cancel-overwrite-button"),
  confirmOverwriteButton: document.querySelector("#confirm-overwrite-button"),
  toast: document.querySelector("#toast")
};

// 通知を消すタイマーと、確認待ちになっている上書きデータを保持する。
let toastTimer;
let pendingOverwrite = null;

/** 初回表示時の期間を「次の月曜日から日曜日」に設定する。 */
function setInitialDates() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const daysUntilMonday = (8 - today.getDay()) % 7 || 7;
  const nextMonday = new Date(today);
  nextMonday.setDate(today.getDate() + daysUntilMonday);

  const nextSunday = new Date(nextMonday);
  nextSunday.setDate(nextMonday.getDate() + 6);

  elements.startDate.value = toDateInputValue(nextMonday);
  elements.endDate.value = toDateInputValue(nextSunday);
}

/**
 * 時間帯の設定行を1つ作り、ステップ2の表へ追加する。
 * 保存済みデータが渡された場合は、時刻と曜日の選択状態も復元する。
 */
function addSlot(slot = { start: "10:00", end: "12:00", weekdays: [] }) {
  const fragment = elements.slotTemplate.content.cloneNode(true);
  const row = fragment.querySelector(".slot-row");

  row.querySelector(".start-time").value = slot.start || "10:00";
  row.querySelector(".end-time").value = slot.end || "12:00";

  const selectedDays = new Set((slot.weekdays || []).map(Number));
  row.querySelectorAll("[data-day]").forEach((checkbox) => {
    checkbox.checked = selectedDays.has(Number(checkbox.dataset.day));
  });

  row.querySelector(".remove-slot-button").addEventListener("click", () => {
    row.remove();
    updateScheduleEmptyState();
    updateMoveButtonStates();
  });

  row.querySelector(".move-up-button").addEventListener("click", () => moveSlot(row, -1));
  row.querySelector(".move-down-button").addEventListener("click", () => moveSlot(row, 1));

  elements.scheduleBody.appendChild(fragment);
  updateScheduleEmptyState();
  updateMoveButtonStates();
}

/**
 * 時間帯が0件なら、表の中に最初の追加ボタンを表示する。
 * 1件以上ある場合は空表示を消し、表上部の追加ボタンを表示する。
 */
function updateScheduleEmptyState() {
  const hasSlots = Boolean(elements.scheduleBody.querySelector(".slot-row"));
  const emptyRow = elements.scheduleBody.querySelector(".schedule-empty-row");

  elements.addSlotButton.hidden = !hasSlots;

  if (hasSlots) {
    emptyRow?.remove();
    return;
  }

  if (!emptyRow) {
    const fragment = elements.emptyScheduleTemplate.content.cloneNode(true);
    fragment.querySelector(".empty-add-slot-button").addEventListener("click", () => addSlot());
    elements.scheduleBody.appendChild(fragment);
  }
}

/** 指定された行を上下へ1段移動する。directionは上が-1、下が1。 */
function moveSlot(row, direction) {
  if (direction < 0 && row.previousElementSibling) {
    elements.scheduleBody.insertBefore(row, row.previousElementSibling);
  } else if (direction > 0 && row.nextElementSibling) {
    elements.scheduleBody.insertBefore(row.nextElementSibling, row);
  }

  updateMoveButtonStates();
  row.querySelector(direction < 0 ? ".move-up-button" : ".move-down-button").focus();
}

/** 先頭の「上へ」と末尾の「下へ」を無効化し、移動できる方向を示す。 */
function updateMoveButtonStates() {
  const rows = [...elements.scheduleBody.querySelectorAll(".slot-row")];
  rows.forEach((row, index) => {
    row.querySelector(".move-up-button").disabled = index === 0;
    row.querySelector(".move-down-button").disabled = index === rows.length - 1;
  });
}

/** 表に入力された時刻と曜日を、保存・生成しやすい配列形式へ変換する。 */
function collectSlots() {
  return [...elements.scheduleBody.querySelectorAll(".slot-row")].map((row) => ({
    start: row.querySelector(".start-time").value,
    end: row.querySelector(".end-time").value,
    weekdays: [...row.querySelectorAll("[data-day]:checked")].map((checkbox) => Number(checkbox.dataset.day))
  }));
}

/** エラー文を表示する。空文字を渡した場合はエラー欄を隠す。 */
function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorMessage.hidden = !message;
}

/**
 * 生成された候補日を、1件ずつチェックできる一覧として描画する。
 * 生成直後はすべての候補をコピー対象にする。
 */
function setResult(candidates) {
  elements.resultList.innerHTML = "";

  if (!candidates.length) {
    const placeholder = document.createElement("p");
    placeholder.className = "result-placeholder";
    placeholder.textContent = "ここに生成結果が表示されます";
    elements.resultList.appendChild(placeholder);
    updateSelectionState();
    return;
  }

  const fragment = document.createDocumentFragment();
  candidates.forEach((candidate) => {
    const label = document.createElement("label");
    label.className = "candidate-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "candidate-checkbox";
    checkbox.checked = true;
    checkbox.setAttribute("aria-label", `${candidate}をコピー対象にする`);
    checkbox.addEventListener("change", updateSelectionState);

    const text = document.createElement("span");
    text.className = "candidate-text";
    text.textContent = candidate;

    label.append(checkbox, text);
    fragment.appendChild(label);
  });

  elements.resultList.appendChild(fragment);
  updateSelectionState();
}

/** 現在チェックされている候補日の文字列だけを配列で返す。 */
function getSelectedCandidates() {
  return [...elements.resultList.querySelectorAll(".candidate-checkbox:checked")].map((checkbox) => (
    checkbox.closest(".candidate-item").querySelector(".candidate-text").textContent
  ));
}

/** 個別チェックに合わせ、選択件数・全選択・コピーボタンを同期する。 */
function updateSelectionState() {
  const checkboxes = [...elements.resultList.querySelectorAll(".candidate-checkbox")];
  const selectedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
  const totalCount = checkboxes.length;

  elements.resultCount.textContent = `${selectedCount}/${totalCount}件選択`;
  elements.copyButton.disabled = selectedCount === 0;
  elements.selectAll.disabled = totalCount === 0;
  elements.selectAll.checked = totalCount > 0 && selectedCount === totalCount;
  elements.selectAll.indeterminate = selectedCount > 0 && selectedCount < totalCount;
}

/** 入力値を検証し、期間と週間テンプレートから候補日一覧を生成する。 */
function generate() {
  const startDate = parseLocalDate(elements.startDate.value);
  const endDate = parseLocalDate(elements.endDate.value);
  const slots = collectSlots();
  const error = validate(startDate, endDate, slots);

  if (error) {
    showError(error);
    setResult([]);
    return;
  }

  showError("");
  const candidates = buildCandidates(startDate, endDate, slots);
  setResult(candidates);

  if (!candidates.length) {
    showError("指定した期間内に、選択した曜日がありませんでした。");
    return;
  }

  showToast(`${candidates.length}件の日程を生成しました。`);
}

/** チェックされた候補日だけを改行でつなぎ、クリップボードへコピーする。 */
async function copyResult() {
  const selectedCandidates = getSelectedCandidates();
  if (!selectedCandidates.length) {
    return;
  }
  const text = selectedCandidates.join("\n");

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard APIが使えない環境では、一時的なtextareaを使ってコピーする。
    const temporaryTextarea = document.createElement("textarea");
    temporaryTextarea.value = text;
    temporaryTextarea.style.position = "fixed";
    temporaryTextarea.style.opacity = "0";
    document.body.appendChild(temporaryTextarea);
    temporaryTextarea.select();
    document.execCommand("copy");
    temporaryTextarea.remove();
  }

  showToast(`${selectedCandidates.length}件の日程をコピーしました。`);
}

/** 生成結果とエラー表示を初期状態へ戻す。 */
function clearResult() {
  showError("");
  setResult([]);
}

/** 保存・コピーなどの完了メッセージを一定時間だけ表示する。 */
function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2400);
}

/** localStorageからテンプレート一覧を安全に読み込む。 */
function getTemplates() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** テンプレート一覧をJSON文字列へ変換してlocalStorageへ保存する。 */
function storeTemplates(templates) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

/** 保存済みテンプレートの選択欄を最新の内容で作り直す。 */
function refreshTemplateSelect(selectedId = "") {
  const templates = getTemplates();
  elements.templateSelect.innerHTML = '<option value="">テンプレートを選択</option>';

  templates.forEach((template) => {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.name;
    elements.templateSelect.appendChild(option);
  });

  elements.templateSelect.value = selectedId;
  updateTemplateButtons();
}

/**
 * 現在の週間設定を新しいテンプレートとして保存する。
 * 同名データがある場合は即座に保存せず、上書き確認を表示する。
 */
function saveTemplate() {
  const name = elements.templateName.value.trim();
  const slots = collectSlots();

  if (!name) {
    showToast("テンプレート名を入力してください。");
    elements.templateName.focus();
    return;
  }

  const slotError = validate(new Date(2000, 0, 1), new Date(2000, 0, 1), slots);
  if (slotError) {
    showError(slotError);
    return;
  }

  showError("");
  const templates = getTemplates();
  const existing = templates.find((template) => template.name === name);

  if (existing) {
    pendingOverwrite = { id: existing.id, name, slots };
    elements.overwriteTemplateName.textContent = name;
    elements.overwriteDialog.showModal();
    return;
  }

  const selectedId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  templates.push({ id: selectedId, name, slots });
  storeTemplates(templates);
  refreshTemplateSelect(selectedId);
  showToast("テンプレートを保存しました。");
}

/** 確認画面で許可された同名テンプレートを実際に上書きする。 */
function confirmOverwrite() {
  if (!pendingOverwrite) {
    return;
  }

  const { id, name, slots } = pendingOverwrite;
  const templates = getTemplates();
  const existing = templates.find((template) => template.id === id);

  if (existing) {
    existing.slots = slots;
    existing.name = name;
  } else {
    templates.push({ id, name, slots });
  }

  storeTemplates(templates);
  refreshTemplateSelect(id);
  elements.overwriteDialog.close();
  showToast("テンプレートを上書きしました。");
}

/** 上書きを行わず確認画面を閉じる。 */
function cancelOverwrite() {
  elements.overwriteDialog.close();
}

/** 選択されたテンプレートを読み込み、時間帯の表を再構築する。 */
function loadTemplate() {
  const id = elements.templateSelect.value;
  const template = getTemplates().find((item) => item.id === id);
  if (!template) {
    return;
  }

  elements.scheduleBody.innerHTML = "";
  template.slots.forEach(addSlot);
  updateScheduleEmptyState();
  elements.templateName.value = template.name;
  clearResult();
  showToast(`「${template.name}」を呼び出しました。`);
}

/** 選択されたテンプレートをlocalStorageから削除する。 */
function deleteTemplate() {
  const id = elements.templateSelect.value;
  const templates = getTemplates();
  const target = templates.find((template) => template.id === id);
  if (!target) {
    return;
  }

  const remaining = templates.filter((template) => template.id !== id);
  storeTemplates(remaining);
  refreshTemplateSelect();
  elements.templateName.value = "";
  showToast(`「${target.name}」を削除しました。`);
}

/** テンプレート未選択時は、呼び出し・削除ボタンを無効化する。 */
function updateTemplateButtons() {
  const hasSelection = Boolean(elements.templateSelect.value);
  elements.loadTemplateButton.disabled = !hasSelection;
  elements.deleteTemplateButton.disabled = !hasSelection;
}

// ===== ユーザー操作と各処理を結び付けるイベント設定 =====
elements.addSlotButton.addEventListener("click", () => addSlot());
elements.generateButton.addEventListener("click", generate);
elements.copyButton.addEventListener("click", copyResult);
elements.clearButton.addEventListener("click", clearResult);
elements.selectAll.addEventListener("change", () => {
  elements.resultList.querySelectorAll(".candidate-checkbox").forEach((checkbox) => {
    checkbox.checked = elements.selectAll.checked;
  });
  updateSelectionState();
});
elements.saveTemplateButton.addEventListener("click", saveTemplate);
elements.loadTemplateButton.addEventListener("click", loadTemplate);
elements.deleteTemplateButton.addEventListener("click", deleteTemplate);
elements.templateSelect.addEventListener("change", updateTemplateButtons);
elements.confirmOverwriteButton.addEventListener("click", confirmOverwrite);
elements.cancelOverwriteButton.addEventListener("click", cancelOverwrite);
elements.overwriteDialog.addEventListener("close", () => {
  // Escキーやキャンセルで閉じた場合も、保留中の上書き内容を破棄する。
  pendingOverwrite = null;
});

// ===== ページを開いた直後の初期表示 =====
setInitialDates();
updateScheduleEmptyState();
refreshTemplateSelect();

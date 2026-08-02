/*
 * 日程生成の計算部分をまとめたファイル。
 * ブラウザではScheduleCoreとして公開し、Node.jsからはテスト用にrequireできる形にする。
 */
(function (root, factory) {
  const core = factory();
  // Node.jsで読み込まれた場合はmodule.exportsを使って機能を公開する。
  if (typeof module === "object" && module.exports) {
    module.exports = core;
  }
  // ブラウザではscript.jsからScheduleCoreという名前で利用できるようにする。
  root.ScheduleCore = core;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // JavaScriptのgetDay()が返す0（日）～6（土）に対応する表示名。
  const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

  /** Dateオブジェクトを日付入力欄で使うYYYY-MM-DD形式へ変換する。 */
  function toDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  /** YYYY-MM-DD形式の文字列を、利用者のローカル時間のDateへ変換する。 */
  function parseLocalDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }

    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    date.setHours(0, 0, 0, 0);

    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return null;
    }

    return date;
  }

  /** 期間、時刻、曜日の入力内容を検証し、問題があればエラー文を返す。 */
  function validate(startDate, endDate, slots) {
    if (!startDate || !endDate) {
      return "開始日と終了日を入力してください。";
    }

    if (endDate < startDate) {
      return "終了日は開始日以降の日付を選んでください。";
    }

    if (!slots.length) {
      return "時間帯を1つ以上追加してください。";
    }

    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      if (!slot.start || !slot.end) {
        return `${index + 1}行目の開始時刻と終了時刻を入力してください。`;
      }
      if (slot.end <= slot.start) {
        return `${index + 1}行目の終了時刻は、開始時刻より後にしてください。`;
      }
      if (!slot.weekdays.length) {
        return `${index + 1}行目の曜日を1つ以上選択してください。`;
      }
    }

    return "";
  }

  /** 1件の候補日を「8/3(月) 10:00~12:00」形式へ整える。 */
  function formatCandidate(date, start, end) {
    return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAY_LABELS[date.getDay()]}) ${start}~${end}`;
  }

  /**
   * 期間内を1日ずつ進み、その曜日に該当する時間帯を候補日へ変換する。
   * 同じ日付・時刻の重複は除外し、同じ日では開始時刻順に並べる。
   */
  function buildCandidates(startDate, endDate, slots) {
    const candidates = [];
    const seen = new Set();
    const sortedSlots = [...slots].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));

    // 開始日から終了日まで、日付を1日ずつ進める。
    for (const date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
      for (const slot of sortedSlots) {
        if (!slot.weekdays.includes(date.getDay())) {
          continue;
        }

      // 日付・開始・終了が同じ候補を一意に判定するためのキー。
      const key = `${toDateInputValue(date)}-${slot.start}-${slot.end}`;
        if (!seen.has(key)) {
          candidates.push(formatCandidate(date, slot.start, slot.end));
          seen.add(key);
        }
      }
    }

    return candidates;
  }

  // 画面側やテスト側から利用してよい関数だけを公開する。
  return {
    WEEKDAY_LABELS,
    toDateInputValue,
    parseLocalDate,
    validate,
    buildCandidates
  };
});

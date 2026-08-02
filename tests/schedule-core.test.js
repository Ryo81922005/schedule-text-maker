"use strict";

// Node.js標準のassertを使い、「実際の結果」と「期待する結果」を比較する。
const assert = require("node:assert/strict");
const core = require("../schedule-core.js");

// テストで共通利用する、月曜日から金曜日までの期間。
const start = core.parseLocalDate("2026-08-03");
const end = core.parseLocalDate("2026-08-07");

// 複数曜日・複数時間帯が、日付順・開始時刻順で生成されることを確認する。
const candidates = core.buildCandidates(start, end, [
  { start: "18:00", end: "20:00", weekdays: [1, 3] },
  { start: "10:00", end: "12:00", weekdays: [1, 3, 5] }
]);

assert.deepEqual(candidates, [
  "8/3(月) 10:00~12:00",
  "8/3(月) 18:00~20:00",
  "8/5(水) 10:00~12:00",
  "8/5(水) 18:00~20:00",
  "8/7(金) 10:00~12:00"
]);

// 同一内容の時間帯が複数行あっても、候補日は重複しないことを確認する。
const duplicates = core.buildCandidates(start, start, [
  { start: "10:00", end: "12:00", weekdays: [1] },
  { start: "10:00", end: "12:00", weekdays: [1] }
]);
assert.deepEqual(duplicates, ["8/3(月) 10:00~12:00"]);

// 存在しない日付や不正な期間・時刻・曜日がエラーになることを確認する。
assert.equal(core.parseLocalDate("2026-02-30"), null);
assert.equal(core.validate(end, start, [{ start: "10:00", end: "12:00", weekdays: [1] }]), "終了日は開始日以降の日付を選んでください。");
assert.equal(core.validate(start, end, [{ start: "12:00", end: "10:00", weekdays: [1] }]), "1行目の終了時刻は、開始時刻より後にしてください。");
assert.equal(core.validate(start, end, [{ start: "10:00", end: "12:00", weekdays: [] }]), "1行目の曜日を1つ以上選択してください。");

console.log("schedule-core: all tests passed");

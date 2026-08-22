import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { KY_TU_MOI_TOKEN, uocTokenTuKyTu } from "./ky-tu-moi-token.js";

describe("uocTokenTuKyTu", () => {
  it("quy đổi theo đúng KY_TU_MOI_TOKEN và làm tròn LÊN", () => {
    // Làm tròn lên chứ không xuống: đây là ước lượng dùng để CHẶN, ước hụt là
    // cho qua một cấu hình vượt trần.
    assert.equal(uocTokenTuKyTu(2500), 1000);
    assert.equal(uocTokenTuKyTu(1), 1);
    assert.equal(uocTokenTuKyTu(0), 0);
  });

  it("khớp phép chia trực tiếp bằng hằng số", () => {
    for (const n of [500, 1200, 8000, 15_000, 20_000, 100_000]) {
      assert.equal(uocTokenTuKyTu(n), Math.ceil(n / KY_TU_MOI_TOKEN));
    }
  });
});

describe("chỉ có MỘT hằng số quy đổi ký tự sang token", () => {
  it("không nơi nào tự chia cho một số ký tự/token khác", () => {
    // Lỗi đã trả giá: luật chéo `DOCUMENT_MAX_CHARS` tự viết `/ 4` - con số của
    // TIẾNG ANH - trong khi bộ ước lượng thật chạy 2,5. Luật cho qua tới 45.875
    // ký tự trong khi bộ ước lượng chỉ chịu 28.672. Test này chặn việc một hằng
    // số thứ hai lại mọc ra ở đâu đó.
    const nghiNgo = [
      { f: "src/config/runtime-tuning-settings.ts", mau: /_CHARS"\)\s*\/\s*\d/ },
      { f: "src/agent/token-estimate.ts", mau: /\.length\s*\/\s*\d/ },
    ];
    for (const { f, mau } of nghiNgo) {
      const noiDung = readFileSync(f, "utf8");
      const khop = noiDung.match(mau);
      assert.equal(
        khop,
        null,
        `${f} đang chia độ dài cho một số viết thẳng ("${khop?.[0]}") thay vì dùng KY_TU_MOI_TOKEN`,
      );
    }
  });
});

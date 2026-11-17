import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nenNapSanTep } from "./nen-nap-san-tep.js";

describe("nenNapSanTep", () => {
  it("doc_file bật ở cả agent lẫn account -> nạp sẵn", () => {
    assert.equal(nenNapSanTep({ disabledTools: [] }, { disabledTools: ["web_search"] }), true);
  });

  it("tắt doc_file ở agent HOẶC ở account -> KHÔNG tải, KHÔNG OCR (khỏi tốn suất model đọc ảnh)", () => {
    assert.equal(nenNapSanTep({ disabledTools: ["doc_file"] }, { disabledTools: [] }), false);
    assert.equal(nenNapSanTep({ disabledTools: [] }, { disabledTools: ["doc_file"] }), false);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dangNhapTayCuaSo,
  laMocCoSan,
  MOC_CUA_SO_NGU_CANH,
  TRAN_KY_TU_HINT,
} from "./context-window-presets.js";
import { TUNING_DEFS } from "./tuning-definitions.js";

describe("mốc cửa sổ ngữ cảnh", () => {
  it("mọi mốc nằm trong khoảng schema env chấp nhận", () => {
    // Mốc nằm ngoài khoảng thì người dùng chọn xong bị từ chối lưu, mà lỗi hiện
    // ra lại nói về con số họ KHÔNG tự gõ - không cách nào đoán ra vì sao.
    const def = TUNING_DEFS.LLM_CONTEXT_WINDOW;
    if (def?.kind !== "number") return assert.fail("phải là kind number");
    for (const m of MOC_CUA_SO_NGU_CANH) {
      assert.ok(
        m.value >= def.min && m.value <= def.max,
        `mốc ${m.value} nằm ngoài ${def.min}..${def.max}`,
      );
    }
  });

  it("mốc gắn đúng vào định nghĩa tuning - trang Cấu hình lấy qua đường này", () => {
    const def = TUNING_DEFS.LLM_CONTEXT_WINDOW;
    if (def?.kind !== "number") return assert.fail("phải là kind number");
    assert.deepEqual(def.presets, MOC_CUA_SO_NGU_CANH);
  });

  it("mặc định của env là một mốc có sẵn - không thì ô mở ra đã ở chế độ nhập tay", () => {
    assert.ok(laMocCoSan(128_000));
  });

  it("`label` là ĐÚNG con số, không kèm chữ nào khác", () => {
    // Nhét thêm chữ vào `label` là mở lại đúng lỗi đã sửa: ô hẹp cắt đuôi và ra
    // "128.000 - phổ thông, an toàn cho mọ...". Tên model phải ở `hint`, vì
    // SelectMenu cắt `hint` trước và giữ `label` nguyên vẹn.
    for (const m of MOC_CUA_SO_NGU_CANH) {
      assert.equal(m.label, m.value.toLocaleString("vi-VN"));
    }
  });

  it("mọi mốc đều có `hint` nói model nào - số trần trụi thì không ai chọn nổi", () => {
    for (const m of MOC_CUA_SO_NGU_CANH) {
      assert.ok(m.hint.trim() !== "", `mốc ${m.value} thiếu hint`);
    }
  });

  it("hint không vượt trần ký tự - dài hơn là popup chạm mép cửa sổ rồi bị cắt", () => {
    for (const m of MOC_CUA_SO_NGU_CANH) {
      assert.ok(
        m.hint.length <= TRAN_KY_TU_HINT,
        `hint của mốc ${m.value} dài ${m.hint.length} ký tự, trần là ${TRAN_KY_TU_HINT}: "${m.hint}"`,
      );
    }
  });

  it("không có mốc trùng giá trị - menu hiện hai dòng chọn ra cùng một số", () => {
    const daThay = new Set<number>();
    for (const m of MOC_CUA_SO_NGU_CANH) {
      assert.ok(!daThay.has(m.value), `mốc ${m.value} bị lặp`);
      daThay.add(m.value);
    }
  });

  it("mốc sắp tăng dần - menu nhảy số lung tung thì khó chọn", () => {
    const so = MOC_CUA_SO_NGU_CANH.map((m) => m.value);
    assert.deepEqual(so, [...so].sort((a, b) => a - b));
  });
});

describe("dangNhapTayCuaSo", () => {
  it("giá trị trùng một mốc thì hiện MENU", () => {
    assert.equal(dangNhapTayCuaSo("128000", false), false);
    assert.equal(dangNhapTayCuaSo("1000000", false), false);
  });

  it("giá trị KHÔNG trùng mốc nào thì hiện Ô NHẬP - không thì số của họ biến mất khỏi màn", () => {
    assert.equal(dangNhapTayCuaSo("150000", false), true);
  });

  it("rỗng = theo Cấu hình chung, KHÔNG phải nhập tay", () => {
    assert.equal(dangNhapTayCuaSo("", false), false);
    assert.equal(dangNhapTayCuaSo("   ", false), false);
  });

  it("bấm Tùy chỉnh thì ở lại ô nhập KỂ CẢ khi giá trị vẫn đang trùng mốc", () => {
    // Đây là ca dễ hỏng nhất: suy hoàn toàn từ giá trị thì vừa bấm xong ô nhảy
    // ngược về menu, người dùng không bao giờ vào được chế độ nhập tay.
    assert.equal(dangNhapTayCuaSo("128000", true), true);
  });

  it("giá trị rác vẫn hiện ô nhập để người ta sửa được", () => {
    assert.equal(dangNhapTayCuaSo("abc", false), true);
  });

  it("khoảng trắng thừa quanh một mốc vẫn nhận ra là mốc", () => {
    assert.equal(dangNhapTayCuaSo(" 200000 ", false), false);
  });
});

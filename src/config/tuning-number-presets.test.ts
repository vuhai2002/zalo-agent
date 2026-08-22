import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dangNhapTayCuaSo,
  laMocCoSan,
  MOC_CUA_SO_NGU_CANH,
  MOC_TRAN_TOKEN_VIET_RA,
  TRAN_KY_TU_HINT,
  type MocSoGoiY,
} from "./tuning-number-presets.js";
import { TUNING_DEFS } from "./tuning-definitions.js";
import { uocTokenTuKyTu } from "../shared/ky-tu-moi-token.js";

/** Mỗi danh sách mốc phải qua đúng bộ luật này - thêm danh sách mới thì thêm một dòng */
const DANH_SACH: { ten: string; key: string; moc: readonly MocSoGoiY[] }[] = [
  { ten: "cửa sổ ngữ cảnh", key: "LLM_CONTEXT_WINDOW", moc: MOC_CUA_SO_NGU_CANH },
  { ten: "trần token viết ra", key: "LLM_MAX_OUTPUT_TOKENS", moc: MOC_TRAN_TOKEN_VIET_RA },
];

for (const { ten, key, moc } of DANH_SACH) {
  describe(`mốc ${ten}`, () => {
    it("mọi mốc nằm trong khoảng schema env chấp nhận", () => {
      // Mốc nằm ngoài khoảng thì người dùng chọn xong bị từ chối lưu, mà lỗi
      // hiện ra lại nói về con số họ KHÔNG tự gõ - không cách nào đoán ra vì sao.
      const def = TUNING_DEFS[key];
      if (def?.kind !== "number") return assert.fail(`${key} phải là kind number`);
      for (const m of moc) {
        assert.ok(
          m.value >= def.min && m.value <= def.max,
          `mốc ${m.value} nằm ngoài ${def.min}..${def.max}`,
        );
      }
    });

    it("mốc gắn đúng vào định nghĩa tuning - trang Cấu hình lấy qua đường này", () => {
      const def = TUNING_DEFS[key];
      if (def?.kind !== "number") return assert.fail(`${key} phải là kind number`);
      assert.deepEqual(def.presets, moc);
    });

    it("`label` là ĐÚNG con số, không kèm chữ nào khác", () => {
      // Nhét thêm chữ vào `label` là mở lại đúng lỗi đã sửa: ô hẹp cắt đuôi và
      // ra "128.000 - phổ thông, an toàn cho mọ...". Chú thích phải ở `hint`, vì
      // SelectMenu giữ `label` nguyên vẹn và cắt `hint`.
      for (const m of moc) {
        assert.equal(m.label, m.value.toLocaleString("vi-VN"));
      }
    });

    it("mọi mốc đều có `hint` - số trần trụi thì không ai chọn nổi", () => {
      for (const m of moc) {
        assert.ok(m.hint.trim() !== "", `mốc ${m.value} thiếu hint`);
      }
    });

    it("hint không vượt trần ký tự - dài hơn là popup chạm mép cửa sổ rồi bị cắt", () => {
      for (const m of moc) {
        assert.ok(
          m.hint.length <= TRAN_KY_TU_HINT,
          `hint của mốc ${m.value} dài ${m.hint.length} ký tự, trần là ${TRAN_KY_TU_HINT}: "${m.hint}"`,
        );
      }
    });

    it("không có mốc trùng giá trị - menu hiện hai dòng chọn ra cùng một số", () => {
      const daThay = new Set<number>();
      for (const m of moc) {
        assert.ok(!daThay.has(m.value), `mốc ${m.value} bị lặp`);
        daThay.add(m.value);
      }
    });

    it("mốc sắp tăng dần - menu nhảy số lung tung thì khó chọn", () => {
      const so = moc.map((m) => m.value);
      assert.deepEqual(so, [...so].sort((a, b) => a - b));
    });

    it("mặc định của env là một mốc có sẵn - không thì ô mở ra đã ở chế độ nhập tay", () => {
      // Đọc thẳng từ định nghĩa để không phải chép lại số mặc định vào test.
      const macDinh = key === "LLM_CONTEXT_WINDOW" ? 128_000 : 16_384;
      assert.ok(laMocCoSan(moc, macDinh), `${macDinh} phải là một mốc của ${ten}`);
    });
  });
}

describe("mốc trần token viết ra - ràng buộc chéo", () => {
  it("có ít nhất hai mốc DÙNG ĐƯỢC NGAY với bộ mặc định", () => {
    // Hai luật chéo kẹp ô này: quy đổi trần tài liệu ra token phải <= tran*0,7
    // (chặn từ dưới), và `cuaSo*0,3 <= tran` (chặn từ trên). Với mặc định
    // (`DOCUMENT_MAX_CHARS` 20.000, cửa sổ 128.000) khoảng hợp lệ là
    // 11.429 - 38.399. Danh sách mà KHÔNG có mốc nào lọt khoảng đó thì mở menu
    // ra chọn cái nào cũng bị từ chối lưu.
    //
    // Tính bằng `uocTokenTuKyTu` chứ KHÔNG viết lại phép chia: đây đúng là chỗ
    // đã đẻ ra bản sao hằng số quy đổi thứ hai một lần rồi.
    const duoi = uocTokenTuKyTu(20_000) / 0.7;
    const tren = 128_000 * 0.3;
    const dungDuoc = MOC_TRAN_TOKEN_VIET_RA.filter((m) => m.value > duoi && m.value < tren);
    assert.ok(
      dungDuoc.length >= 2,
      `phải có >= 2 mốc trong khoảng ${Math.ceil(duoi)}..${tren - 1}, đang có: ${dungDuoc.map((m) => m.value).join(", ")}`,
    );
  });

  it("mặc định 16.384 nằm trong khoảng dùng được ngay", () => {
    assert.ok(16_384 > uocTokenTuKyTu(20_000) / 0.7 && 16_384 < 128_000 * 0.3);
  });

  it("mô tả của ô ghi ĐÚNG khoảng dùng được - số trong chữ phải khớp số trong luật", () => {
    // Câu "khoảng dùng được là X - Y" nằm trong `hint`, mà hint là chữ tĩnh nên
    // nó lạc hậu ngay khi ai đó chỉnh hằng số quy đổi. Đã xảy ra: siết luật từ
    // 4 xuống 2,5 ký tự/token làm cận dưới nhảy từ 7.143 lên 11.429.
    const def = TUNING_DEFS.LLM_MAX_OUTPUT_TOKENS;
    if (def?.kind !== "number") return assert.fail("phải là kind number");
    const duoi = Math.ceil(uocTokenTuKyTu(20_000) / 0.7 + 0.001);
    const tren = 128_000 * 0.3 - 1;
    assert.ok(
      def.hint.includes(duoi.toLocaleString("vi-VN")) &&
        def.hint.includes(tren.toLocaleString("vi-VN")),
      `hint phải ghi khoảng ${duoi.toLocaleString("vi-VN")} - ${tren.toLocaleString("vi-VN")}`,
    );
  });
});

describe("dangNhapTayCuaSo", () => {
  it("giá trị trùng một mốc thì hiện MENU", () => {
    assert.equal(dangNhapTayCuaSo(MOC_CUA_SO_NGU_CANH, "128000", false), false);
    assert.equal(dangNhapTayCuaSo(MOC_TRAN_TOKEN_VIET_RA, "16384", false), false);
  });

  it("xét đúng DANH SÁCH được truyền vào, không lẫn sang danh sách kia", () => {
    // 200.000 là mốc của cửa sổ ngữ cảnh nhưng KHÔNG phải mốc của trần viết ra.
    assert.equal(dangNhapTayCuaSo(MOC_CUA_SO_NGU_CANH, "200000", false), false);
    assert.equal(dangNhapTayCuaSo(MOC_TRAN_TOKEN_VIET_RA, "200000", false), true);
  });

  it("giá trị KHÔNG trùng mốc nào thì hiện Ô NHẬP - không thì số của họ biến mất khỏi màn", () => {
    assert.equal(dangNhapTayCuaSo(MOC_CUA_SO_NGU_CANH, "150000", false), true);
  });

  it("rỗng = theo Cấu hình chung, KHÔNG phải nhập tay", () => {
    assert.equal(dangNhapTayCuaSo(MOC_CUA_SO_NGU_CANH, "", false), false);
    assert.equal(dangNhapTayCuaSo(MOC_CUA_SO_NGU_CANH, "   ", false), false);
  });

  it("bấm Tùy chỉnh thì ở lại ô nhập KỂ CẢ khi giá trị vẫn đang trùng mốc", () => {
    // Đây là ca dễ hỏng nhất: suy hoàn toàn từ giá trị thì vừa bấm xong ô nhảy
    // ngược về menu, người dùng không bao giờ vào được chế độ nhập tay.
    assert.equal(dangNhapTayCuaSo(MOC_CUA_SO_NGU_CANH, "128000", true), true);
  });

  it("giá trị rác vẫn hiện ô nhập để người ta sửa được", () => {
    assert.equal(dangNhapTayCuaSo(MOC_CUA_SO_NGU_CANH, "abc", false), true);
  });

  it("khoảng trắng thừa quanh một mốc vẫn nhận ra là mốc", () => {
    assert.equal(dangNhapTayCuaSo(MOC_CUA_SO_NGU_CANH, " 200000 ", false), false);
  });
});
